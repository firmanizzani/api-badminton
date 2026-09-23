import { Elysia, t } from "elysia";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { bookings, courtImages, courts, schedules } from "../db/schema";
import { requireAdmin } from "../middleware/auth";
import { AppError, ok } from "../utils/response";
import { courtLabel } from "./courts";
import { handleWebhook, signWebhookBody, verifyWebhookSignature } from "../services/payment.service";
import { nextCourtId, nextId } from "../utils/id";

// Simpan raw body untuk verifikasi HMAC webhook.
const rawBodyStore = new WeakMap<Request, string>();

export const adminCourtRoutes = new Elysia({ name: "admin-courts" })
  .get("/admin/courts", async (context) => {
    await requireAdmin(context);
    const rows = await db.select().from(courts).orderBy(asc(courts.id));
    const images = await db.select().from(courtImages).orderBy(asc(courtImages.position));
    const imageByCourt = new Map(images.map((img) => [img.courtId, img]));
    const scheduleRows = await db.select().from(schedules).orderBy(asc(schedules.startTime));
    const schedulesByCourt = new Map<string, typeof scheduleRows>();
    for (const row of scheduleRows) {
      const list = schedulesByCourt.get(row.courtId) ?? [];
      list.push(row);
      schedulesByCourt.set(row.courtId, list);
    }

    return ok(
      rows.map((court) => {
        const image = imageByCourt.get(court.id);
        return {
          id: court.id,
          name: court.name,
          type: court.type,
          label: courtLabel(court.type),
          price: court.price,
          description: court.description,
          facilities: court.facilities,
          status: court.status,
          available: court.status === "AVAILABLE",
          image: image?.imageUrl ?? null,
          alt: image?.alt ?? null,
          schedules: (schedulesByCourt.get(court.id) ?? []).map((row) => ({
            id: row.id,
            court_id: row.courtId,
            start_time: row.startTime,
            end_time: row.endTime,
            price: row.price,
            is_active: row.isActive,
          })),
        };
      }),
    );
  })
  .post(
    "/admin/courts",
    async (context) => {
      await requireAdmin(context);
      const { body, set } = context;

      const id = await nextCourtId();
      const [exists] = await db.select({ id: courts.id }).from(courts).where(eq(courts.id, id)).limit(1);
      if (exists) {
        throw new AppError(409, "COURT_EXISTS", `ID ${id} sudah dipakai`);
      }

      const [court] = await db
        .insert(courts)
        .values({
          id,
          name: body.name,
          type: body.type,
          description: body.description ?? "",
          price: body.price,
          status: body.status ?? "AVAILABLE",
          facilities: body.facilities ?? [],
        })
        .returning();
      if (!court) throw new AppError(500, "INTERNAL_ERROR", "Gagal membuat lapangan");

      if (body.image) {
        await db.insert(courtImages).values({
          id: await nextId("court_image"),
          courtId: court.id,
          imageUrl: body.image,
          alt: body.alt ?? court.name,
          position: 0,
        });
      }

      set.status = 201;
      return ok({
        id: court.id,
        name: court.name,
        type: court.type,
        label: courtLabel(court.type),
        price: court.price,
        description: court.description,
        facilities: court.facilities,
        status: court.status,
        available: court.status === "AVAILABLE",
        image: body.image ?? null,
        alt: body.alt ?? null,
        schedules: [],
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        type: t.Union([t.Literal("REGULAR"), t.Literal("PREMIUM"), t.Literal("VIP")]),
        description: t.Optional(t.String({ maxLength: 500 })),
        price: t.Integer({ minimum: 0 }),
        status: t.Optional(
          t.Union([t.Literal("AVAILABLE"), t.Literal("MAINTENANCE"), t.Literal("INACTIVE")]),
        ),
        facilities: t.Optional(t.Array(t.String({ maxLength: 80 }), { maxItems: 20 })),
        image: t.Optional(t.String({ maxLength: 500 })),
        alt: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )
  .patch(
    "/admin/courts/:id",
    async (context) => {
      await requireAdmin(context);
      const { body, params } = context;
      const [existing] = await db
        .select()
        .from(courts)
        .where(eq(courts.id, params.id))
        .limit(1);
      if (!existing) throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");

      const patch: Partial<typeof courts.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.type !== undefined) patch.type = body.type;
      if (body.description !== undefined) patch.description = body.description;
      if (body.price !== undefined) patch.price = body.price;
      if (body.status !== undefined) patch.status = body.status;
      if (body.facilities !== undefined) patch.facilities = body.facilities;

      const [updated] = await db
        .update(courts)
        .set(patch)
        .where(eq(courts.id, params.id))
        .returning();
      if (!updated) throw new AppError(500, "INTERNAL_ERROR", "Gagal memperbarui lapangan");

      let image: { imageUrl: string; alt: string } | undefined;
      if (body.image !== undefined) {
        const [current] = await db
          .select()
          .from(courtImages)
          .where(eq(courtImages.courtId, params.id))
          .orderBy(asc(courtImages.position))
          .limit(1);
        if (current) {
          const [img] = await db
            .update(courtImages)
            .set({
              imageUrl: body.image,
              alt: body.alt ?? current.alt,
            })
            .where(eq(courtImages.id, current.id))
            .returning();
          image = img;
        } else if (body.image) {
          const [img] = await db
            .insert(courtImages)
            .values({
              id: await nextId("court_image"),
              courtId: params.id,
              imageUrl: body.image,
              alt: body.alt ?? updated.name,
              position: 0,
            })
            .returning();
          image = img;
        }
      } else {
        const [current] = await db
          .select()
          .from(courtImages)
          .where(eq(courtImages.courtId, params.id))
          .orderBy(asc(courtImages.position))
          .limit(1);
        image = current;
      }

      const scheduleRows = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.courtId, params.id)))
        .orderBy(asc(schedules.startTime));

      return ok({
        id: updated.id,
        name: updated.name,
        type: updated.type,
        label: courtLabel(updated.type),
        price: updated.price,
        description: updated.description,
        facilities: updated.facilities,
        status: updated.status,
        available: updated.status === "AVAILABLE",
        image: image?.imageUrl ?? null,
        alt: image?.alt ?? null,
        schedules: scheduleRows.map((row) => ({
          id: row.id,
          court_id: row.courtId,
          start_time: row.startTime,
          end_time: row.endTime,
          price: row.price,
          is_active: row.isActive,
        })),
      });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        type: t.Optional(t.Union([t.Literal("REGULAR"), t.Literal("PREMIUM"), t.Literal("VIP")])),
        description: t.Optional(t.String({ maxLength: 500 })),
        price: t.Optional(t.Integer({ minimum: 0 })),
        status: t.Optional(
          t.Union([t.Literal("AVAILABLE"), t.Literal("MAINTENANCE"), t.Literal("INACTIVE")]),
        ),
        facilities: t.Optional(t.Array(t.String({ maxLength: 80 }), { maxItems: 20 })),
        image: t.Optional(t.String({ maxLength: 500 })),
        alt: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )
  .delete(
    "/admin/courts/:id",
    async (context) => {
      await requireAdmin(context);
      const [existing] = await db
        .select({ id: courts.id })
        .from(courts)
        .where(eq(courts.id, context.params.id))
        .limit(1);
      if (!existing) throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(eq(bookings.courtId, context.params.id));
      if ((count ?? 0) > 0) {
        throw new AppError(
          409,
          "COURT_HAS_BOOKINGS",
          "Lapangan masih memiliki riwayat booking",
        );
      }

      await db.delete(courtImages).where(eq(courtImages.courtId, context.params.id));
      await db.delete(schedules).where(eq(schedules.courtId, context.params.id));
      await db.delete(courts).where(eq(courts.id, context.params.id));
      return ok({ id: context.params.id });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/admin/courts/:id/schedules",
    async (context) => {
      await requireAdmin(context);
      const [court] = await db
        .select({ id: courts.id })
        .from(courts)
        .where(eq(courts.id, context.params.id))
        .limit(1);
      if (!court) throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");

      const [row] = await db
        .insert(schedules)
        .values({
          id: await nextId("schedule"),
          courtId: context.params.id,
          startTime: context.body.startTime,
          endTime: context.body.endTime,
          price: context.body.price ?? null,
          isActive: context.body.isActive ?? true,
        })
        .returning();
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Gagal menambah jadwal");
      context.set.status = 201;
      return ok({
        id: row.id,
        court_id: row.courtId,
        start_time: row.startTime,
        end_time: row.endTime,
        price: row.price,
        is_active: row.isActive,
      });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        startTime: t.String({ pattern: "^\\d{2}:\\d{2}$" }),
        endTime: t.String({ pattern: "^\\d{2}:\\d{2}$" }),
        price: t.Optional(t.Integer({ minimum: 0 })),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/admin/schedules/:id",
    async (context) => {
      await requireAdmin(context);
      const [existing] = await db
        .select()
        .from(schedules)
        .where(eq(schedules.id, context.params.id))
        .limit(1);
      if (!existing) throw new AppError(404, "SCHEDULE_NOT_FOUND", "Jadwal tidak ditemukan");

      const patch: Partial<typeof schedules.$inferInsert> = {};
      if (context.body.price !== undefined) patch.price = context.body.price;
      if (context.body.isActive !== undefined) patch.isActive = context.body.isActive;
      if (context.body.startTime !== undefined) patch.startTime = context.body.startTime;
      if (context.body.endTime !== undefined) patch.endTime = context.body.endTime;

      const [updated] = await db
        .update(schedules)
        .set(patch)
        .where(eq(schedules.id, context.params.id))
        .returning();
      if (!updated) throw new AppError(500, "INTERNAL_ERROR", "Gagal memperbarui jadwal");
      return ok({
        id: updated.id,
        court_id: updated.courtId,
        start_time: updated.startTime,
        end_time: updated.endTime,
        price: updated.price,
        is_active: updated.isActive,
      });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        startTime: t.Optional(t.String({ pattern: "^\\d{2}:\\d{2}$" })),
        endTime: t.Optional(t.String({ pattern: "^\\d{2}:\\d{2}$" })),
        price: t.Optional(t.Integer({ minimum: 0 })),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete(
    "/admin/schedules/:id",
    async (context) => {
      await requireAdmin(context);
      const [existing] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(eq(schedules.id, context.params.id))
        .limit(1);
      if (!existing) throw new AppError(404, "SCHEDULE_NOT_FOUND", "Jadwal tidak ditemukan");
      await db.delete(schedules).where(eq(schedules.id, context.params.id));
      return ok({ id: context.params.id });
    },
    { params: t.Object({ id: t.String() }) },
  );

export const webhookRoutes = new Elysia({ name: "webhook" }).post(
  "/payments/webhook",
  async (context) => {
    const raw = rawBodyStore.get(context.request) ?? JSON.stringify(context.body);
    const signature =
      context.headers["x-signature"] ?? context.headers["X-Signature"] ?? undefined;
    if (!verifyWebhookSignature(raw, signature)) {
      throw new AppError(401, "INVALID_SIGNATURE", "Signature webhook tidak valid");
    }
    const payment = await handleWebhook(context.body as never);
    const [booking] = await db
      .select({ code: bookings.bookingCode })
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .limit(1);
    const { toPaymentApi } = await import("../services/payment.service");
    return ok(toPaymentApi(payment, booking?.code ?? payment.bookingId));
  },
  {
    parse: async (context) => {
      const text = await context.request.text();
      rawBodyStore.set(context.request, text);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return {};
      }
    },
    body: t.Object({
      paymentId: t.String({ minLength: 1 }),
      status: t.Union([
        t.Literal("PAID"),
        t.Literal("FAILED"),
        t.Literal("EXPIRED"),
        t.Literal("REFUNDED"),
      ]),
      transactionId: t.Optional(t.String({ maxLength: 64 })),
      amount: t.Optional(t.Number()),
      reference: t.Optional(t.String({ maxLength: 120 })),
    }),
  },
);

// Dipakai test untuk memastikan signing konsisten.
export { signWebhookBody };
