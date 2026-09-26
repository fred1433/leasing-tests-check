import type { Pool } from "pg";
import { deploymentIdentity } from "./deployment";

/**
 * One clock for the web server and the worker. On the test target a frozen time
 * stored in the database wins, so a test can move "now" past a send time and both
 * processes agree on it.
 */
export async function now(pool: Pool): Promise<Date> {
  if (deploymentIdentity().target === "test") {
    const r = await pool.query<{ frozen_at: Date | null }>("SELECT frozen_at FROM app_clock WHERE id = 1");
    const frozen = r.rows[0]?.frozen_at;
    if (frozen) return new Date(frozen);
  }
  return new Date();
}

export async function setClock(pool: Pool, at: Date | null): Promise<void> {
  if (deploymentIdentity().target !== "test") throw new Error("The clock can only be moved on the test target");
  await pool.query("UPDATE app_clock SET frozen_at = $1 WHERE id = 1", [at]);
}
