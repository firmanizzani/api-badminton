import { sql } from "drizzle-orm";
import { db } from "../db";

/** Prefix singular per tabel — id = `${prefix}-${n}` (n = max+1, bukan truncate). */
export type IdPrefix =
  | "user"
  | "session"
  | "booking"
  | "payment"
  | "schedule"
  | "court_image"
  | "court";

const TABLE_BY_PREFIX: Record<IdPrefix, string> = {
  user: "users",
  session: "sessions",
  booking: "bookings",
  payment: "payments",
  schedule: "schedules",
  court_image: "court_images",
  court: "courts",
};

const PAD = 5;

function parseSeq(id: string, prefix: string): number {
  if (!id.startsWith(`${prefix}-`)) return 0;
  const n = Number(id.slice(prefix.length + 1));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function maxSeq(table: string, prefix: string): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`SELECT id FROM ${sql.identifier(table)}`);
  const rows = result.rows;
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, parseSeq(row.id, prefix));
  }
  return max;
}

function padSeq(n: number): string {
  return String(n).padStart(PAD, "0");
}

/** ID berikutnya: prefix + (max nomor di tabel + 1), zero-pad 5 digit. */
export async function nextId(prefix: IdPrefix): Promise<string> {
  const max = await maxSeq(TABLE_BY_PREFIX[prefix], prefix);
  return `${prefix}-${padSeq(max + 1)}`;
}

/** court-00001, court-00002, … — max dari data yang ada, bukan count. */
export async function nextCourtId(): Promise<string> {
  const max = await maxSeq("courts", "court");
  return `court-${padSeq(max + 1)}`;
}
