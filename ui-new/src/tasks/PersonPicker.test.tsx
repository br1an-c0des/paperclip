import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const users = [
  { principalId: "u2", status: "active", membershipRole: "member", user: { id: "u2", name: "Zoe Park", email: "zoe@example.test", image: null } },
  { principalId: "me", status: "active", membershipRole: "owner", user: { id: "me", name: "Brian", email: "brian@example.test", image: "/api/assets/a1/content" } },
  { principalId: "u3", status: "active", membershipRole: "member", user: { id: "u3", name: null, email: "ada@example.test", image: "https://elsewhere.test/a.png" } },
];

vi.mock("@/lib/company-data", () => ({ usePeopleQuery: () => ({ data: { users }, isPending: false, fetchStatus: "idle", error: null }) }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ youId: () => "me" }) }));

const { PersonPicker } = await import("./PersonPicker");

describe("PersonPicker", () => {
  it("lists you first, then everyone by name, and marks the chosen one", () => {
    render(() => <PersonPicker label="Runs for" selected="u2" onPick={() => undefined} />);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.querySelector(".nt-option-label")?.textContent)).toEqual(["You (Brian)", "ada@example.test", "Zoe Park"]);
    expect(options[2]!.getAttribute("aria-selected")).toBe("true");
  });

  it("finds people by name or email, and picks one", () => {
    const onPick = vi.fn();
    render(() => <PersonPicker label="Runs for" selected={null} onPick={onPick} />);
    fireEvent.input(screen.getByRole("searchbox", { name: "Find runs for" }), { target: { value: "zoe@" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]!);
    expect(onPick).toHaveBeenCalledWith({ id: "u2", name: "Zoe Park" });
  });

  it("shows only Paperclip-hosted photos, else initials", () => {
    render(() => <PersonPicker label="Runs for" selected={null} onPick={() => undefined} />);
    const [you, ada] = screen.getAllByRole("option");
    expect(you!.querySelector("img.person-avatar")?.getAttribute("src")).toBe("/api/assets/a1/content");
    expect(ada!.querySelector("img")).toBeNull();
    expect(ada!.querySelector(".disc-avatar")).not.toBeNull();
  });
});
