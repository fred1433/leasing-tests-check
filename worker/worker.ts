/**
 * Notification worker. The only process that sends.
 * Run it through scripts/run-isolated.sh so it has no route to the internet:
 * even code that bypasses the sending boundary cannot reach a provider.
 */
import net from "node:net";
import { db } from "../lib/db";
import { deploymentIdentity } from "../lib/deployment";
import { processNextJob } from "../lib/worker-core";

async function egressBlocked(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "1.1.1.1", port: 443, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(true));
  });
}

async function main() {
  const identity = deploymentIdentity();
  const isolated = await egressBlocked();
  if (process.env.REQUIRE_NET_ISOLATION === "1" && !isolated) {
    console.error("worker: REQUIRE_NET_ISOLATION=1 but this process can reach the internet. Refusing to start.");
    process.exit(2);
  }
  const pool = db();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS worker_heartbeats (
       pid int PRIMARY KEY, deployment_id text, egress_blocked boolean, beat_at timestamptz,
       stop_requested boolean NOT NULL DEFAULT false)`,
  );
  console.log(`worker: ${identity.target} ${identity.deploymentId}, egress ${isolated ? "blocked" : "OPEN"}`);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  while (!stopping) {
    // In CI the worker runs as another user inside a network namespace, so the test runner
    // cannot signal it. It stops when asked through the database instead.
    const beat = await pool.query<{ stop_requested: boolean }>(
      `INSERT INTO worker_heartbeats (pid, deployment_id, egress_blocked, beat_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (pid) DO UPDATE SET beat_at = now(), egress_blocked = $3
       RETURNING stop_requested`,
      [process.pid, identity.deploymentId, isolated],
    );
    if (beat.rows[0]?.stop_requested) break;
    try {
      while (!stopping && (await processNextJob(pool))) {}
    } catch (error) {
      console.error("worker: loop error", error);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await pool.query("DELETE FROM worker_heartbeats WHERE pid = $1", [process.pid]);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
