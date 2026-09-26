import type { Pool, PoolClient } from "pg";
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

async function finish(pool: Pool | PoolClient, id: string, status: string, at: Date, error: string | null) {
  await pool.query("UPDATE notification_jobs SET status = $2, finished_at = $3, last_error = $4 WHERE id = $1", [id, status, at, error]);
}

export interface WorkerHooks {
  /** Test seam: runs after the currency decision, while the showing row is still locked. */
  afterDecision?: () => Promise<void>;
}

/**
 * Processes one due job. Returns false when nothing is due.
 *
 * The currency check and the outbound intent are one transaction: the worker reads the showing
 * with FOR SHARE, and rescheduling or cancelling takes FOR UPDATE on the same row. So either
 * the move commits first and the worker then reads the new version (the old notice is
 * superseded), or the worker commits its intent first and the move waits for it (the notice
 * was true when it was committed; the move then queues its own notices). A move can no longer
 * slip in between the read and the send.
 */
export async function processNextJob(pool: Pool, env: NodeJS.ProcessEnv = process.env, hooks: WorkerHooks = {}): Promise<boolean> {
  const at = await now(pool);
  const row = await claim(pool, at);
  if (!row) return false;

  const job: QueuedJob = { id: Number(row.id), kind: row.kind, showingVersion: row.showing_version, payload: row.payload };
  const tx = await pool.connect();
  let transient: TransientTransportError | null = null;
  try {
    await tx.query("BEGIN");
    // One primary-key read of two columns, locked against a concurrent move until this job commits.
    const current = await tx.query<{ version: number; status: "booked" | "cancelled" }>(
      "SELECT version, status FROM showings WHERE id = $1 FOR SHARE",
      [row.showing_id],
    );
    const resolution = resolveNotice(job, current.rows[0] ?? null);
    await hooks.afterDecision?.();
    if (!resolution.send) {
      await finish(tx, row.id, "superseded", at, resolution.reason);
    } else {
      try {
        await sendThroughBoundary(pool, renderNotice(job.kind, resolution.facts), { runId: row.run_id, jobId: job.id, tx }, env);
        await finish(tx, row.id, "sent", at, null);
      } catch (error) {
        if (error instanceof OutboundRefused) {
          await finish(tx, row.id, "blocked", at, error.message);
        } else if (error instanceof TransientTransportError) {
          transient = error;
        } else {
          throw error;
        }
      }
    }
    if (transient) await tx.query("ROLLBACK");
    else await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    await finish(pool, row.id, "failed", at, error instanceof Error ? error.message : String(error));
    return true;
  } finally {
    tx.release();
  }

  if (transient) {
    if (row.attempts < row.max_attempts) {
      await pool.query(
        "UPDATE notification_jobs SET status = 'queued', run_at = $2, last_error = $3, locked_at = NULL WHERE id = $1",
        [row.id, new Date(at.getTime() + RETRY_BACKOFF_MS * row.attempts), transient.message],
      );
    } else {
      await finish(pool, row.id, "failed", at, transient.message);
    }
  }
  return true;
}

export async function drainDueJobs(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let n = 0;
  while (await processNextJob(pool, env)) n++;
  return n;
}
