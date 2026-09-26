import type { Pool } from "pg";
import { now } from "./clock";
import { renderNotice, resolveNotice, type QueuedJob } from "./notifications";
import { OutboundRefused, sendThroughBoundary, TransientTransportError } from "./outbound/boundary";

const RETRY_BACKOFF_MS = 2 * 60 * 1000;

interface JobRow {
  id: string;
  run_id: string;
  showing_id: string;
  showing_version: number;
  kind: QueuedJob["kind"];
  payload: QueuedJob["payload"];
  attempts: number;
  max_attempts: number;
}

async function claim(pool: Pool, at: Date): Promise<JobRow | null> {
  const r = await pool.query<JobRow>(
    `UPDATE notification_jobs SET status = 'running', attempts = attempts + 1, locked_at = $1
     WHERE id = (
       SELECT id FROM notification_jobs
       WHERE status = 'queued' AND run_at <= $1
       ORDER BY run_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [at],
  );
  return r.rows[0] ?? null;
}

async function finish(pool: Pool, id: string, status: string, at: Date, error: string | null) {
  await pool.query("UPDATE notification_jobs SET status = $2, finished_at = $3, last_error = $4 WHERE id = $1", [id, status, at, error]);
}

/** Processes one due job. Returns false when nothing is due. */
export async function processNextJob(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const at = await now(pool);
  const row = await claim(pool, at);
  if (!row) return false;

  // Render from the job's snapshot, but only after checking that the snapshot is still
  // true: one primary-key read of two columns. A job is an intent written when the showing
  // was booked or moved; by the time it runs, or retries, the showing may have changed.
  const job: QueuedJob = { id: Number(row.id), kind: row.kind, showingVersion: row.showing_version, payload: row.payload };
  const current = await pool.query<{ version: number; status: "booked" | "cancelled" }>(
    "SELECT version, status FROM showings WHERE id = $1",
    [row.showing_id],
  );
  const resolution = resolveNotice(job, current.rows[0] ?? null);
  if (!resolution.send) {
    await finish(pool, row.id, "superseded", at, resolution.reason);
    return true;
  }

  try {
    await sendThroughBoundary(pool, renderNotice(job.kind, resolution.facts), { runId: row.run_id, jobId: job.id }, env);
    await finish(pool, row.id, "sent", at, null);
  } catch (error) {
    if (error instanceof OutboundRefused) {
      await finish(pool, row.id, "blocked", at, error.message);
    } else if (error instanceof TransientTransportError && row.attempts < row.max_attempts) {
      await pool.query(
        "UPDATE notification_jobs SET status = 'queued', run_at = $2, last_error = $3, locked_at = NULL WHERE id = $1",
        [row.id, new Date(at.getTime() + RETRY_BACKOFF_MS * row.attempts), error.message],
      );
    } else {
      await finish(pool, row.id, "failed", at, error instanceof Error ? error.message : String(error));
    }
  }
  return true;
}

export async function drainDueJobs(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let n = 0;
  while (await processNextJob(pool, env)) n++;
  return n;
}
