import { describe, expect, it } from "vitest";
import { revokeTestUserSessions } from "../support/clerk-sessions";

type Route = (url: string, init?: RequestInit) => Response;

function fakeClerk(overrides: { revokeStatus?: number; usersStatus?: number; stillActive?: boolean } = {}) {
  let listed = 0;
  const calls: string[] = [];
  const route: Route = (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.clerk.com/v1", "")}`);
    if (url.includes("/users?")) {
      return new Response(JSON.stringify([{ id: "user_1" }]), { status: overrides.usersStatus ?? 200 });
    }
    if (url.includes("/sessions?")) {
      listed++;
      const active = listed === 1 || overrides.stillActive ? [{ id: "sess_a" }, { id: "sess_b" }] : [];
      return new Response(JSON.stringify(active), { status: 200 });
    }
    if (url.endsWith("/revoke")) return new Response("{}", { status: overrides.revokeStatus ?? 200 });
    return new Response("not found", { status: 404 });
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => route(String(input), init)) as typeof fetch;
  return { fetchImpl, calls };
}

const base = { secretKey: "sk_test_fake", email: "leasing-qa+clerk_test@example.com" };

describe("test-user session revocation", () => {
  it("revokes every active session and confirms none is left", async () => {
    const clerk = fakeClerk();
    await expect(revokeTestUserSessions({ ...base, fetchImpl: clerk.fetchImpl })).resolves.toBe(2);
    expect(clerk.calls.filter((c) => c.startsWith("POST"))).toHaveLength(2);
  });

  it("fails when a revocation call fails", async () => {
    const clerk = fakeClerk({ revokeStatus: 500 });
    await expect(revokeTestUserSessions({ ...base, fetchImpl: clerk.fetchImpl })).rejects.toThrow(/Clerk 500 revoking session sess_a/);
  });

  it("fails when the user lookup fails, instead of reporting zero sessions", async () => {
    const clerk = fakeClerk({ usersStatus: 401 });
    await expect(revokeTestUserSessions({ ...base, fetchImpl: clerk.fetchImpl })).rejects.toThrow(/Clerk 401/);
  });

  it("fails when sessions are still active after revocation", async () => {
    const clerk = fakeClerk({ stillActive: true });
    await expect(revokeTestUserSessions({ ...base, fetchImpl: clerk.fetchImpl })).rejects.toThrow(/still active/);
  });
});
