import { readFileSync } from "node:fs";
import { Pool } from "pg";

/**
 * Test data lives under a run id. Every row a test creates carries it, so a run can
 * find and remove exactly its own rows, including after a failure halfway through
 * seeding, without touching anyone else's.
 */
let pool: Pool | undefined;
export function testPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for these tests");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  }
  return pool;
}

export async function closeTestPool() {
  await pool?.end();
  pool = undefined;
}

export async function applySchema() {
  await testPool().query(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
}

export function newRunId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return `run-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface UnitSeed {
  label: string;
  address: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  terminationBasis: "tenant_notice" | "landlord_notice" | "agreement" | null;
  leaseEnd: string | null;
}

export const UNIT_B: UnitSeed = {
  label: "Unit B",
  address: "41 Hollow Crescent",
  tenantName: "Maya Chen",
  tenantEmail: "maya.chen@tenants.example.test",
  tenantPhone: "+15550100141",
  terminationBasis: "tenant_notice",
  leaseEnd: "2027-04-30",
};

export const UNIT_A_NO_NOTICE: UnitSeed = {
  label: "Unit A",
  address: "18 Elm Row",
  tenantName: "Sam Okafor",
  tenantEmail: "sam.okafor@tenants.example.test",
  tenantPhone: "+15550100118",
  terminationBasis: null,
  leaseEnd: "2026-10-31",
};

export async function seedUnits(runId: string, units: UnitSeed[], opts: { failAfter?: number } = {}): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  let n = 0;
  for (const u of units) {
    if (opts.failAfter !== undefined && n >= opts.failAfter) {
      throw new Error(`seed interrupted after ${n} of ${units.length} units (simulated)`);
    }
    const r = await testPool().query<{ id: string }>(
      `INSERT INTO units (run_id, label, address, tenant_name, tenant_email, tenant_phone, termination_basis, lease_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [runId, u.label, u.address, u.tenantName, u.tenantEmail, u.tenantPhone, u.terminationBasis, u.leaseEnd],
    );
    ids[u.label] = Number(r.rows[0].id);
    n++;
  }
  return ids;
}

export async function injectTransportFault(runId: string, kind: string, times: number) {
  await testPool().query("INSERT INTO transport_faults (run_id, kind, remaining) VALUES ($1, $2, $3)", [runId, kind, times]);
}

export async function rowsForRun(runId: string): Promise<number> {
  const r = await testPool().query<{ n: string }>(
    `SELECT (SELECT count(*) FROM units WHERE run_id = $1) + (SELECT count(*) FROM showings WHERE run_id = $1)
          + (SELECT count(*) FROM notification_jobs WHERE run_id = $1) + (SELECT count(*) FROM outbound_captures WHERE run_id = $1)
          + (SELECT count(*) FROM outbound_refusals WHERE run_id = $1) + (SELECT count(*) FROM transport_faults WHERE run_id = $1) AS n`,
    [runId],
  );
  return Number(r.rows[0].n);
}

export async function cleanupRun(runId: string) {
  const p = testPool();
  for (const table of ["outbound_captures", "outbound_refusals", "transport_faults", "notification_jobs", "showings", "units"]) {
    await p.query(`DELETE FROM ${table} WHERE run_id = $1`, [runId]);
  }
}

export async function setTestClock(at: Date | null) {
  await testPool().query("UPDATE app_clock SET frozen_at = $1 WHERE id = 1", [at]);
}

export interface CapturedNotice {
  channel: string;
  recipients: string[];
  text: string;
}

export async function capturesFor(runId: string, showingId?: number): Promise<CapturedNotice[]> {
  const r = await testPool().query<{ channel: string; recipients: string[]; payload: Record<string, unknown> }>(
    `SELECT c.channel, c.recipients, c.payload FROM outbound_captures c
     JOIN notification_jobs j ON j.id = c.job_id
     WHERE c.run_id = $1 AND ($2::bigint IS NULL OR j.showing_id = $2)
     ORDER BY c.id`,
    [runId, showingId ?? null],
  );
  return r.rows.map((row) => ({ channel: row.channel, recipients: row.recipients, text: textOf(row.channel, row.payload) }));
}

function textOf(channel: string, payload: Record<string, any>): string {
  if (channel === "twilio.sms") return payload.body;
  if (channel === "sendgrid.mail") return payload.content[0].value;
  if (channel === "graph.createEvent") return `${payload.subject} ${payload.start.dateTime}`;
  return JSON.stringify(payload);
}

export async function jobsFor(runId: string) {
  return (
    await testPool().query<{ id: string; kind: string; showing_version: number; status: string; attempts: number; last_error: string | null }>(
      "SELECT id, kind, showing_version, status, attempts, last_error FROM notification_jobs WHERE run_id = $1 ORDER BY id",
      [runId],
    )
  ).rows;
}

export async function refusalsFor(runId: string) {
  return (await testPool().query<{ channel: string; reason: string }>("SELECT channel, reason FROM outbound_refusals WHERE run_id = $1 ORDER BY id", [runId])).rows;
}

/** Waits until the worker has nothing due for this run. */
export async function waitForWorker(runId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await testPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM notification_jobs j, app_clock c
       WHERE j.run_id = $1 AND (j.status = 'running' OR (j.status = 'queued' AND j.run_at <= coalesce(c.frozen_at, now())))`,
      [runId],
    );
    if (Number(r.rows[0].n) === 0) return;
    if (Date.now() > deadline) throw new Error(`worker did not drain run ${runId} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
