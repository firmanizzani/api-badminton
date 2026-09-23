import { and, eq, gt, lt, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { bookings, courts, payments, schedules } from "../db/schema";
import type { Booking, Court, Payment } from "../db/schema";
import { AppError } from "../utils/response";
import { toPaymentApi, type PaymentApi } from "./payment.service";
import { DATE_RE, TIME_RE, nowHHMM, pad4, todayISO } from "../utils/time";
import { toWibIso } from "../utils/wib";
import { nextId } from "../utils/id";

export interface BookingApi {
  id: string;
  user_id: string;
  court_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration: number;
  total_price: number;
  status: Booking["status"];
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  court_name: string;
  court_tier: Court["type"];
  created_at: string;
  updated_at: string;
  payment: PaymentApi | null;
}

export function mapBooking(
  booking: Booking,
  court: Pick<Court, "name" | "type"> | null | undefined,
  payment: Payment | null | undefined,
): BookingApi {
  return {
    id: booking.bookingCode,
    user_id: booking.userId,
    court_id: booking.courtId,
    booking_date: booking.bookingDate,
    start_time: booking.startTime,
    end_time: booking.endTime,
    duration: booking.duration,
    total_price: booking.totalPrice,
    status: booking.status,
    customer_name: booking.customerName,
    customer_email: booking.customerEmail,
    customer_phone: booking.customerPhone,
    court_name: court?.name ?? booking.courtId,
    court_tier: court?.type ?? "REGULAR",
    created_at: toWibIso(booking.createdAt),
    updated_at: toWibIso(booking.updatedAt),
    payment: payment ? toPaymentApi(payment, booking.bookingCode) : null,
  };
}

const BLOCKING_STATUSES = ["CANCELLED", "EXPIRED"] as const;

export async function findBookingByCode(codeOrId: string): Promise<Booking | null> {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      sql`${bookings.id} = ${codeOrId} OR ${bookings.bookingCode} = ${codeOrId}`,
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateBookingInput {
  courtId: string;
  bookingDate: string;
  startTime: string;
  duration: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface CreateBookingResult {
  booking: Booking;
  court: Court;
}

export async function createBooking(
  input: CreateBookingInput,
  user: { id: string; name: string; email: string; phone: string },
): Promise<CreateBookingResult> {
  const { courtId, bookingDate, startTime, duration } = input;

  if (!DATE_RE.test(bookingDate)) {
    throw new AppError(400, "VALIDATION", "Format tanggal tidak valid (YYYY-MM-DD)");
  }
  if (!TIME_RE.test(startTime)) {
    throw new AppError(400, "VALIDATION", "Format jam tidak valid (HH:MM)");
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 3) {
    throw new AppError(400, "VALIDATION", "Durasi harus 1–3 jam");
  }

  const today = todayISO();
  if (bookingDate < today) {
    throw new AppError(409, "PAST_DATE", "Tanggal booking sudah lewat");
  }
  if (bookingDate === today && startTime <= nowHHMM()) {
    throw new AppError(409, "PAST_SLOT", "Jam tersebut sudah lewat");
  }

  const endHour = Number(startTime.slice(0, 2)) + duration;
  if (endHour > 23) {
    throw new AppError(400, "VALIDATION", "Durasi melewati jam tutup 23:00");
  }
  const endTime = `${String(endHour).padStart(2, "0")}:00`;

  const created = await db.transaction(async (tx) => {
    const courtRows = await tx
      .select()
      .from(courts)
      .where(eq(courts.id, courtId))
      .for("update");
    const court = courtRows[0];
    if (!court) throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");
    if (court.status !== "AVAILABLE") {
      throw new AppError(409, "COURT_UNAVAILABLE", "Lapangan tidak tersedia");
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`booking:${bookingDate}`})::bigint)`,
    );

    const conflicts = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.courtId, courtId),
          eq(bookings.bookingDate, bookingDate),
          notInArray(bookings.status, [...BLOCKING_STATUSES]),
          lt(bookings.startTime, endTime),
          gt(bookings.endTime, startTime),
        ),
      )
      .limit(1);
    if (conflicts.length > 0) {
      throw new AppError(409, "BOOKING_CONFLICT", "Slot sudah dipesan orang lain");
    }

    const activeSchedules = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.courtId, courtId), eq(schedules.isActive, true)));

    let totalPrice = 0;
    const startHour = Number(startTime.slice(0, 2));
    for (let hour = startHour; hour < startHour + duration; hour += 1) {
      const slotStart = `${String(hour).padStart(2, "0")}:00`;
      const schedule = activeSchedules.find((item) => item.startTime === slotStart);
      if (!schedule) {
        throw new AppError(409, "SLOT_UNAVAILABLE", `Slot ${slotStart} tidak tersedia`);
      }
      totalPrice += schedule.price ?? court.price;
    }

    const existingCodes = await tx
      .select({ code: bookings.bookingCode })
      .from(bookings)
      .where(eq(bookings.bookingDate, bookingDate));
    let maxSeq = 0;
    for (const row of existingCodes) {
      const match = row.code.match(/-(\d{4})$/);
      if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
    }
    const bookingCode = `SMASH-${bookingDate.replace(/-/g, "")}-${pad4(maxSeq + 1)}`;
    const id = await nextId("booking");

    const [booking] = await tx
      .insert(bookings)
      .values({
        id,
        bookingCode,
        userId: user.id,
        courtId,
        bookingDate,
        startTime,
        endTime,
        duration,
        totalPrice,
        status: "PENDING",
        customerName: input.customerName?.trim() || user.name,
        customerEmail: input.customerEmail?.trim() || user.email,
        customerPhone: input.customerPhone?.trim() || user.phone,
      })
      .returning();

    if (!booking) throw new AppError(500, "INTERNAL_ERROR", "Gagal membuat booking");
    return { booking, court };
  });

  return created;
}

export interface TimeSlot {
  start: string;
  end: string;
  status: "AVAILABLE" | "BOOKED";
}

export async function getAvailability(dateISO: string, courtId: string): Promise<TimeSlot[]> {
  if (!DATE_RE.test(dateISO)) {
    throw new AppError(400, "VALIDATION", "Format tanggal tidak valid (YYYY-MM-DD)");
  }
  const [court] = await db.select({ id: courts.id }).from(courts).where(eq(courts.id, courtId)).limit(1);
  if (!court) throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");

  const activeSchedules = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.courtId, courtId), eq(schedules.isActive, true)));

  const blocking = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.courtId, courtId),
        eq(bookings.bookingDate, dateISO),
        notInArray(bookings.status, [...BLOCKING_STATUSES]),
      ),
    );

  const today = todayISO();
  const now = nowHHMM();
  return activeSchedules
    .map((schedule) => ({
      start: schedule.startTime,
      end: schedule.endTime,
      status:
        blocking.some(
          (booking) => booking.startTime < schedule.endTime && booking.endTime > schedule.startTime,
        ) || (dateISO === today && schedule.startTime <= now)
          ? ("BOOKED" as const)
          : ("AVAILABLE" as const),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface CancelResult {
  booking: Booking;
  refunded: boolean;
}

export async function cancelBooking(
  codeOrId: string,
  requester: { id: string; role: "USER" | "ADMIN" },
): Promise<CancelResult> {
  const booking = await findBookingByCode(codeOrId);
  if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking tidak ditemukan");
  if (booking.userId !== requester.id && requester.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "Bukan booking milik Anda");
  }
  if (booking.status === "CANCELLED") {
    throw new AppError(409, "ALREADY_CANCELLED", "Booking sudah dibatalkan");
  }
  if (booking.status === "COMPLETED" || booking.status === "EXPIRED") {
    throw new AppError(409, "NOT_CANCELLABLE", "Booking tidak bisa dibatalkan");
  }

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bookings)
      .set({ status: "CANCELLED" })
      .where(eq(bookings.id, booking.id))
      .returning();
    if (!updated) throw new AppError(500, "INTERNAL_ERROR", "Gagal membatalkan booking");

    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id))
      .limit(1);

    let refunded = false;
    if (payment && payment.status === "PAID") {
      await tx
        .update(payments)
        .set({ status: "REFUNDED" })
        .where(eq(payments.id, payment.id));
      refunded = true;
    }

    return { booking: updated, refunded };
  });
}
