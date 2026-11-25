import { describe, expect, it, vi } from "vitest";
import { resolveAgentAccess } from "@paperclipai/shared";
import { callTool, listTools } from "../server.js";
import { createFileTools } from "./files.js";
import type { McpCaller } from "./types.js";
import { TEST_COMPANY_ID, TEST_AGENT_ID, recordingDispatch, testCaller } from "./test-support.js";

const ATTACHMENT = "77777777-7777-4777-8777-777777777777";
const GRANT = "88888888-8888-4888-8888-888888888888";

function connectionCaller(): McpCaller {
  return {
    kind: "oauth_person", actor: { type: "board", source: "mcp_oauth", userId: "user-1", grantId: GRANT },
    companyId: TEST_COMPANY_ID, agentId: null, userId: "user-1", runId: null, grantId: GRANT,
    access: resolveAgentAccess({ level: "worker" }),
  };
}

function session(caller: McpCaller, files: Parameters<typeof createFileTools>[0]) {
  return { caller, catalog: createFileTools(files), dispatch: recordingDispatch() };
}

const names = (caller: McpCaller) => listTools(caller, createFileTools(undefined)).map(definition => definition.name);

describe("the file tools", () => {
  it("a run sees the download tool but not the upload tool", () => {
    expect(names(testCaller())).toEqual(["paperclip_file_download"]);
  });

  it("an agent key, with no run and no grant, sees neither", async () => {
    const caller = testCaller({ kind: "agent_key" });
    expect(names(caller)).toEqual([]);
    const result = await callTool(session(caller, { download: vi.fn() }), "paperclip_file_download", { attachmentId: ATTACHMENT });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "grant_required" } });
    expect(result.content[0].text).toMatch(/Needs a run or an outside connection/);
  });

  it("an outside connection still gets both", () => {
    expect(names(connectionCaller())).toEqual(["paperclip_file_upload", "paperclip_file_download"]);
  });

  it("a run's download goes to the catalog's links with the run's caller", async () => {
    const download = vi.fn(async () => ({ url: "http://paperclip.test/api/mcp/paperclip/files/download?ticket=x", method: "GET" }));
    const caller = testCaller();
    const result = await callTool(session(caller, { download }), "paperclip_file_download", { attachmentId: ATTACHMENT });
    expect(result.isError).toBeUndefined();
    expect(download).toHaveBeenCalledWith(caller, ATTACHMENT);
    expect(caller.agentId).toBe(TEST_AGENT_ID);
    expect(result.structuredContent).toMatchObject({ method: "GET" });
  });

  it("a catalog without links says so, and a run can't upload through one that has them", async () => {
    const missing = await callTool(session(testCaller(), undefined), "paperclip_file_download", { attachmentId: ATTACHMENT });
    expect(missing).toMatchObject({ isError: true, structuredContent: { code: "files_unavailable", status: 503 } });
    const upload = vi.fn();
    const refused = await callTool(session(testCaller(), { upload, download: vi.fn() }), "paperclip_file_upload", {
      taskId: ATTACHMENT, requestId: GRANT, filename: "a.txt", contentType: "text/plain", byteSize: 1, sha256: "a".repeat(64),
    });
    expect(refused).toMatchObject({ isError: true, structuredContent: { code: "grant_required" } });
    expect(upload).not.toHaveBeenCalled();
  });
});
