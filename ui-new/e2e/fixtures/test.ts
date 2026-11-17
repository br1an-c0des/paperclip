import { test as base, expect } from "@playwright/test";
import { installDefaultHandlers, type MockDb, type MockOptions } from "./handlers";
import { MockApi } from "./mock-api";

/*
 * The suite's `test`. Every test gets:
 *
 * - `api`: the fake Paperclip API (fixtures/mock-api.ts), with the default handlers installed
 *   before the page loads. Override one with `api.get(...)`, read what was sent with
 *   `api.writes` or `api.waitForWrite(...)`.
 * - `db`: the records the default handlers serve and change, a fresh copy per test.
 * - `phone`: whether the test runs in the phone project.
 *
 * A test fails if the page asked for something no handler answers, or threw an uncaught error.
 * `test.use({ mock: { signedOut: true } })` changes how the default handlers start.
 */

export const LIVE = process.env.E2E_LIVE === "1";

type Fixtures = {
  mock: MockOptions;
  api: MockApi;
  db: MockDb;
  phone: boolean;
};

type Internal = { mockSetup: { api: MockApi; db: MockDb } };

export const test = base.extend<Fixtures & Internal>({
  mock: [{}, { option: true }],
  mockSetup: async ({ context, mock }, use) => {
    const api = new MockApi({ live: LIVE });
    const db = installDefaultHandlers(api, mock);
    await api.install(context);
    await use({ api, db });
    expect(api.unmocked, "requests the fake API has no fixture for (add one in e2e/fixtures/handlers.ts)").toEqual([]);
  },
  api: async ({ mockSetup }, use) => use(mockSetup.api),
  db: async ({ mockSetup }, use) => use(mockSetup.db),
  phone: async ({}, use, testInfo) => {
    await use(testInfo.project.name === "phone");
  },
  // The fake API is in place before any navigation, and uncaught page errors fail the test.
  page: async ({ page, mockSetup }, use) => {
    void mockSetup;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await use(page);
    expect(errors, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };
