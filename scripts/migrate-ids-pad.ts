/**
 * Migrasi ID existing → zero-pad 5 digit:
 *   user-1 → user-00001, court-01 → court-00001, court_image-3 → court_image-00003
 * Logika nextId (max+1) tidak diubah — hanya format penyimpanan.
 *
 * Jalankan: bun run scripts/migrate-ids-pad.ts
 */
import pg from "pg";
import { env } from "../src/config/env";

const connectionString = env.DATABASE_URL
  .replace(/([?&])channel_binding=require&?/, "$1")
  .replace(/[?&]$/, "");

/** prefix + '-' + digits → prefix + '-' + lpad(5). Idempotent bila sudah pad. */
function padSql(table: string, column = "id"): string {
  return `
    UPDATE ${table}
    SET ${column} = substring(${column} from 1 for position('-' in ${column}))
             || lpad(substring(${column} from position('-' in ${column}) + 1), 5, '0')
    WHERE ${column} ~ '^[a-z_]+-[0-9]+$'
      AND substring(${column} from position('-' in ${column}) + 1) !~ '^[0-9]{5}$';
  `;
}

/** PK + semua kolom FK yang menunjuk ke ID tersebut. */
const PAD_JOBS: { table: string; columns: string[] }[] = [
  { table: "users", columns: ["id"] },
  { table: "courts", columns: ["id"] },
  { table: "sessions", columns: ["id", "user_id"] },
  { table: "bookings", columns: ["id", "user_id", "court_id"] },
  { table: "payments", columns: ["id", "booking_id"] },
  { table: "schedules", columns: ["id", "court_id"] },
  { table: "court_images", columns: ["id", "court_id"] },
];

const FK_DROPS = [
  `ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_user_id_users_id_fk`,
  `ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_court_id_courts_id_fk`,
  `ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_booking_id_bookings_id_fk`,
  `ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_user_id_users_id_fk`,
  `ALTER TABLE court_images DROP CONSTRAINT IF EXISTS court_images_court_id_courts_id_fk`,
  `ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_court_id_courts_id_fk`,
];

const FK_ADDS = [
  `ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE bookings ADD CONSTRAINT bookings_court_id_courts_id_fk
     FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE payments ADD CONSTRAINT payments_booking_id_bookings_id_fk
     FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE court_images ADD CONSTRAINT court_images_court_id_courts_id_fk
     FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE schedules ADD CONSTRAINT schedules_court_id_courts_id_fk
     FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE cascade ON UPDATE no action`,
];

async function main() {
  const client = new pg.Client({
    connectionString,
    options: "-c TimeZone=Asia/Jakarta",
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    for (const stmt of FK_DROPS) await client.query(stmt);
    console.log("FK di-drop");

    let total = 0;
    for (const job of PAD_JOBS) {
      for (const column of job.columns) {
        const res = await client.query(padSql(job.table, column));
        total += res.rowCount ?? 0;
        if (res.rowCount) {
          console.log(`${job.table}.${column}: ${res.rowCount} baris dipad`);
        }
      }
    }

    for (const stmt of FK_ADDS) await client.query(stmt);
    console.log("FK di-add ulang");

    await client.query("COMMIT");
    console.log(`Total dipad: ${total}`);

    const check = await client.query(`
      SELECT
        (SELECT array_agg(id ORDER BY id) FROM users) AS users,
        (SELECT array_agg(id ORDER BY id) FROM courts) AS courts,
        (SELECT array_agg(id ORDER BY id) FROM bookings) AS bookings,
        (SELECT array_agg(id ORDER BY id) FROM payments) AS payments,
        (SELECT min(id) FROM schedules) AS sample_schedule,
        (SELECT min(id) FROM court_images) AS sample_image,
        (SELECT count(*) FROM sessions) AS sessions
    `);
    console.log("Hasil:", JSON.stringify(check.rows[0], null, 2));
    console.log("Migrasi pad ID selesai.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migrasi gagal:", err);
  process.exit(1);
});
