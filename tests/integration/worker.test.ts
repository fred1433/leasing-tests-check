import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bookShowing, cancelShowing, rescheduleShowing } from "@/lib/showings";
import { drainDueJobs } from "@/lib/worker-core";
import { zonedInstant } from "@/lib/time";
import {
  applySchema,
  capturesFor,
  cleanupRun,
  closeTestPool,
  injectTransportFault,
  jobsFor,
  newRunId,
  refusalsFor,
  rowsForRun,
  seedUnits,
  setTestClock,
  testPool,
  UNIT_A_NO_NOTICE,
  UNIT_B,
} from "../support/data";

if (!process.env.DATABASE_URL && process.env.CI) throw new Error("CI must run the integration tests: DATABASE_URL is missing");

const ENV = {
  ...process.env,
  DEPLOYMENT_TARGET: "test",
  DEPLOYMENT_ID: "vitest",
  OUTBOUND_ALLOWLIST: "email:*@tenants.example.test,email:*@prospects.example.test,email:*@office.example.test,sms:+1555010*",
} as NodeJS.ProcessEnv;

describe.runIf(process.env.DATABASE_URL)("notification worker against PostgreSQL", () => {
  const runs: string[] = [];
  const saved = { ...process.env };
  const run = (label: string) => {
    const id = newRunId(label);
    runs.push(id);
    return id;
  };

  beforeAll(async () => {
    Object.assign(process.env, { DEPLOYMENT_TARGET: "test", DEPLOYMENT_ID: "vitest" });
    await applySchema();
  });
  afterEach(async () => {
    await setTestClock(null);
  });
  afterAll(async () => {
    for (const id of runs) await cleanupRun(id);
    process.env = saved;
    await closeTestPool();
  });

  async function booked(runId: string) {
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
    return showingId;
  }

  it("retries a transient provider failure and captures once", async () => {
    const runId = run("retry");
    await booked(runId);
    await injectTransportFault(runId, "tenant_sms", 2);
    await setTestClock(zonedInstant(2026, 10, 5, 10, 1));
    await drainDueJobs(testPool(), ENV);
    await setTestClock(zonedInstant(2026, 10, 5, 10, 4));
    await drainDueJobs(testPool(), ENV);
    await setTestClock(zonedInstant(2026, 10, 5, 10, 9));
    await drainDueJobs(testPool(), ENV);
    const sms = (await jobsFor(runId)).find((j) => j.kind === "tenant_sms");
    expect(sms).toMatchObject({ status: "sent", attempts: 3 });
    expect((await capturesFor(runId)).filter((c) => c.channel === "twilio.sms")).toHaveLength(1);
  });

  it("gives up after the last attempt and records the failure, without a capture", async () => {
    const runId = run("exhausted");
    await booked(runId);
    await injectTransportFault(runId, "tenant_email", 10);
    for (const minute of [1, 4, 9, 16, 30]) {
      await setTestClock(zonedInstant(2026, 10, 5, 10, minute));
      await drainDueJobs(testPool(), ENV);
    }
    const email = (await jobsFor(runId)).find((j) => j.kind === "tenant_email");
    expect(email).toMatchObject({ status: "failed", attempts: 4 });
    expect((await capturesFor(runId)).filter((c) => c.channel === "sendgrid.mail")).toHaveLength(0);
  });

  it("a retry of a cancelled showing's notice does not send", async () => {
    const runId = run("cancel-retry");
    const showingId = await booked(runId);
    await injectTransportFault(runId, "tenant_sms", 1);
    await setTestClock(zonedInstant(2026, 10, 5, 10, 1));
    await drainDueJobs(testPool(), ENV);
    await cancelShowing(testPool(), showingId);
    await setTestClock(zonedInstant(2026, 10, 5, 10, 10));
    await drainDueJobs(testPool(), ENV);
    const sms = (await jobsFor(runId)).find((j) => j.kind === "tenant_sms");
    expect(sms).toMatchObject({ status: "superseded", attempts: 2, last_error: "showing was cancelled" });
    expect((await capturesFor(runId)).map((c) => c.channel)).not.toContain("twilio.sms");
  });

  it("a notice queued before a reschedule does not send the old time", async () => {
    const runId = run("reschedule");
    const showingId = await booked(runId);
    await rescheduleShowing(testPool(), showingId, zonedInstant(2026, 10, 8, 16));
    await setTestClock(zonedInstant(2026, 10, 7, 10, 5));
    await drainDueJobs(testPool(), ENV);
    const tenant = (await capturesFor(runId, showingId)).filter((c) => c.channel !== "graph.createEvent").map((c) => c.text);
    expect(tenant).toHaveLength(2);
    for (const text of tenant) expect(text).toContain("Thursday, October 8, 4:00 p.m. to 4:30 p.m.");
  });

  it("with no allowlist configured, blocks every send and says why", async () => {
    const runId = run("no-allowlist");
    await booked(runId);
    await drainDueJobs(testPool(), { ...ENV, OUTBOUND_ALLOWLIST: undefined });
    expect((await jobsFor(runId)).find((j) => j.kind === "calendar_event")).toMatchObject({ status: "blocked" });
    expect((await refusalsFor(runId))[0].reason).toMatch(/OUTBOUND_ALLOWLIST is missing/);
    expect(await capturesFor(runId)).toEqual([]);
  });

  it("with a malformed allowlist, blocks every send", async () => {
    const runId = run("bad-allowlist");
    await booked(runId);
    await drainDueJobs(testPool(), { ...ENV, OUTBOUND_ALLOWLIST: "email:*@tenants.example.test,sms:5550100141" });
    expect((await refusalsFor(runId))[0].reason).toMatch(/Malformed E.164/);
    expect(await capturesFor(runId)).toEqual([]);
  });

  it("with no deployment identity, blocks every send", async () => {
    const runId = run("no-identity");
    await booked(runId);
    await drainDueJobs(testPool(), { ...ENV, DEPLOYMENT_TARGET: undefined, NODE_ENV: "production" });
    expect((await refusalsFor(runId))[0].reason).toMatch(/DEPLOYMENT_TARGET must be/);
    expect(await capturesFor(runId)).toEqual([]);
  });

  it("running the same job twice captures it once", async () => {
    const runId = run("idempotent");
    await booked(runId);
    await drainDueJobs(testPool(), ENV);
    const [calendar] = (await jobsFor(runId)).filter((j) => j.kind === "calendar_event");
    await testPool().query("UPDATE notification_jobs SET status = 'queued' WHERE id = $1", [calendar.id]);
    await drainDueJobs(testPool(), ENV);
    expect((await capturesFor(runId)).filter((c) => c.channel === "graph.createEvent")).toHaveLength(1);
  });

  it("refuses a showing without a termination basis and queues nothing", async () => {
    const runId = run("no-basis");
    const ids = await seedUnits(runId, [UNIT_A_NO_NOTICE]);
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    await expect(
      bookShowing(testPool(), {
        unitId: ids["Unit A"],
        prospectName: "Jordan Lee",
        prospectEmail: "jordan.lee@prospects.example.test",
        agentEmail: "agent@office.example.test",
        startsAt: zonedInstant(2026, 10, 6, 14),
        createdBy: "user_vitest",
      }),
    ).rejects.toThrow(/lease end date \(2026-10-31\) does not by itself allow showings/);
    expect(await jobsFor(runId)).toEqual([]);
  });

  it("the same booking request key books once, even when both requests race", async () => {
    const runId = run("request-key");
    const ids = await seedUnits(runId, [UNIT_B]);
    await setTestClock(zonedInstant(2026, 10, 1, 9));
    const request = {
      unitId: ids["Unit B"],
      prospectName: "Jordan Lee",
      prospectEmail: "jordan.lee@prospects.example.test",
      agentEmail: "agent@office.example.test",
      startsAt: zonedInstant(2026, 10, 6, 14),
      createdBy: "user_vitest",
      requestKey: `${runId}-form-1`,
    };
    const [a, b] = await Promise.all([bookShowing(testPool(), request), bookShowing(testPool(), request)]);
    expect(a).toBe(b);
    expect((await jobsFor(runId)).map((j) => j.kind)).toEqual(["tenant_sms", "tenant_email", "calendar_event"]);
  });

  it("a seed that fails halfway leaves rows that are identifiable and removable, and spares other runs", async () => {
    const other = run("bystander");
    await seedUnits(other, [UNIT_B]);
    const broken = run("broken-seed");
    await expect(seedUnits(broken, [UNIT_B, UNIT_A_NO_NOTICE], { failAfter: 1 })).rejects.toThrow(/seed interrupted after 1 of 2/);
    expect(await rowsForRun(broken)).toBe(1);
    await cleanupRun(broken);
    expect(await rowsForRun(broken)).toBe(0);
    expect(await rowsForRun(other)).toBe(1);
  });
});
