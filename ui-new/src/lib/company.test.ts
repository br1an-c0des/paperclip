import type { Company } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { findCompanyByPrefix } from "./company";

const companies = [
  { id: "1", issuePrefix: "GEA" },
  { id: "2", issuePrefix: "TRA" },
] as Company[];

describe("findCompanyByPrefix", () => {
  it("matches the prefix in any case", () => {
    expect(findCompanyByPrefix(companies, "gea")?.id).toBe("1");
    expect(findCompanyByPrefix(companies, "TRA")?.id).toBe("2");
  });

  it("is undefined for an unknown prefix or before companies load", () => {
    expect(findCompanyByPrefix(companies, "XYZ")).toBeUndefined();
    expect(findCompanyByPrefix(undefined, "GEA")).toBeUndefined();
  });
});
