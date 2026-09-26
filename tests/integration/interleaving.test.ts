import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookShowing, rescheduleShowing } from "@/lib/showings";
import { drainDueJobs, processNextJob } from "@/lib/worker-core";
import { zonedInstant } from "@/lib/time";
import { applySchema, capturesFor, cleanupRun, closeTestPool, jobsFor, newRunId, seedUnits, setTestClock, testPool, UNIT_B } from "../support/data";

/**
 * The check-to-send window, forced open deterministically. The worker reads the showing's
 * version, then sends; a move that commits in between must not let the old notice out.
 */
const ENV = {
  ...process.env,
  DEPLOYMENT_TARGET: "test",
  DEPLOYMENT_ID: "vitest",
  OUTBOUND_ALLOWLIST: "email:*@tenants.example.test,email:*@prospects.example.test,email:*@office.example.test,sms:+1555010*",
} as NodeJS.ProcessEnv;

async function someoneWaitsOnALock(): Promise<boolean> {
  const r = await testPool().query(
    "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return (r.rowCount ?? 0) > 0;
}

/** Resolves "waiting" once another transaction is blocked on a lock, "finished" if the promise settles first. */
async function blockedOrFinished(p: Promise<unknown>): Promise<"waiting" | "finished"> {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  for (let i = 0; i < 200; i++) {
    if (settled) return "finished";
    if (await someoneWaitsOnALock()) return "waiting";
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("neither blocked nor finished within 4 s");
}

describe.runIf(process.env.DATABASE_URL)("worker and reschedule racing on the same showing", () => {
  const runs: string[] = [];
  const saved = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, { DEPLOYMENT_TARGET: "test", DEPLOYMENT_ID: "vitest" });
    await applySchema();
  });
  afterAll(async () => {
    await setTestClock(null);
    for (const id of runs) await cleanupRun(id);
    process.env = saved;
    await closeTestPool();
  });

  async function dueOldNotice(label: string) {
    const runId = newRunId(label);
    runs.push(runId);
    const ids = await seedUnits(runId, [UNIT_B]);
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    const showingId = await bookShowing(testPool(), {
      unitId: ids["Unit B"],
      prospectName: "Jordan Lee",
      prospectEmail: "jordan.lee@prospects.example.test",
      agentEmail: "agent@office.example.test",
      startsAt: zonedInstant(2026, 10, 6, 14),
      createdBy: "user_vitest",
    });
    await drainDueJobs(testPool(), ENV); // the calendar invite, due now
    await setTestClock(zonedInstant(2026, 10, 5, 10, 5)); // the tenant notices for Tuesday are due
    // The worker takes the earliest due job of any run: this run's text must be the only candidate.
    const others = await testPool().query(
      "SELECT count(*)::int AS n FROM notification_jobs WHERE status = 'queued' AND run_at <= $1 AND NOT (run_id = $2 AND kind = 'tenant_sms')",
      [zonedInstant(2026, 10, 5, 10, 5), runId],
    );
    if (others.rows[0].n > 0) {
      await testPool().query(
        "UPDATE notification_jobs SET run_at = run_at + interval '1 day' WHERE status = 'queued' AND run_at <= $1 AND NOT (run_id = $2 AND kind = 'tenant_sms')",
        [zonedInstant(2026, 10, 5, 10, 5), runId],
      );
    }
    return { runId, showingId };
  }

  it("a move that locks the showing first wins: the worker waits, then drops the old notice", async () => {
    const { runId, showingId } = await dueOldNotice("move first");
    const move = await testPool().connect();
    try {
      await move.query("BEGIN");
      await move.query("SELECT 1 FROM showings WHERE id = $1 FOR UPDATE", [showingId]);
      await move.query("UPDATE showings SET version = version + 1, starts_at = $2 WHERE id = $1", [showingId, zonedInstant(2026, 10, 8, 16)]);
      const worker = processNextJob(testPool(), ENV);
      expect(await blockedOrFinished(worker)).toBe("waiting");
      await move.query("COMMIT");
      await worker;
    } finally {
      move.release();
    }
    const sms = (await jobsFor(runId)).find((j) => j.kind === "tenant_sms");
    expect(sms).toMatchObject({ status: "superseded" });
    expect((await capturesFor(runId, showingId)).map((c) => c.channel)).not.toContain("twilio.sms");
  });

  it("a move that arrives while the worker is deciding waits until the notice is committed", async () => {
    const { runId, showingId } = await dueOldNotice("send first");
    let moveOutcome: "waiting" | "finished" | undefined;
    let move: Promise<void> | undefined;
    await processNextJob(testPool(), ENV, {
      afterDecision: async () => {
        move = rescheduleShowing(testPool(), showingId, zonedInstant(2026, 10, 8, 16));
        moveOutcome = await blockedOrFinished(move);
      },
    });
    await move;
    // The move could not slip between the check and the send: it was held until the worker committed.
    expect(moveOutcome).toBe("waiting");
    const texts = (await capturesFor(runId, showingId)).filter((c) => c.channel === "twilio.sms").map((c) => c.text);
    expect(texts).toEqual([expect.stringContaining("Tuesday, October 6, 2:00 p.m.")]);
    // The notice was true when committed; the move then queued its own notices for the new time.
    expect((await jobsFor(runId)).filter((j) => j.showing_version === 2 && j.status === "queued").map((j) => j.kind)).toEqual([
      "tenant_sms",
      "tenant_email",
      "calendar_event",
    ]);
  });
});
