import type { ActivityEvent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { activityLine, isQuietAction, type ActivityInput } from "./activity-line";

const names = {
  agent: (id: string) => (id === "a1" ? { name: "Quant Researcher", urlKey: "quant" } : undefined),
  person: (id: string) => (id === "u2" ? "Maya R." : "Someone"),
  youId: "u1",
};

const event = (extra: Partial<ActivityInput>): ActivityEvent & ActivityInput => ({
  id: "e",
  companyId: "c",
  actorType: "user",
  actorId: "u1",
  action: "issue.created",
  entityType: "issue",
  entityId: "i1",
  agentId: null,
  runId: null,
  details: null,
  createdAt: new Date("2026-10-27T10:00:00Z"),
  ...(extra as Partial<ActivityEvent>),
});

describe("activityLine", () => {
  it("names you, people and agents, and links the task", () => {
    expect(activityLine(event({ details: { identifier: "TES-4" } }), names)).toMatchObject({ who: "You", verb: "created", target: "TES-4", href: "/issues/TES-4" });
    expect(activityLine(event({ actorId: "u2", action: "issue.comment_added", details: { identifier: "TES-4" } }), names)?.who).toBe("Maya R.");
    expect(activityLine(event({ actorType: "agent", actorId: "a1", action: "agent.paused", entityType: "agent", entityId: "a1" }), names)).toMatchObject({
      who: "Quant Researcher",
      verb: "paused",
      target: "Quant Researcher",
      href: "/agents/quant",
      tone: "gray",
      actorAgentId: "a1",
    });
  });

  it("names and links one of your chats as the chat", () => {
    const withChats = { ...names, chatAgent: (id: string) => (id === "chat1" ? "a1" : undefined) };
    expect(activityLine(event({ action: "issue.comment_added", entityId: "chat1", details: { identifier: "TES-13" } }), withChats)).toMatchObject({
      target: "your chat with Quant Researcher",
      href: "/agents/quant",
    });
    expect(activityLine(event({ details: { identifier: "TES-4" } }), withChats)?.href).toBe("/issues/TES-4");
  });

  it("says what a status change did", () => {
    expect(activityLine(event({ action: "issue.updated", details: { identifier: "TES-4", changes: { status: { from: "todo", to: "done" } } } }), names)).toMatchObject({ verb: "finished", tone: "green" });
  });

  it("leaves out reads and housekeeping unless asked to keep them", () => {
    expect(activityLine(event({ action: "issue.read_marked" }), names)).toBeNull();
    expect(activityLine(event({ action: "issue.inbox_archived" }), names)).toBeNull();
    expect(activityLine(event({ action: "issue.file_resource_list" }), names)).toBeNull();
    expect(activityLine(event({ action: "inbox.snoozed", entityType: "company" }), names)).toBeNull();
    expect(activityLine(event({ action: "issue.file_resource_list", details: { identifier: "TES-11" } }), names, { keepQuiet: true })).toMatchObject({ verb: "listed the files of", target: "TES-11" });
    expect(isQuietAction("provider_trace.metadata_listed")).toBe(true);
    expect(isQuietAction("issue.created")).toBe(false);
  });

  it("falls back to the action's words", () => {
    expect(activityLine(event({ action: "secret.rotated", entityType: "secret", details: { name: "API_KEY" } }), names)).toMatchObject({ verb: "rotated", target: "API_KEY" });
  });

  it("reads the log's snippets: task title, comment, document, run and who it was for", () => {
    const line = activityLine(
      event({
        actorType: "agent",
        actorId: "a1",
        agentId: "a1",
        runId: "r1",
        responsibleUserId: "u2",
        action: "issue.comment_added",
        entity: { issue: { id: "i1", identifier: "TES-11", title: "Summarise the files" }, comment: { id: "c1", excerpt: "  Done, see the plan. " }, document: null },
      }),
      names,
    );
    expect(line).toMatchObject({ target: "TES-11", title: "Summarise the files", excerpt: "Done, see the plan.", runId: "r1", onBehalfOf: "Maya R.", href: "/issues/TES-11" });
    expect(activityLine(event({ responsibleUserId: "u1" }), names)?.onBehalfOf).toBeUndefined();
    const doc = activityLine(event({ action: "issue.document_created", entity: { issue: { id: "i1", identifier: "TES-2", title: null }, comment: null, document: { id: "d", key: "plan" } } }), names);
    expect(doc).toMatchObject({ verb: "created a document for", document: "plan" });
  });

  it("links projects, recurring tasks and skills, and names Paperclip and plugins", () => {
    expect(activityLine(event({ action: "project.updated", entityType: "project", entityId: "p1", details: { name: "Site" } }), names)).toMatchObject({ target: "Site", href: "/projects/p1" });
    expect(activityLine(event({ action: "routine.created", entityType: "routine", entityId: "r1", details: { title: "Weekly" } }), names)?.href).toBe("/routines/r1");
    expect(activityLine(event({ action: "company.skill_deleted", entityType: "company_skill", entityId: "s1", details: { name: "notes" } }), names)).toMatchObject({ verb: "deleted the skill", href: "/skills/s1" });
    expect(activityLine(event({ actorType: "system", actorId: "system", action: "cost.reported", entityType: "cost_event" }), names, { keepQuiet: true })).toMatchObject({ who: "Paperclip", verb: "reported a cost" });
    expect(activityLine(event({ actorType: "plugin", actorId: "p", action: "issue.created" }), names)?.who).toBe("A plugin");
    expect(activityLine(event({ actorType: "user", actorId: "u1", action: "heartbeat.invoked", entityType: "heartbeat_run", entityId: "run9", details: { agentId: "a1" } }), names)).toMatchObject({
      verb: "started a run for",
      target: "Quant Researcher",
      runId: "run9",
    });
  });
});
