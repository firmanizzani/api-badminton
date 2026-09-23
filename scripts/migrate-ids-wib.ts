/**
 * Migrasi:
 * 1) Kosongkan table sessions
 * 2) Semua timestamp → jam WIB (timestamp without time zone)
 * 3) PK/FK uuid → varchar sequential `singular-N` (max+1, bukan truncate)
 *
 * Jalankan: bun run scripts/migrate-ids-wib.ts
 */
import pg from "pg";
import { env } from "../src/config/env";

const connectionString = env.DATABASE_URL
  .replace(/([?&])channel_binding=require&?/, "$1")
  .replace(/[?&]$/, "");

const FK_DROPS = [
  `ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_user_id_users_id_fk`,
  `ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_booking_id_bookings_id_fk`,
  `ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_user_id_users_id_fk`,
];

const FK_ADDS = [
  `ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE payments ADD CONSTRAINT payments_booking_id_bookings_id_fk
     FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade ON UPDATE no action`,
];

async function alterTs(client: pg.Client, table: string, col: string, nullable: boolean) {
  await client.query(`ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT`);
  await client.query(
    `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE timestamp USING ${col} AT TIME ZONE 'Asia/Jakarta'`,
  );
  if (!nullable) {
    await client.query(
      `ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')`,
    );
  }
}

async function main() {
  const client = new pg.Client({
    connectionString,
    options: "-c TimeZone=Asia/Jakarta",
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    const del = await client.query("DELETE FROM sessions");
    console.log(`sessions dihapus: ${del.rowCount ?? 0}`);

    for (const stmt of FK_DROPS) await client.query(stmt);
    console.log("FK di-drop");

    await client.query(`
      ALTER TABLE users
        ALTER COLUMN id DROP DEFAULT,
        ALTER COLUMN id TYPE varchar(40);
      ALTER TABLE sessions
        ALTER COLUMN id TYPE varchar(40),
        ALTER COLUMN user_id TYPE varchar(40);
      ALTER TABLE bookings
        ALTER COLUMN id DROP DEFAULT,
        ALTER COLUMN id TYPE varchar(40),
        ALTER COLUMN user_id TYPE varchar(40);
      ALTER TABLE payments
        ALTER COLUMN id DROP DEFAULT,
        ALTER COLUMN id TYPE varchar(40),
        ALTER COLUMN booking_id TYPE varchar(40);
      ALTER TABLE schedules
        ALTER COLUMN id DROP DEFAULT,
        ALTER COLUMN id TYPE varchar(40);
      ALTER TABLE court_images
        ALTER COLUMN id DROP DEFAULT,
        ALTER COLUMN id TYPE varchar(40);
    `);
    console.log("uuid → varchar selesai");

    for (const [table, cols] of [
      ["users", ["created_at", "updated_at"]],
      ["courts", ["created_at", "updated_at"]],
      ["schedules", ["created_at", "updated_at"]],
      ["bookings", ["created_at", "updated_at"]],
      ["payments", ["created_at", "updated_at", "paid_at"]],
      ["sessions", ["created_at", "expires_at"]],
    ] as [string, string[]][]) {
      for (const col of cols) {
        await alterTs(client, table, col, col === "paid_at");
      }
    }
    console.log("timestamp → WIB selesai");

    await client.query(`
      CREATE TEMP TABLE _user_map AS
      SELECT id AS old_id, ('user-' || row_number() OVER (ORDER BY created_at, id))::varchar(40) AS new_id
      FROM users;
      UPDATE bookings b SET user_id = m.new_id FROM _user_map m WHERE b.user_id = m.old_id;
      UPDATE users u SET id = m.new_id FROM _user_map m WHERE u.id = m.old_id;
      DROP TABLE _user_map;
    `);

    await client.query(`
      CREATE TEMP TABLE _booking_map AS
      SELECT id AS old_id, ('booking-' || row_number() OVER (ORDER BY created_at, id))::varchar(40) AS new_id
      FROM bookings;
      UPDATE payments p SET booking_id = m.new_id FROM _booking_map m WHERE p.booking_id = m.old_id;
      UPDATE bookings b SET id = m.new_id FROM _booking_map m WHERE b.id = m.old_id;
      DROP TABLE _booking_map;
    `);

    await client.query(`
      CREATE TEMP TABLE _payment_map AS
      SELECT id AS old_id, ('payment-' || row_number() OVER (ORDER BY created_at, id))::varchar(40) AS new_id
      FROM payments;
      UPDATE payments p SET id = m.new_id FROM _payment_map m WHERE p.id = m.old_id;
      DROP TABLE _payment_map;
    `);

    await client.query(`
      CREATE TEMP TABLE _schedule_map AS
      SELECT id AS old_id, ('schedule-' || row_number() OVER (ORDER BY created_at, id))::varchar(40) AS new_id
      FROM schedules;
      UPDATE schedules s SET id = m.new_id FROM _schedule_map m WHERE s.id = m.old_id;
      DROP TABLE _schedule_map;
    `);

    await client.query(`
      CREATE TEMP TABLE _ci_map AS
      SELECT id AS old_id, ('court_image-' || row_number() OVER (ORDER BY court_id, position, id))::varchar(40) AS new_id
      FROM court_images;
      UPDATE court_images c SET id = m.new_id FROM _ci_map m WHERE c.id = m.old_id;
      DROP TABLE _ci_map;
    `);

    console.log("renumber ID selesai");

    for (const stmt of FK_ADDS) await client.query(stmt);
    console.log("FK di-add ulang");

    await client.query("COMMIT");

    const check = await client.query(`
      SELECT
        (SELECT count(*) FROM sessions) AS sessions,
        (SELECT array_agg(id ORDER BY id) FROM users) AS users,
        (SELECT array_agg(id ORDER BY id) FROM bookings) AS bookings,
        (SELECT array_agg(id ORDER BY id) FROM payments) AS payments,
        (SELECT min(id) FROM schedules) AS sample_schedule,
        (SELECT min(id) FROM court_images) AS sample_image,
        (SELECT created_at FROM users ORDER BY created_at LIMIT 1) AS sample_ts
    `);
    console.log("Hasil:", JSON.stringify(check.rows[0], null, 2));
    console.log("Migrasi selesai.");
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
