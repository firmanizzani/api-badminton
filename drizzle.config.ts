import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig } from "drizzle-kit";

// Muat .env secara sinkron (drizzle-kit meng-compile config sebagai CJS — tanpa top-level await).
if (!process.env.DATABASE_URL) {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL tidak ditemukan — isi backend/.env terlebih dahulu");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
