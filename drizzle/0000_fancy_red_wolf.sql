CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."court_status" AS ENUM('AVAILABLE', 'MAINTENANCE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."court_type" AS ENUM('REGULAR', 'PREMIUM', 'VIP');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('QRIS', 'BANK_TRANSFER', 'EWALLET');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"booking_code" varchar(32) NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"court_id" varchar(16) NOT NULL,
	"booking_date" date NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"duration" integer NOT NULL,
	"total_price" integer NOT NULL,
	"status" "booking_status" DEFAULT 'PENDING' NOT NULL,
	"customer_name" varchar(120) NOT NULL,
	"customer_email" varchar(160) NOT NULL,
	"customer_phone" varchar(32) DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "court_images" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"court_id" varchar(16) NOT NULL,
	"image_url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courts" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" "court_type" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"status" "court_status" DEFAULT 'AVAILABLE' NOT NULL,
	"facilities" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"booking_id" varchar(40) NOT NULL,
	"amount" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"transaction_id" text,
	"reference" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"court_id" varchar(16) NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"price" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" varchar(40) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(160) NOT NULL,
	"phone" varchar(32) DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'Asia/Jakarta') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_court_id_courts_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."courts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_code_unique" ON "bookings" USING btree ("booking_code");--> statement-breakpoint
CREATE INDEX "bookings_court_date_idx" ON "bookings" USING btree ("court_id","booking_date");--> statement-breakpoint
CREATE INDEX "bookings_user_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_date_idx" ON "bookings" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "court_images_court_idx" ON "court_images" USING btree ("court_id");--> statement-breakpoint
CREATE INDEX "courts_status_idx" ON "courts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_court_start_unique" ON "schedules" USING btree ("court_id","start_time");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");