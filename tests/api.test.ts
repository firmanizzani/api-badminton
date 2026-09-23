import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { app } from "../src/app";
import { db } from "../src/db";
import { bookings, payments, sessions, users } from "../src/db/schema";
import { env } from "../src/config/env";
import { pool } from "../src/db";

const BASE = "http://localhost:0"; // tidak dipakai — kita pakai app.handle

function req(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): { res: Response; body: any } {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return { res: undefined as never, body: undefined } as never; // placeholder
}

async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: any; cookie: string | null }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  const request = new Request(`http://localhost:3000${path}`, { ...init, headers });
  const response = await app.handle(request);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.length
    ? setCookie.map((c) => c.split(";")[0]).join("; ")
    : (init.cookie ?? null);
  return { status: response.status, body, cookie };
}

const suffix = Date.now().toString(36);
const customerEmail = `test-customer-${suffix}@example.com`;
const adminEmail = `test-admin-${suffix}@example.com`;

let customerCookie: string | null = null;
let adminCookie: string | null = null;
let customerId = "";
let bookingCode = "";
let paymentId = "";
let uuidBookingId = "";
let testCourtId = "court-00001";
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  // siapkan akun admin test (role USER via register, promote ke ADMIN)
  const reg = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Test Customer",
      email: customerEmail,
      phone: "628111111111",
      password: "password123",
    }),
  });
  expect(reg.status).toBe(201);
  customerCookie = reg.cookie;
  customerId = reg.body.data.id;

  // daftar admin: register lalu promote
  const regAdmin = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Test Admin",
      email: adminEmail,
      phone: "628222222222",
      password: "password123",
    }),
  });
  expect(regAdmin.status).toBe(201);
  const adminId = regAdmin.body.data.id;
  await db.update(users).set({ role: "ADMIN" }).where(eq(users.id, adminId));
  const loginAdmin = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, password: "password123" }),
  });
  expect(loginAdmin.status).toBe(200);
  adminCookie = loginAdmin.cookie;
});

afterAll(async () => {
  // cleanup data test
  const rows = await db.select().from(bookings).where(eq(bookings.userId, customerId));
  for (const row of rows) {
    await db.delete(payments).where(eq(payments.bookingId, row.id));
    await db.delete(bookings).where(eq(bookings.id, row.id));
  }
  const adminRows = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail));
  for (const row of adminRows) {
    await db.delete(sessions).where(eq(sessions.userId, row.id));
    await db.delete(users).where(eq(users.id, row.id));
  }
  await db.delete(sessions).where(eq(sessions.userId, customerId));
  await db.delete(users).where(eq(users.id, customerId));
  await pool.end();
});

describe("auth", () => {
  test("register + login + me", async () => {
    const me = await call("/api/auth/me", { cookie: customerCookie! });
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(customerEmail);
    expect(me.body.data.role).toBe("USER");
  });

  test("login salah password → 401", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: customerEmail, password: "salah" }),
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("me tanpa cookie → 401", async () => {
    const res = await call("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("register email duplikat → 409", async () => {
    const res = await call("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Dup",
        email: customerEmail,
        phone: "628111111111",
        password: "password123",
      }),
    });
    expect(res.status).toBe(409);
  });
});

describe("courts & availability", () => {
  test("GET /api/courts → 6 lapangan", async () => {
    const res = await call("/api/courts");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(6);
    expect(res.body.data[0]).toHaveProperty("label");
    expect(res.body.data[0]).toHaveProperty("facilities");
  });

  test("GET /api/availability → 17 slot", async () => {
    const res = await call(`/api/availability?date=${tomorrow}&courtId=${testCourtId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(17);
    expect(res.body.data[0].start).toBe("06:00");
    expect(res.body.data.every((s: any) => s.status === "AVAILABLE")).toBe(true);
  });
});

describe("booking flow", () => {
  test("create booking → PENDING + kode SMASH", async () => {
    const res = await call("/api/bookings", {
      method: "POST",
      cookie: customerCookie!,
      body: JSON.stringify({
        courtId: testCourtId,
        bookingDate: tomorrow,
        startTime: "19:00",
        duration: 2,
        customerName: "Test Customer",
        customerEmail,
        customerPhone: "628111111111",
        totalPrice: 1, // diabaikan server
        userId: "x", // diabaikan server
      }),
    });
    expect(res.status).toBe(201);
    bookingCode = res.body.data.id;
    uuidBookingId = res.body.data.id;
    expect(bookingCode).toMatch(/^SMASH-\d{8}-\d{4}$/);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.total_price).toBe(100000); // 2 jam × 50k
    expect(res.body.data.court_name).toBe("Court 01");
    expect(res.body.data.user_id).toBe(customerId);
  });

  test("double-book slot sama → 409 BOOKING_CONFLICT", async () => {
    const res = await call("/api/bookings", {
      method: "POST",
      cookie: customerCookie!,
      body: JSON.stringify({
        courtId: testCourtId,
        bookingDate: tomorrow,
        startTime: "19:30",
        duration: 1,
      }),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("BOOKING_CONFLICT");
  });

  test("GET /api/bookings → hanya milik sendiri", async () => {
    const res = await call("/api/bookings", { cookie: customerCookie! });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(bookingCode);
  });

  test("GET /api/bookings/:id (kode) → embed court", async () => {
    const res = await call(`/api/bookings/${bookingCode}`, { cookie: customerCookie! });
    expect(res.status).toBe(200);
    expect(res.body.data.court_name).toBe("Court 01");
    expect(res.body.data.court_tier).toBe("REGULAR");
  });

  test("create payment → PENDING, booking_id = kode", async () => {
    const res = await call("/api/payments", {
      method: "POST",
      cookie: customerCookie!,
      body: JSON.stringify({ bookingId: bookingCode, method: "QRIS", amount: 1 }),
    });
    expect(res.status).toBe(201);
    paymentId = res.body.data.id;
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.booking_id).toBe(bookingCode);
    expect(res.body.data.amount).toBe(100000);
  });

  test("admin verify PAID → booking CONFIRMED", async () => {
    const res = await call(`/api/admin/payments/${paymentId}`, {
      method: "PATCH",
      cookie: adminCookie!,
      body: JSON.stringify({ status: "PAID", transactionId: "TXNTEST" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAID");

    const detail = await call(`/api/bookings/${bookingCode}`, { cookie: customerCookie! });
    expect(detail.body.data.status).toBe("CONFIRMED");
  });

  test("cancel → CANCELLED + payment REFUNDED", async () => {
    const res = await call(`/api/bookings/${bookingCode}/cancel`, {
      method: "POST",
      cookie: customerCookie!,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(res.body.data.payment.status).toBe("REFUNDED");
  });
});

describe("admin guard & endpoints", () => {
  test("customer → /api/admin/bookings → 403", async () => {
    const res = await call("/api/admin/bookings", { cookie: customerCookie! });
    expect(res.status).toBe(403);
  });

  test("tanpa login → /api/admin/bookings → 401", async () => {
    const res = await call("/api/admin/bookings");
    expect(res.status).toBe(401);
  });

  test("admin dashboard stats", async () => {
    const res = await call("/api/admin/dashboard", { cookie: adminCookie! });
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toHaveProperty("todaysBookings");
    expect(res.body.data.stats).toHaveProperty("revenue");
    expect(res.body.data.stats.totalCourts).toBe(6);
    expect(Array.isArray(res.body.data.recent)).toBe(true);
  });

  test("admin customers aggregate", async () => {
    const res = await call("/api/admin/customers", { cookie: adminCookie! });
    expect(res.status).toBe(200);
    const me = res.body.data.find((c: any) => c.email === customerEmail);
    expect(me).toBeDefined();
    expect(me.totalBookings).toBeGreaterThanOrEqual(1);
  });

  test("admin PATCH booking status", async () => {
    const create = await call("/api/bookings", {
      method: "POST",
      cookie: customerCookie!,
      body: JSON.stringify({
        courtId: "court-00003",
        bookingDate: tomorrow,
        startTime: "10:00",
        duration: 1,
      }),
    });
    expect(create.status).toBe(201);
    const code = create.body.data.id;

    const res = await call(`/api/admin/bookings/${code}`, {
      method: "PATCH",
      cookie: adminCookie!,
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("COMPLETED");

    // cleanup
    await call(`/api/bookings/${code}/cancel`, { method: "POST", cookie: adminCookie! });
  });

  test("admin CRUD court + schedules", async () => {
    const create = await call("/api/admin/courts", {
      method: "POST",
      cookie: adminCookie!,
      body: JSON.stringify({
        name: "Court Test",
        type: "REGULAR",
        price: 60000,
        description: "uji",
        facilities: ["Net"],
      }),
    });
    expect(create.status).toBe(201);
    const courtId = create.body.data.id;

    const patch = await call(`/api/admin/courts/${courtId}`, {
      method: "PATCH",
      cookie: adminCookie!,
      body: JSON.stringify({ status: "MAINTENANCE", price: 65000 }),
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe("MAINTENANCE");

    const sched = await call(`/api/admin/courts/${courtId}/schedules`, {
      method: "POST",
      cookie: adminCookie!,
      body: JSON.stringify({ startTime: "06:00", endTime: "07:00", price: 65000 }),
    });
    expect(sched.status).toBe(201);
    const schedId = sched.body.data.id;

    const schedPatch = await call(`/api/admin/schedules/${schedId}`, {
      method: "PATCH",
      cookie: adminCookie!,
      body: JSON.stringify({ isActive: false }),
    });
    expect(schedPatch.status).toBe(200);
    expect(schedPatch.body.data.is_active).toBe(false);

    const delSched = await call(`/api/admin/schedules/${schedId}`, { method: "DELETE", cookie: adminCookie! });
    expect(delSched.status).toBe(200);

    const del = await call(`/api/admin/courts/${courtId}`, {
      method: "DELETE",
      cookie: adminCookie!,
    });
    expect(del.status).toBe(200);
  });

  test("hapus court ber-booking → 409 COURT_HAS_BOOKINGS", async () => {
    const res = await call("/api/admin/courts/court-00001", {
      method: "DELETE",
      cookie: adminCookie!,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COURT_HAS_BOOKINGS");
  });
});

describe("webhook", () => {
  test("signature valid → 200 idempotent", async () => {
    // payment lama sudah PAID; kirim ulang harus tetap 200
    const payload = JSON.stringify({
      paymentId,
      status: "PAID",
      transactionId: "TXNTEST",
      amount: 100000,
    });
    const sig = createHmac("sha256", env.WEBHOOK_SECRET).update(payload).digest("hex");
    const res = await call("/api/payments/webhook", {
      method: "POST",
      body: payload,
      headers: { "x-signature": sig },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAID");
  });

  test("signature salah → 401", async () => {
    const payload = JSON.stringify({ paymentId, status: "PAID", amount: 100000 });
    const res = await call("/api/payments/webhook", {
      method: "POST",
      body: payload,
      headers: { "x-signature": "deadbeef" },
    });
    expect(res.status).toBe(401);
  });

  test("amount mismatch → 400", async () => {
    // buat payment baru dulu
    const create = await call("/api/bookings", {
      method: "POST",
      cookie: customerCookie!,
      body: JSON.stringify({
        courtId: "court-00005",
        bookingDate: tomorrow,
        startTime: "14:00",
        duration: 1,
      }),
    });
    expect(create.status).toBe(201);
    const pay = await call("/api/payments", {
      method: "POST",
      cookie: customerCookie!,
      body: JSON.stringify({ bookingId: create.body.data.id, method: "EWALLET" }),
    });
    expect(pay.status).toBe(201);
    const newPayId = pay.body.data.id;

    const payload = JSON.stringify({ paymentId: newPayId, status: "PAID", amount: 1 });
    const sig = createHmac("sha256", env.WEBHOOK_SECRET).update(payload).digest("hex");
    const res = await call("/api/payments/webhook", {
      method: "POST",
      body: payload,
      headers: { "x-signature": sig },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AMOUNT_MISMATCH");

    // cleanup: cancel booking
    await call(`/api/bookings/${create.body.data.id}/cancel`, {
      method: "POST",
      cookie: customerCookie!,
    });
  });
});

void req;
void BASE;
void testCourtId;
void uuidBookingId;
