import { Pool } from "pg";

declare global {
  var __leasingPool: Pool | undefined;
}

/** One pool per process. DATABASE_URL may point at a unix socket (host=/var/run/postgresql). */
export function db(): Pool {
  if (!globalThis.__leasingPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalThis.__leasingPool = new Pool({ connectionString, max: 5 });
  }
  return globalThis.__leasingPool;
}
