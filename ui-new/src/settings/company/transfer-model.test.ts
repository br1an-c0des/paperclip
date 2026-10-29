import { describe, expect, it, vi } from "vitest";
import {
  exportCounts,
  exportFileName,
  importedFiles,
  importPlanLines,
  importTarget,
  packageProblem,
  transferDeclaration,
  transferProgressLine,
  uploadTransfer,
  usesChunkedTransfer,
} from "./transfer-model";

describe("export", () => {
  it("sums up what's in the package", () => {
    expect(exportCounts({ agents: 1, projects: 2, issues: 0, skills: 3, files: 12 })).toBe("1 agent · 2 projects · 0 tasks · 3 skills · 12 files");
  });

  it("names the download after the package root", () => {
    expect(exportFileName("test-shell-co")).toBe("test-shell-co.zip");
    expect(exportFileName("out/test-shell-co/")).toBe("test-shell-co.zip");
    expect(exportFileName("")).toBe("company.zip");
  });
});

describe("import", () => {
  it("lists what the import does", () => {
    expect(
      importPlanLines({
        companyAction: "create",
        agentPlans: [{ action: "create" }, { action: "create" }, { action: "skip" }] as never,
        projectPlans: [{ action: "create" }] as never,
        issuePlans: [],
      }),
    ).toEqual(["Creates a new organization", "Creates 2 agents", "Skips 1 agent", "Creates 1 project"]);
  });

  it("wants a zip", () => {
    expect(packageProblem(null)).toMatch(/zip/);
    expect(packageProblem(new File(["x"], "notes.txt", { type: "text/plain" }))).toMatch(/zip/);
    expect(packageProblem(new File(["x"], "co.zip", { type: "" }))).toBeNull();
  });

  it("targets a new organization or this one, with a rule for same names", () => {
    expect(importTarget("new", "c1", " Acme ", "replace")).toEqual({ target: { mode: "new_company", newCompanyName: "Acme" }, collisionStrategy: "rename" });
    expect(importTarget("existing", "c1", "ignored", "skip")).toEqual({ target: { mode: "existing_company", companyId: "c1" }, collisionStrategy: "skip" });
  });

  it("leaves the package's company file out of a merge unless asked", () => {
    const preview = {
      plan: { companyAction: "update" },
      manifest: { company: { path: "COMPANY" } },
      files: { "COMPANY.md": "", "agents/ceo/AGENTS.md": "", "projects/web/PROJECT.md": "" },
    } as never;
    expect(importedFiles(preview, false)).toEqual(["agents/ceo/AGENTS.md", "projects/web/PROJECT.md"]);
    expect(importedFiles(preview, true)).toBeUndefined();
  });
});

describe("resumable transfers", () => {
  it("uses parts only for large packages", () => {
    expect(usesChunkedTransfer({ size: 48 * 1024 * 1024 })).toBe(false);
    expect(usesChunkedTransfer({ size: 48 * 1024 * 1024 + 1 })).toBe(true);
  });

  it("declares the zip as content-addressed parts", async () => {
    const bytes = new TextEncoder().encode("abcdefghij");
    const declaration = await transferDeclaration(bytes.buffer, 4);
    expect(declaration.totalBytes).toBe(10);
    expect(declaration.partSizeBytes).toBe(4);
    expect(declaration.parts.map((part) => [part.index, part.byteSize])).toEqual([
      [0, 4],
      [1, 4],
      [2, 2],
    ]);
    expect(declaration.zipSha256).toBe("72399361da6a7754fec986dca5b7cbaf1c810a28ded4abaf56b2106d06cb78b0");
    expect(declaration.parts.every((part) => /^[0-9a-f]{64}$/.test(part.sha256))).toBe(true);
  });

  it("uploads only the missing parts, retrying each, and reports progress", async () => {
    const bytes = new TextEncoder().encode("abcdefghij");
    const declaration = await transferDeclaration(bytes.buffer, 4);
    const sent: number[] = [];
    let failures = 1;
    const progress: string[] = [];
    const id = await uploadTransfer(
      new Blob([bytes]),
      declaration,
      {
        create: async () => ({ transferId: "t1", status: "running", alreadyCompleted: false, totalParts: 3, missingParts: [1, 2] }),
        upload: async (_transferId, index, blob) => {
          if (index === 1 && failures-- > 0) throw new Error("dropped");
          sent.push(index);
          expect(blob.size).toBe(index === 2 ? 2 : 4);
        },
      },
      (step) => progress.push(`${step.uploadedParts}/${step.totalParts}`),
    );
    expect(id).toBe("t1");
    expect(sent).toEqual([1, 2]);
    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
    expect(transferProgressLine({ uploadedParts: 1, totalParts: 3, uploadedBytes: 32 * 1024 * 1024, totalBytes: 80 * 1024 * 1024 })).toBe("Uploading part 2 of 3: 32 MB of 80 MB.");
  });

  it("stops after three failed tries, and on a package imported before", async () => {
    const declaration = await transferDeclaration(new TextEncoder().encode("abcd").buffer, 4);
    const upload = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      uploadTransfer(new Blob(["abcd"]), declaration, { create: async () => ({ transferId: "t", status: "running", alreadyCompleted: false, totalParts: 1, missingParts: [0] }), upload }, () => {}),
    ).rejects.toThrow("offline");
    expect(upload).toHaveBeenCalledTimes(3);
    await expect(
      uploadTransfer(
        new Blob(["abcd"]),
        declaration,
        {
          create: async () => ({ transferId: "t", status: "completed", alreadyCompleted: true, totalParts: 1, missingParts: [], company: { id: "c", name: "Acme", issuePrefix: "ACM" } }),
          upload,
        },
        () => {},
      ),
    ).rejects.toThrow(/already imported\. It went into Acme \(ACM\)/);
  });
});
