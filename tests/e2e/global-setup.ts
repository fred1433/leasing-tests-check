import { clerkSetup } from "@clerk/testing/playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { applySchema, closeTestPool, testPool } from "../support/data";

/**
 * 1. The test identity must be one Clerk never messages: a "+clerk_test" address
 *    signs in with a password, and any verification code is the fixed test code, not an email.
 * 2. Schema, then Clerk's testing token.
 * 3. The server under test must be the build of this run (same DEPLOYMENT_ID).
 * 4. The notification worker, started inside the network sandbox, must report in
 *    before any test runs; in CI it must also report that its egress is blocked.
 */
export default async function globalSetup() {
  const identity = process.env.E2E_CLERK_USER_EMAIL ?? "";
  if (!/\+clerk_test@/.test(identity)) {
    throw new Error("E2E_CLERK_USER_EMAIL must be a +clerk_test address so Clerk sends no email during tests");
  }
  if (!process.env.E2E_CLERK_USER_PASSWORD) throw new Error("E2E_CLERK_USER_PASSWORD is missing");

  const baseURL = `http://localhost:${process.env.PORT ?? 3100}`;
  const served = (await (await fetch(`${baseURL}/api/version`)).json()) as { deploymentId: string };
  if (served.deploymentId !== process.env.DEPLOYMENT_ID) {
    throw new Error(`the server under test is ${served.deploymentId}, expected ${process.env.DEPLOYMENT_ID}: stale server?`);
  }

  await applySchema();
  await testPool().query("DELETE FROM worker_heartbeats WHERE true").catch(() => undefined);
  await clerkSetup();

  let worker: ChildProcess | undefined;
  if (process.env.E2E_WORKER !== "external") {
    worker = spawn("scripts/run-isolated.sh", ["pnpm", "exec", "tsx", "worker/worker.ts"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
      detached: true,
    });
  }

  const deadline = Date.now() + 30_000;
  for (;;) {
    const r = await testPool()
      .query<{ egress_blocked: boolean }>("SELECT egress_blocked FROM worker_heartbeats WHERE beat_at > now() - interval '5 seconds'")
      .catch(() => ({ rows: [] as { egress_blocked: boolean }[] }));
    if (r.rows.length) {
      if (process.env.REQUIRE_NET_ISOLATION === "1" && !r.rows.every((row) => row.egress_blocked)) {
        throw new Error("the notification worker can reach the internet");
      }
      break;
    }
    if (Date.now() > deadline) throw new Error("the notification worker did not start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  worker?.unref();
  return async () => {
    await testPool().query("UPDATE worker_heartbeats SET stop_requested = true").catch(() => undefined);
    const until = Date.now() + 5_000;
    while (Date.now() < until) {
      const left = await testPool().query("SELECT 1 FROM worker_heartbeats").catch(() => ({ rowCount: 0 }));
      if (!left.rowCount) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (worker?.pid) {
      try {
        process.kill(-worker.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await closeTestPool();
  };
}
