import type { Pool, PoolClient } from "pg";
import { now } from "./clock";
import type { JobKind, NoticeFacts } from "./notifications";
import { assessShowingBooking, type TerminationBasis } from "./policy/entry";
import { localParts, zonedInstant } from "./time";

export class BookingRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
    this.name = "BookingRefused";
  }
}

interface UnitRow {
  id: number;
  run_id: string;
  label: string;
  address: string;
  tenant_name: string;
  tenant_email: string;
  tenant_phone: string;
  termination_basis: TerminationBasis | null;
  lease_end: string | null;
}

interface ShowingRow {
  id: number;
  run_id: string;
  unit_id: number;
  prospect_name: string;
  prospect_email: string;
  agent_email: string;
  starts_at: Date;
  duration_minutes: number;
  status: "booked" | "cancelled";
  version: number;
}

/** Product rule, not a legal one: tenants hear about a showing at 10:00 the day before. */
export function noticeTime(startsAt: Date, current: Date): Date {
  const p = localParts(new Date(startsAt.getTime() - 24 * 60 * 60 * 1000));
  const planned = zonedInstant(p.year, p.month, p.day, 10, 0);
  return planned > current ? planned : current;
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function facts(unit: UnitRow, s: ShowingRow): NoticeFacts {
  return {
    showingId: Number(s.id),
    version: s.version,
    status: s.status,
    unitLabel: unit.label,
    address: unit.address,
    tenantName: unit.tenant_name,
    tenantEmail: unit.tenant_email,
    tenantPhone: unit.tenant_phone,
    prospectName: s.prospect_name,
    prospectEmail: s.prospect_email,
    agentEmail: s.agent_email,
    startsAt: new Date(s.starts_at).toISOString(),
    durationMinutes: s.duration_minutes,
  };
}

function check(unit: UnitRow, startsAt: Date, durationMinutes: number, current: Date) {
  if (startsAt <= current) throw new BookingRefused(["The showing must be in the future."]);
  // Booking is not entry: the tenant notice is only planned here, never counted as an attempt.
  const decision = assessShowingBooking({
    terminationBasis: unit.termination_basis,
    leaseEnd: unit.lease_end,
    entryStart: startsAt,
    entryEnd: new Date(startsAt.getTime() + durationMinutes * 60_000),
    plannedNoticeAt: noticeTime(startsAt, current),
  });
  if (decision.outcome === "not_bookable") throw new BookingRefused(decision.reasons);
}

async function enqueue(c: PoolClient, unit: UnitRow, s: ShowingRow, current: Date) {
  const f = facts(unit, s);
  const tenantAt = noticeTime(new Date(s.starts_at), current);
  const jobs: Array<[JobKind, Date]> = [
    ["tenant_sms", tenantAt],
    ["tenant_email", tenantAt],
    ["calendar_event", current],
  ];
  for (const [kind, runAt] of jobs) {
    await c.query(
      `INSERT INTO notification_jobs (run_id, showing_id, showing_version, kind, payload, run_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.run_id, s.id, s.version, kind, JSON.stringify(f), runAt],
    );
  }
}

async function loadUnit(c: PoolClient, unitId: number): Promise<UnitRow> {
  const r = await c.query<UnitRow>("SELECT *, lease_end::text AS lease_end FROM units WHERE id = $1", [unitId]);
  if (!r.rows[0]) throw new BookingRefused(["Unknown unit."]);
  return r.rows[0];
}

export async function bookShowing(
  pool: Pool,
  input: {
    unitId: number;
    prospectName: string;
    prospectEmail: string;
    agentEmail: string;
    startsAt: Date;
    durationMinutes?: number;
    createdBy: string;
    /** Identifies one submission of one booking form. The same key twice books once. */
    requestKey?: string;
  },
): Promise<number> {
  const current = await now(pool);
  const duration = input.durationMinutes ?? 30;
  return tx(pool, async (c) => {
    const unit = await loadUnit(c, input.unitId);
    check(unit, input.startsAt, duration, current);
    const r = await c.query<ShowingRow>(
      `INSERT INTO showings (run_id, unit_id, prospect_name, prospect_email, agent_email, starts_at, duration_minutes, created_by, request_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (request_key) DO NOTHING
       RETURNING *`,
      [unit.run_id, unit.id, input.prospectName, input.prospectEmail.trim().toLowerCase(), input.agentEmail, input.startsAt, duration, input.createdBy, input.requestKey ?? null],
    );
    if (!r.rows[0]) {
      // The same form was already submitted: return that showing, queue nothing new.
      const existing = await c.query<{ id: string }>("SELECT id FROM showings WHERE request_key = $1", [input.requestKey]);
      return Number(existing.rows[0].id);
    }
    await enqueue(c, unit, r.rows[0], current);
    return Number(r.rows[0].id);
  });
}

async function lockShowing(c: PoolClient, showingId: number): Promise<ShowingRow> {
  const r = await c.query<ShowingRow>("SELECT * FROM showings WHERE id = $1 FOR UPDATE", [showingId]);
  if (!r.rows[0]) throw new BookingRefused(["Unknown showing."]);
  if (r.rows[0].status !== "booked") throw new BookingRefused(["This showing is cancelled."]);
  return r.rows[0];
}

/** Moves a showing. Earlier jobs stay in the queue untouched; the worker decides whether they are still true. */
export async function rescheduleShowing(pool: Pool, showingId: number, startsAt: Date): Promise<void> {
  const current = await now(pool);
  await tx(pool, async (c) => {
    const s = await lockShowing(c, showingId);
    const unit = await loadUnit(c, s.unit_id);
    check(unit, startsAt, s.duration_minutes, current);
    const r = await c.query<ShowingRow>(
      "UPDATE showings SET starts_at = $2, version = version + 1 WHERE id = $1 RETURNING *",
      [showingId, startsAt],
    );
    await enqueue(c, unit, r.rows[0], current);
  });
}

export async function cancelShowing(pool: Pool, showingId: number): Promise<void> {
  await tx(pool, async (c) => {
    await lockShowing(c, showingId);
    await c.query("UPDATE showings SET status = 'cancelled', version = version + 1 WHERE id = $1", [showingId]);
  });
}
