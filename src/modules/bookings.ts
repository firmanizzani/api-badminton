import { Elysia, t } from "elysia";
import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { bookings, courts, payments } from "../db/schema";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { AppError, ok } from "../utils/response";
import {
  cancelBooking,
  createBooking,
  findBookingByCode,
  getAvailability,
  mapBooking,
  type BookingApi,
} from "../services/booking.service";
import { createPayment, settlePayment, toPaymentApi } from "../services/payment.service";
import { toWibIso } from "../utils/wib";

async function loadBookingDetail(codeOrId: string): Promise<BookingApi | null> {
  const booking = await findBookingByCode(codeOrId);
  if (!booking) return null;
  const [court] = await db.select().from(courts).where(eq(courts.id, booking.courtId)).limit(1);
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, booking.id))
    .limit(1);
  return mapBooking(booking, court ?? null, payment ?? null);
}

async function loadAllBookings(): Promise<BookingApi[]> {
  const rows = await db
    .select()
    .from(bookings)
    .orderBy(desc(bookings.createdAt));
  if (rows.length === 0) return [];

  const courtRows = await db.select().from(courts);
  const courtById = new Map(courtRows.map((row) => [row.id, row]));

  const paymentRows = await db.select().from(payments).where(
    inArray(
      payments.bookingId,
      rows.map((row) => row.id),
    ),
  );
  const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

  return rows.map((row) =>
    mapBooking(row, courtById.get(row.courtId) ?? null, paymentByBooking.get(row.id) ?? null),
  );
}

export const availabilityRoutes = new Elysia({ name: "availability" }).get(
  "/availability",
  async ({ query }) => {
    if (!query.date || !query.courtId) {
      throw new AppError(400, "VALIDATION", "Parameter date dan courtId wajib diisi");
    }
    return ok(await getAvailability(query.date, query.courtId));
  },
  {
    query: t.Object({
      date: t.String(),
      courtId: t.String(),
    }),
  },
);

export const bookingRoutes = new Elysia({ name: "booking-routes" })
  .post(
    "/bookings",
    async (context) => {
      const user = await requireAuth(context);
      const { body, set } = context;
      const { booking, court } = await createBooking(
        {
          courtId: body.courtId,
          bookingDate: body.bookingDate,
          startTime: body.startTime,
          duration: body.duration,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          customerPhone: body.customerPhone,
        },
        user,
      );
      set.status = 201;
      return ok(mapBooking(booking, court, null));
    },
    {
      body: t.Object({
        courtId: t.String({ minLength: 1 }),
        bookingDate: t.String({ minLength: 1 }),
        startTime: t.String({ minLength: 1 }),
        duration: t.Integer({ minimum: 1, maximum: 3 }),
        customerName: t.Optional(t.String({ maxLength: 120 })),
        customerEmail: t.Optional(t.String({ maxLength: 160 })),
        customerPhone: t.Optional(t.String({ maxLength: 32 })),
        // Diabaikan — harga & pemilik divalidasi di server.
        totalPrice: t.Optional(t.Number()),
        userId: t.Optional(t.String()),
      }),
    },
  )
  .get("/bookings", async (context) => {
    const user = await requireAuth(context);
    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.userId, user.id))
      .orderBy(desc(bookings.bookingDate), desc(bookings.startTime));
    if (rows.length === 0) return ok<BookingApi[]>([]);

    const courtRows = await db.select().from(courts);
    const courtById = new Map(courtRows.map((row) => [row.id, row]));
    const paymentRows = await db.select().from(payments).where(
      inArray(
        payments.bookingId,
        rows.map((row) => row.id),
      ),
    );
    const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

    return ok(
      rows.map((row) =>
        mapBooking(row, courtById.get(row.courtId) ?? null, paymentByBooking.get(row.id) ?? null),
      ),
    );
  })
  .get(
    "/bookings/:id",
    async (context) => {
      const user = await requireAuth(context);
      const detail = await loadBookingDetail(context.params.id);
      if (!detail) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking tidak ditemukan");
      if (detail.user_id !== user.id && user.role !== "ADMIN") {
        throw new AppError(403, "FORBIDDEN", "Bukan booking milik Anda");
      }
      return ok(detail);
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/bookings/:id/cancel",
    async (context) => {
      const user = await requireAuth(context);
      const { booking } = await cancelBooking(context.params.id, user);
      const detail = await loadBookingDetail(booking.bookingCode);
      return ok(detail ?? mapBooking(booking, null, null));
    },
    { params: t.Object({ id: t.String() }) },
  );

export const paymentRoutes = new Elysia({ name: "payments" }).post(
  "/payments",
  async (context) => {
    const user = await requireAuth(context);
    const { payment, bookingCode } = await createPayment(
      {
        bookingId: context.body.bookingId,
        method: context.body.method,
        reference: context.body.reference,
      },
      user,
    );
    context.set.status = 201;
    return ok(toPaymentApi(payment, bookingCode));
  },
  {
    body: t.Object({
      bookingId: t.String({ minLength: 1 }),
      method: t.Union([t.Literal("QRIS"), t.Literal("BANK_TRANSFER"), t.Literal("EWALLET")]),
      amount: t.Optional(t.Number()),
      reference: t.Optional(t.String({ maxLength: 120 })),
    }),
  },
);

export const adminRoutes = new Elysia({ name: "admin" })
  .get("/admin/bookings", async (context) => {
    await requireAdmin(context);
    return ok(await loadAllBookings());
  })
  .get(
    "/admin/bookings/:id",
    async (context) => {
      await requireAdmin(context);
      const detail = await loadBookingDetail(context.params.id);
      if (!detail) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking tidak ditemukan");
      return ok(detail);
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/admin/bookings/:id",
    async (context) => {
      await requireAdmin(context);
      const booking = await findBookingByCode(context.params.id);
      if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking tidak ditemukan");
      const [updated] = await db
        .update(bookings)
        .set({ status: context.body.status })
        .where(eq(bookings.id, booking.id))
        .returning();
      if (!updated) throw new AppError(500, "INTERNAL_ERROR", "Gagal memperbarui booking");
      return ok(await loadBookingDetail(updated.bookingCode));
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.Union([
          t.Literal("PENDING"),
          t.Literal("CONFIRMED"),
          t.Literal("CANCELLED"),
          t.Literal("COMPLETED"),
          t.Literal("EXPIRED"),
        ]),
      }),
    },
  )
  .get("/admin/payments", async (context) => {
    await requireAdmin(context);
    const paymentRows = await db.select().from(payments).orderBy(desc(payments.createdAt));
    if (paymentRows.length === 0) return ok([]);
    const bookingRows = await db
      .select({ id: bookings.id, code: bookings.bookingCode })
      .from(bookings)
      .where(
        inArray(
          bookings.id,
          paymentRows.map((row) => row.bookingId),
        ),
      );
    const codeById = new Map(bookingRows.map((row) => [row.id, row.code]));
    return ok(
      paymentRows.map((row) => toPaymentApi(row, codeById.get(row.bookingId) ?? row.bookingId)),
    );
  })
  .patch(
    "/admin/payments/:id",
    async (context) => {
      await requireAdmin(context);
      const payment = await settlePayment({
        paymentId: context.params.id,
        status: context.body.status,
        transactionId: context.body.transactionId,
        amount: context.body.amount,
      });
      const [booking] = await db
        .select({ code: bookings.bookingCode })
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .limit(1);
      return ok(toPaymentApi(payment, booking?.code ?? payment.bookingId));
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.Union([
          t.Literal("PAID"),
          t.Literal("FAILED"),
          t.Literal("EXPIRED"),
          t.Literal("REFUNDED"),
        ]),
        transactionId: t.Optional(t.String({ maxLength: 64 })),
        amount: t.Optional(t.Number()),
      }),
    },
  )
  .get("/admin/customers", async (context) => {
    await requireAdmin(context);
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.status,
        u.created_at AS "joinedAt",
        COUNT(b.id)::int AS "totalBookings",
        COALESCE(SUM(b.total_price) FILTER (WHERE b.status NOT IN ('CANCELLED', 'EXPIRED')), 0)::int AS "totalSpending"
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.id
      WHERE u.role = 'USER'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    const list = (rows as { rows?: unknown[] }).rows ?? rows;
    return ok(
      (list as Record<string, unknown>[]).map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        totalBookings: row.totalBookings,
        totalSpending: row.totalSpending,
        joinedAt:
          row.joinedAt instanceof Date
            ? toWibIso(row.joinedAt).slice(0, 10)
            : String(row.joinedAt ?? "").slice(0, 10),
        status: row.status,
      })),
    );
  })
  .get("/admin/dashboard", async (context) => {
    await requireAdmin(context);
    const { sql } = await import("drizzle-orm");
    const { todayISO } = await import("../utils/time");
    const today = todayISO();

    const statsResult = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM bookings WHERE booking_date = ${today} AND status NOT IN ('CANCELLED', 'EXPIRED'))::int AS "todaysBookings",
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'PAID')::int AS revenue,
        (SELECT COUNT(*) FROM payments WHERE status = 'PENDING')::int AS "pendingPayments",
        (SELECT COUNT(*) FROM courts WHERE status = 'AVAILABLE')::int AS "activeCourts",
        (SELECT COUNT(*) FROM courts)::int AS "totalCourts"
    `);
    const statsRows = ((statsResult as { rows?: unknown[] }).rows ?? statsResult) as Record<
      string,
      unknown
    >[];
    const stats = statsRows[0] ?? {};

    const recent = (await loadAllBookings()).slice(0, 6);
    return ok({
      stats: {
        todaysBookings: Number(stats.todaysBookings ?? 0),
        revenue: Number(stats.revenue ?? 0),
        pendingPayments: Number(stats.pendingPayments ?? 0),
        activeCourts: Number(stats.activeCourts ?? 0),
        totalCourts: Number(stats.totalCourts ?? 0),
      },
      recent,
    });
  });
