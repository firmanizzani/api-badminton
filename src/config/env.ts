// Seluruh proses backend anggap waktu lokal = WIB.
process.env.TZ = "Asia/Jakarta";

// Muat .env manual bila proses child (drizzle-kit dsb.) tidak memuatnya.
if (!process.env.DATABASE_URL) {
  try {
    const raw = Bun.file(new URL("../../.env", import.meta.url));
    const text = await raw.text();
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    /* .env tidak ada — validasi di bawah */
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Env ${name} tidak ditemukan — isi backend/.env terlebih dahulu`);
  return value;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  PORT: Number(process.env.PORT ?? 3000),
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:4321",
  WEBHOOK_SECRET: required("WEBHOOK_SECRET"),
};
