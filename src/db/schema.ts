import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { toWibParam } from "../utils/wib";

export const userRoleEnum = pgEnum("user_role", ["USER", "ADMIN"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "INACTIVE"]);
export const courtTypeEnum = pgEnum("court_type", ["REGULAR", "PREMIUM", "VIP"]);
export const courtStatusEnum = pgEnum("court_status", ["AVAILABLE", "MAINTENANCE", "INACTIVE"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "EXPIRED",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["QRIS", "BANK_TRANSFER", "EWALLET"]);

/** Jam WIB (Asia/Jakarta) sebagai timestamp tanpa zona — disimpan apa adanya di DB. */
const wibNow = sql`(now() AT TIME ZONE 'Asia/Jakarta')`;

/**
 * timestamp tanpa zona yang selalu wall-clock WIB:
 * write → "YYYY-MM-DD HH:MM:SS.mmm" (bukan toISOString UTC)
 * read  → Date +07:00 (type parser pg juga menangani raw SQL)
 */
const wibTimestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => "timestamp",
  toDriver: (value: Date) => toWibParam(value),
  fromDriver: (value: string | Date) =>
    value instanceof Date ? value : new Date(`${String(value).replace(" ", "T")}+07:00`),
});

const createdAt = wibTimestamp("created_at").notNull().default(wibNow);
const updatedAt = wibTimestamp("updated_at")
  .notNull()
  .default(wibNow)
  .$onUpdateFn(() => wibNow);

export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("USER"),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const courts = pgTable(
  "courts",
  {
    id: varchar("id", { length: 16 }).primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    type: courtTypeEnum("type").notNull(),
    description: text("description").notNull().default(""),
    price: integer("price").notNull(),
    status: courtStatusEnum("status").notNull().default("AVAILABLE"),
    facilities: text("facilities").array().notNull().default([]),
    createdAt,
    updatedAt,
  },
  (table) => [index("courts_status_idx").on(table.status)],
);

export const courtImages = pgTable(
  "court_images",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    courtId: varchar("court_id", { length: 16 })
      .notNull()
      .references(() => courts.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("court_images_court_idx").on(table.courtId)],
);

export const schedules = pgTable(
  "schedules",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    courtId: varchar("court_id", { length: 16 })
      .notNull()
      .references(() => courts.id, { onDelete: "cascade" }),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    price: integer("price"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("schedules_court_start_unique").on(table.courtId, table.startTime)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    bookingCode: varchar("booking_code", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    courtId: varchar("court_id", { length: 16 })
      .notNull()
      .references(() => courts.id, { onDelete: "restrict" }),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    duration: integer("duration").notNull(),
    totalPrice: integer("total_price").notNull(),
    status: bookingStatusEnum("status").notNull().default("PENDING"),
    customerName: varchar("customer_name", { length: 120 }).notNull(),
    customerEmail: varchar("customer_email", { length: 160 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 32 }).notNull().default(""),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("bookings_code_unique").on(table.bookingCode),
    index("bookings_court_date_idx").on(table.courtId, table.bookingDate),
    index("bookings_user_idx").on(table.userId),
    index("bookings_date_idx").on(table.bookingDate),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    bookingId: varchar("booking_id", { length: 40 })
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    transactionId: text("transaction_id"),
    reference: text("reference"),
    paidAt: wibTimestamp("paid_at"),
    createdAt,
    updatedAt,
  },
  (table) => [index("payments_status_idx").on(table.status)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    userId: varchar("user_id", { length: 40 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: wibTimestamp("expires_at").notNull(),
    createdAt,
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  bookings: many(bookings),
  sessions: many(sessions),
}));

export const courtsRelations = relations(courts, ({ many }) => ({
  images: many(courtImages),
  schedules: many(schedules),
  bookings: many(bookings),
}));

export const courtImagesRelations = relations(courtImages, ({ one }) => ({
  court: one(courts, { fields: [courtImages.courtId], references: [courts.id] }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  court: one(courts, { fields: [schedules.courtId], references: [courts.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
  court: one(courts, { fields: [bookings.courtId], references: [courts.id] }),
  payment: one(payments, { fields: [bookings.id], references: [payments.bookingId] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Court = typeof courts.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Session = typeof sessions.$inferSelect;
