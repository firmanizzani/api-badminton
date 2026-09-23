import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

// Kolom timestamp tanpa zona menyimpan wall-clock WIB.
// node-pg default parse sebagai UTC → paksa interpret +07:00.
pg.types.setTypeParser(1114, (val: string) => new Date(`${val.replace(" ", "T")}+07:00`));

// node-postgres tidak memahami channel_binding — buang agar auth SCRAM tetap jalan.
const connectionString = env.DATABASE_URL
  .replace(/([?&])channel_binding=require&?/, "$1")
  .replace(/[?&]$/, "");

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 15_000,
  options: "-c TimeZone=Asia/Jakarta",
});

export const db = drizzle({ client: pool, schema });

export type Database = typeof db;
