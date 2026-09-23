import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { bookings, payments } from "../db/schema";
import type { Payment } from "../db/schema";
import { AppError } from "../utils/response";
import { env } from "../config/env";
import { toWibIso } from "../utils/wib";
import { nextId } from "../utils/id";

export interface PaymentApi {
  id: string;
  booking_id: string;
  amount: number;
  method: Payment["method"];
  status: Payment["status"];
  transaction_id: string | null;
  reference: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

/** booking_id selalu dikembalikan sebagai booking_code (bukan id internal). */
export function toPaymentApi(payment: Payment, bookingCode: string): PaymentApi {
  return {
    id: payment.id,
    booking_id: bookingCode,
    amount: payment.amount,
    method: payment.method,
    status: payment.status,
    transaction_id: payment.transactionId,
    reference: payment.reference,
    paid_at: payment.paidAt ? toWibIso(payment.paidAt) : null,
    created_at: toWibIso(payment.createdAt),
    updated_at: toWibIso(payment.updatedAt),
  };
}

export interface CreatePaymentInput {
  bookingId: string;
  method: Payment["method"];
  amount?: number;
  reference?: string;
}

async function findBookingRow(idOrCode: string) {
  const rows = await db
    .select()
    .from(bookings)
    .where(sql`${bookings.id} = ${idOrCode} OR ${bookings.bookingCode} = ${idOrCode}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function createPayment(
  input: CreatePaymentInput,
  user: { id: string; role: "USER" | "ADMIN" },
): Promise<{ payment: Payment; bookingCode: string }> {
  return await db.transaction(async (tx) => {
    const booking = await findBookingRow(input.bookingId);
    if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking tidak ditemukan");
    if (booking.userId !== user.id && user.role !== "ADMIN") {
      throw new AppError(403, "FORBIDDEN", "Bukan booking milik Anda");
    }
    if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
      throw new AppError(409, "BOOKING_INACTIVE", "Booking tidak dapat dibayar");
    }
    if (booking.status === "COMPLETED") {
      throw new AppError(409, "BOOKING_COMPLETED", "Booking sudah selesai");
    }

    const [existing] = await tx
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id))
      .limit(1);

    if (existing && existing.status === "PAID") {
      throw new AppError(409, "PAYMENT_EXISTS", "Pembayaran sudah lunas");
    }

    if (existing) {
      const [updated] = await tx
        .update(payments)
        .set({
          method: input.method,
          amount: booking.totalPrice,
          status: "PENDING",
          reference: input.reference?.trim() || existing.reference,
        })
        .where(eq(payments.id, existing.id))
        .returning();
      if (!updated) throw new AppError(500, "INTERNAL_ERROR", "Gagal memperbarui pembayaran");
      return { payment: updated, bookingCode: booking.bookingCode };
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        id: await nextId("payment"),
        bookingId: booking.id,
        amount: booking.totalPrice,
        method: input.method,
        status: "PENDING",
        reference: input.reference?.trim() || null,
      })
      .returning();
    if (!payment) throw new AppError(500, "INTERNAL_ERROR", "Gagal membuat pembayaran");
    return { payment, bookingCode: booking.bookingCode };
  });
}

export interface SettleInput {
  paymentId: string;
  status: "PAID" | "FAILED" | "EXPIRED" | "REFUNDED";
  transactionId?: string;
  amount?: number;
  reference?: string;
}

export async function settlePayment(input: SettleInput): Promise<Payment> {
  return await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1);
    if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Pembayaran tidak ditemukan");

    if (payment.status === input.status && input.status === "PAID") {
      return payment; // idempotent webhook / verify ulang
    }

    if (input.amount !== undefined && input.amount !== payment.amount) {
      throw new AppError(400, "AMOUNT_MISMATCH", "Jumlah pembayaran tidak cocok");
    }

    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .limit(1);
    if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking tidak ditemukan");

    const now = new Date();
    const patch: Partial<typeof payments.$inferInsert> = {
      status: input.status,
    };
    if (input.transactionId) patch.transactionId = input.transactionId;
    if (input.reference !== undefined) patch.reference = input.reference;
    if (input.status === "PAID") {
      patch.paidAt = payment.paidAt ?? now;
      if (!patch.transactionId && !payment.transactionId) {
        patch.transactionId = `TXN${now.getTime()}`;
      }
    }

    const [updated] = await tx
      .update(payments)
      .set(patch)
      .where(eq(payments.id, payment.id))
      .returning();
    if (!updated) throw new AppError(500, "INTERNAL_ERROR", "Gagal memperbarui pembayaran");

    if (input.status === "PAID" && booking.status === "PENDING") {
      await tx
        .update(bookings)
        .set({ status: "CONFIRMED" })
        .where(eq(bookings.id, booking.id));
    }
    if (input.status === "REFUNDED" && booking.status !== "CANCELLED") {
      await tx
        .update(bookings)
        .set({ status: "CANCELLED" })
        .where(eq(bookings.id, booking.id));
    }

    return updated;
  });
}

export function signWebhookBody(rawBody: string): string {
  return createHmac("sha256", env.WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = signWebhookBody(rawBody);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface WebhookBody {
  paymentId: string;
  status: "PAID" | "FAILED" | "EXPIRED" | "REFUNDED";
  transactionId?: string;
  amount?: number;
  reference?: string;
}

export async function handleWebhook(body: WebhookBody): Promise<Payment> {
  if (!body.paymentId || typeof body.paymentId !== "string") {
    throw new AppError(400, "VALIDATION", "paymentId wajib diisi");
  }
  const allowed = ["PAID", "FAILED", "EXPIRED", "REFUNDED"];
  if (!allowed.includes(body.status)) {
    throw new AppError(400, "VALIDATION", "Status tidak valid");
  }
  return await settlePayment({
    paymentId: body.paymentId,
    status: body.status,
    transactionId: body.transactionId,
    amount: body.amount,
    reference: body.reference,
  });
}
