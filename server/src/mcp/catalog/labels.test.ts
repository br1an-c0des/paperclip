import { describe, expect, it } from "vitest";
import { McpToolError } from "../dispatch.js";
import { LABEL_TOOLS } from "./labels.js";
import { TEST_COMPANY_ID, recordingDispatch, testCaller } from "./test-support.js";

const manage = LABEL_TOOLS.find(definition => definition.name === "paperclip_manage_labels")!;
const BUG = "77777777-7777-4777-8777-777777777777";
const FEATURE = "88888888-8888-4888-8888-888888888888";

describe("paperclip_manage_labels", () => {
  it("renames and recolours through PATCH /labels/:labelId", async () => {
    // The route answers with the whole label; the tool returns id, name and color.
    const api = recordingDispatch(({ path, body }) => ({
      id: path.split("/").pop(), name: "kept", color: "#000000", ...(body as object), companyId: TEST_COMPANY_ID,
    }));
    const result = await manage.run(testCaller({ access: { level: "manager" } }), manage.input.parse({
      update: [{ labelId: BUG, name: " defect " }, { labelId: FEATURE, color: "#00ff00" }],
    }), api);
    expect(api.calls).toEqual([
      { method: "PATCH", path: `/labels/${BUG}`, body: { name: "defect" } },
      { method: "PATCH", path: `/labels/${FEATURE}`, body: { color: "#00ff00" } },
    ]);
    expect(result).toEqual({
      created: [],
      updated: [{ id: BUG, name: "defect", color: "#000000" }, { id: FEATURE, name: "kept", color: "#00ff00" }],
      deleted: [],
    });
  });

  it("creates, then updates, then deletes", async () => {
    const api = recordingDispatch(() => ({ id: BUG, name: "bug", color: "#ff0000" }));
    await manage.run(testCaller(), manage.input.parse({
      delete: [FEATURE], update: [{ labelId: BUG, name: "defect", color: "#ff0000" }], create: [{ name: "bug", color: "#ff0000" }],
    }), api);
    expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual([
      `POST /companies/${TEST_COMPANY_ID}/labels`, `PATCH /labels/${BUG}`, `DELETE /labels/${FEATURE}`,
    ]);
  });

  it("an update needs a name or a color, and the call needs some change", () => {
    expect(() => manage.input.parse({ update: [{ labelId: BUG }] })).toThrow(/name or color/);
    expect(() => manage.input.parse({ update: [{ labelId: BUG, color: "red" }] })).toThrow();
    expect(() => manage.input.parse({ update: [] })).toThrow(/create, update or delete/);
  });

  it("a name clash comes back as a clear label_name_taken error", async () => {
    const api = recordingDispatch(({ method }) => {
      if (method === "PATCH") {
        throw new McpToolError({ status: 409, code: "label_name_taken", message: 'A label named "bug" already exists in this company.' });
      }
      return {};
    });
    const error = await manage.run(testCaller(), manage.input.parse({ update: [{ labelId: FEATURE, name: "bug" }], delete: [BUG] }), api)
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(McpToolError);
    expect(error).toMatchObject({ status: 409, code: "label_name_taken" });
    expect((error as Error).message).toMatch(new RegExp(`Can't rename label ${FEATURE} to "bug": another label`));
    expect((error as Error).message).not.toMatch(/already made/);
    // Nothing after the clash runs.
    expect(api.calls.map(call => call.method)).toEqual(["PATCH"]);
  });

  it("says when earlier changes were made before a clash", async () => {
    const api = recordingDispatch(({ path }) => {
      if (path === `/labels/${FEATURE}`) throw new McpToolError({ status: 409, code: "label_name_taken", message: "taken" });
      return { id: BUG, name: "defect", color: "#ff0000" };
    });
    await expect(manage.run(testCaller(), manage.input.parse({
      update: [{ labelId: BUG, name: "defect" }, { labelId: FEATURE, name: "defect" }],
    }), api)).rejects.toThrow(/Changes before this one were already made/);
  });

  it("other failures pass through unchanged", async () => {
    const notFound = new McpToolError({ status: 404, message: "Label not found" });
    const api = recordingDispatch(() => { throw notFound; });
    await expect(manage.run(testCaller(), manage.input.parse({ update: [{ labelId: BUG, color: "#123456" }] }), api)).rejects.toBe(notFound);
  });
});
