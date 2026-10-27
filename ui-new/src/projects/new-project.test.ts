import { describe, expect, it } from "vitest";
import { buildProjectPayload, emptyProjectDraft, membersToAdd, projectProblem, TILE_COLORS, TILE_ICONS, tileGradient } from "./new-project";

describe("emptyProjectDraft", () => {
  it("starts Planned and open, with no code, on one of the tile colors", () => {
    const draft = emptyProjectDraft({}, () => 0.99);
    expect(draft).toMatchObject({ status: "planned", visibility: "open", source: "none", icon: null, color: TILE_COLORS[7]!.stops[0] });
  });

  it("offers fifteen icons the server accepts", () => {
    expect(TILE_ICONS).toHaveLength(15);
    expect(new Set(TILE_ICONS.map((icon) => icon.value)).size).toBe(15);
  });
});

describe("projectProblem", () => {
  it("needs a name", () => {
    expect(projectProblem(emptyProjectDraft({ name: "  " }))).toBe("Give the project a name.");
    expect(projectProblem(emptyProjectDraft({ name: "Ops" }))).toBeNull();
  });

  it("needs a folder or a repository for the code source picked", () => {
    expect(projectProblem(emptyProjectDraft({ name: "Ops", source: "local" }))).toMatch(/folder/);
    expect(projectProblem(emptyProjectDraft({ name: "Ops", source: "github" }))).toMatch(/repository/);
    expect(projectProblem(emptyProjectDraft({ name: "Ops", source: "github", repositoryIds: ["1"] }))).toBeNull();
  });

  it("checks the target date", () => {
    expect(projectProblem(emptyProjectDraft({ name: "Ops", targetDate: "soon" }))).toMatch(/date/);
    expect(projectProblem(emptyProjectDraft({ name: "Ops", targetDate: "2026-12-15" }))).toBeNull();
  });
});

describe("buildProjectPayload", () => {
  it("sends the basics and leaves empty fields out", () => {
    const payload = buildProjectPayload(emptyProjectDraft({ name: "  Options analytics ", color: "#22b5a5" }), "key-1");
    expect(payload).toEqual({ name: "Options analytics", status: "planned", visibility: "open", color: "#22b5a5", idempotencyKey: "key-1" });
  });

  it("sends the tile icon, lead, target date and description", () => {
    const payload = buildProjectPayload(
      emptyProjectDraft({ name: "Ops", icon: "rocket", leadAgentId: "a1", targetDate: "2026-12-15", description: " Why it exists ", status: "in_progress" }),
    );
    expect(payload).toMatchObject({ icon: "rocket", leadAgentId: "a1", targetDate: "2026-12-15", description: "Why it exists", status: "in_progress" });
    expect(payload).not.toHaveProperty("idempotencyKey");
  });

  it("sends GitHub repositories in order, or a local folder as the primary workspace", () => {
    const github = buildProjectPayload(emptyProjectDraft({ name: "Ops", source: "github", repositoryIds: ["2", "1"], folder: "/ignored" }));
    expect(github.repositoryIds).toEqual(["2", "1"]);
    expect(github).not.toHaveProperty("workspace");

    const local = buildProjectPayload(emptyProjectDraft({ name: "Ops", source: "local", folder: " /srv/ops ", repositoryIds: ["9"] }));
    expect(local.workspace).toEqual({ sourceType: "local_path", cwd: "/srv/ops", isPrimary: true });
    expect(local).not.toHaveProperty("repositoryIds");

    const none = buildProjectPayload(emptyProjectDraft({ name: "Ops", source: "none", repositoryIds: ["9"], folder: "/x" }));
    expect(none).not.toHaveProperty("repositoryIds");
    expect(none).not.toHaveProperty("workspace");
  });
});

describe("membersToAdd", () => {
  const members = [
    { kind: "user" as const, id: "me" },
    { kind: "agent" as const, id: "a1" },
  ];

  it("adds a private project's members other than you", () => {
    expect(membersToAdd({ visibility: "private", members }, "me")).toEqual([{ kind: "agent", id: "a1" }]);
  });

  it("adds no one to an open project", () => {
    expect(membersToAdd({ visibility: "open", members }, "me")).toEqual([]);
  });
});

describe("tileGradient", () => {
  it("draws a known color with its pair, and any other color with a darker stop", () => {
    expect(tileGradient("#22B5A5")).toBe("linear-gradient(160deg, #22b5a5, #4c7896)");
    expect(tileGradient("#123456")).toBe("linear-gradient(160deg, #123456, color-mix(in srgb, #123456 60%, #000))");
    expect(tileGradient(null)).toBeNull();
  });
});
