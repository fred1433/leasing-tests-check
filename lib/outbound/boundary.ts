import type { Pool, PoolClient } from "pg";
import { deploymentIdentity, DeploymentConfigError } from "../deployment";
import { AllowlistError, parseAllowlist, type Recipient } from "./allowlist";
import type { OutboundMessage } from "./messages";
import { declaredRecipients, scannedRecipients } from "./recipients";

/**
 * The only door to Twilio, SendGrid, Microsoft Graph and Clerk's messaging.
 *
 * 1. The process must say what it is (DEPLOYMENT_TARGET) and hold no production credential.
 * 2. Every recipient-bearing field, and every address or number anywhere in the payload,
 *    must be on the allowlist. Otherwise nothing leaves and the refusal is recorded.
 * 3. On the test target the transport is a capture: the final rendered payload is stored,
 *    no provider is called. A capture proves what the application attempted to send,
 *    not delivery, receipt, or lawful service.
 */
export class OutboundRefused extends Error {
  constructor(
    message: string,
    readonly reason: "configuration" | "allowlist" | "recipient",
  ) {
    super(message);
    this.name = "OutboundRefused";
  }
}

export class TransientTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientTransportError";
  }
}

export interface SendContext {
  runId: string;
  jobId: number | null;
  /**
   * The caller's open transaction, if any. The capture (the committed outbound intent) and any
   * refusal are written inside it, so they commit or roll back with the caller's decision.
   */
  tx?: PoolClient;
}

function mask(r: Recipient): string {
  if (r.kind === "email") {
    const [local, domain] = r.value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${r.value.slice(0, 5)}***${r.value.slice(-2)}`;
}

async function recordRefusal(pool: Pool, message: OutboundMessage, ctx: SendContext, reason: string) {
  await (ctx.tx ?? pool).query(
    "INSERT INTO outbound_refusals (run_id, job_id, channel, reason) VALUES ($1, $2, $3, $4)",
    [ctx.runId, ctx.jobId, message.channel, reason],
  );
}

export function checkRecipients(message: OutboundMessage, allowlistSource: string | undefined): Recipient[] {
  const allowlist = parseAllowlist(allowlistSource);
  const declared = declaredRecipients(message);
  if (declared.length === 0) {
    throw new OutboundRefused(`${message.channel}: no recipient found, refusing an unknown shape`, "recipient");
  }
  const everyone = [...declared, ...scannedRecipients(message.request)];
  const blocked = everyone.filter((r) => !allowlist.allows(r));
  if (blocked.length > 0) {
    const unique = [...new Set(blocked.map(mask))];
    throw new OutboundRefused(`${message.channel}: recipient not on the allowlist: ${unique.join(", ")}`, "recipient");
  }
  return declared;
}

export async function sendThroughBoundary(
  pool: Pool,
  message: OutboundMessage,
  ctx: SendContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ captured: boolean }> {
  let target: "test" | "staging";
  try {
    target = deploymentIdentity(env).target;
  } catch (error) {
    const reason = error instanceof DeploymentConfigError ? error.message : String(error);
    await recordRefusal(pool, message, ctx, reason);
    throw new OutboundRefused(reason, "configuration");
  }

  let recipients: Recipient[];
  try {
    recipients = checkRecipients(message, env.OUTBOUND_ALLOWLIST);
  } catch (error) {
    if (error instanceof AllowlistError) {
      await recordRefusal(pool, message, ctx, error.message);
      throw new OutboundRefused(error.message, "allowlist");
    }
    if (error instanceof OutboundRefused) {
      await recordRefusal(pool, message, ctx, error.message);
    }
    throw error;
  }

  if (target === "staging") {
    // Staging adapters (Twilio test credentials, SendGrid sandbox mode, a Graph test
    // tenant) belong to the real application and are not part of this sample.
    await recordRefusal(pool, message, ctx, "staging transports are not wired in this sample");
    throw new OutboundRefused("staging transports are not wired in this sample", "configuration");
  }

  return captureTransport(pool, message, recipients, ctx);
}

async function captureTransport(pool: Pool, message: OutboundMessage, recipients: Recipient[], ctx: SendContext) {
  // Test-only fault injection, used to exercise the worker's retries.
  const kind = ctx.jobId === null ? null : await jobKind(pool, ctx.jobId);
  if (kind) {
    const fault = await pool.query(
      "UPDATE transport_faults SET remaining = remaining - 1 WHERE run_id = $1 AND kind = $2 AND remaining > 0 RETURNING remaining",
      [ctx.runId, kind],
    );
    if (fault.rowCount) throw new TransientTransportError(`${message.channel}: simulated provider timeout`);
  }
  const inserted = await (ctx.tx ?? pool).query(
    `INSERT INTO outbound_captures (run_id, job_id, channel, recipients, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (job_id) DO NOTHING`,
    [ctx.runId, ctx.jobId, message.channel, recipients.map((r) => r.value), JSON.stringify(message.request)],
  );
  return { captured: (inserted.rowCount ?? 0) > 0 };
}

async function jobKind(pool: Pool, jobId: number): Promise<string | null> {
  const r = await pool.query<{ kind: string }>("SELECT kind FROM notification_jobs WHERE id = $1", [jobId]);
  return r.rows[0]?.kind ?? null;
}
