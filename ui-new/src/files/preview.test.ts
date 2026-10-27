import { describe, expect, it } from "vitest";
import { base64Bytes, describeUnavailable, detectPreview, extension, languageFor } from "./preview";

const resource = (displayPath: string, previewKind: "text" | "image" | "video" | "pdf" | "unsupported", contentType: string | null = null) => ({
  displayPath,
  title: displayPath.split("/").pop() ?? displayPath,
  previewKind,
  contentType,
  capabilities: { preview: previewKind !== "unsupported", download: true, listChildren: false },
});

describe("preview detection", () => {
  it("reads extensions and languages", () => {
    expect(extension("src/a.test.TS")).toBe("ts");
    expect(extension(".gitignore")).toBe("");
    expect(extension("Makefile")).toBe("");
    expect(languageFor("src/app.tsx")).toBe("TypeScript");
    expect(languageFor("Dockerfile")).toBe("Dockerfile");
    expect(languageFor("notes.txt")).toBeNull();
  });

  it("splits text into Markdown, code and plain text", () => {
    expect(detectPreview(resource("docs/README.md", "text"))).toEqual({ kind: "markdown" });
    expect(detectPreview(resource("notes", "text", "text/markdown"))).toEqual({ kind: "markdown" });
    expect(detectPreview(resource("src/main.py", "text"))).toEqual({ kind: "code", language: "Python" });
    expect(detectPreview(resource("run.log", "text"))).toEqual({ kind: "text" });
  });

  it("turns media content into a data URL", () => {
    const image = detectPreview(resource("chart.png", "image", "image/png"), { encoding: "base64", data: "AAAA" });
    expect(image).toEqual({ kind: "image", src: "data:image/png;base64,AAAA" });
    expect(detectPreview(resource("chart.png", "image", "image/png"))).toEqual({ kind: "image", src: "" });
    expect(detectPreview(resource("clip.mp4", "video", "video/mp4"), { encoding: "base64", data: "BB" })).toEqual({
      kind: "video",
      src: "data:video/mp4;base64,BB",
    });
    expect(detectPreview(resource("paper.pdf", "pdf", "application/pdf"))).toEqual({ kind: "pdf" });
  });

  it("refuses what the server won't preview", () => {
    expect(detectPreview(resource("app.bin", "unsupported")).kind).toBe("unsupported");
    expect(detectPreview({ ...resource("big.txt", "text"), capabilities: { preview: false, download: true, listChildren: false }, denialReason: "Too large" })).toEqual({
      kind: "unsupported",
      reason: "Too large",
    });
    expect(detectPreview(resource("weird.txt", "text"), { encoding: "base64", data: "AA" }).kind).toBe("unsupported");
  });

  it("decodes base64 for PDF blobs", () => {
    expect([...base64Bytes(btoa("%PDF"))]).toEqual([37, 80, 68, 70]);
  });

  it("explains why a workspace can't be browsed", () => {
    expect(describeUnavailable("no_workspace").title).toBe("No workspace yet");
    expect(describeUnavailable("remote_managed").title).toBe("Remote workspace");
    expect(describeUnavailable("changed_unavailable").title).toMatch(/Changed files/);
    expect(describeUnavailable("workspace_unavailable").title).toBe("Workspace is gone");
    expect(describeUnavailable(null).title).toBe("Workspace unavailable");
  });
});
