import { readFileSync } from "node:fs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await pool.end();
console.log("schema applied");
