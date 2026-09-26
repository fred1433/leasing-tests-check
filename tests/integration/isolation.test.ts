import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Third control: the process that sends has no route to the internet. Code that
 * bypasses the sending boundary and calls a provider directly still cannot connect.
 */
const supported = process.platform === "linux" || process.platform === "darwin";
if (process.env.REQUIRE_NET_ISOLATION === "1" && !supported) throw new Error("network isolation required but unsupported here");

describe.runIf(supported)("worker network isolation", () => {
  it("blocks every provider and the open internet, keeps the database socket", () => {
    const out = execFileSync("scripts/run-isolated.sh", ["node", "scripts/egress-probe.mjs"], {
      env: { ...process.env, PGSOCKET_PATH: process.env.PGSOCKET_PATH ?? "" },
      encoding: "utf8",
      timeout: 30_000,
    });
    const result = JSON.parse(out.trim().split("\n").pop()!);
    for (const host of ["api.twilio.com", "api.sendgrid.com", "graph.microsoft.com", "api.clerk.com", "1.1.1.1"]) {
      expect(result[host], host).not.toBe("connected");
    }
    if (process.env.PGSOCKET_PATH) expect(result.database_socket).toBe("connected");
  });

  it("the control: the same probe outside isolation reaches the internet", () => {
    if (process.env.SKIP_EGRESS_CONTROL === "1") return;
    const out = execFileSync("node", ["scripts/egress-probe.mjs"], { encoding: "utf8", timeout: 30_000 });
    expect(JSON.parse(out.trim())["1.1.1.1"]).toBe("connected");
  });
});
