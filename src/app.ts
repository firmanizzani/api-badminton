import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import jwt from "@elysiajs/jwt";
import { env } from "./config/env";
import { AppError, fail, ok } from "./utils/response";
import { toWibIso } from "./utils/wib";
import { authModule } from "./modules/auth";
import { courtsModule } from "./modules/courts";
import { adminCourtRoutes, webhookRoutes } from "./modules/admin";
import {
  adminRoutes,
  availabilityRoutes,
  bookingRoutes,
  paymentRoutes,
} from "./modules/bookings";

export const app = new Elysia({ name: "smash-arena-api" })
  .use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Signature"],
    }),
  )
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET,
    }),
  )
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return fail(error.message, error.code);
    }

    const elysiaError = error as { status?: number; code?: string; message?: string };
    if (elysiaError.code === "VALIDATION" || elysiaError.status === 422) {
      set.status = 422;
      return fail(elysiaError.message ?? "Validasi gagal", "VALIDATION");
    }
    if (typeof elysiaError.status === "number" && elysiaError.status >= 400) {
      set.status = elysiaError.status;
      return fail(elysiaError.message ?? "Request gagal", "REQUEST_ERROR");
    }

    console.error("[api] unhandled error:", error);
    set.status = 500;
    return fail("Terjadi kesalahan pada server", "INTERNAL_ERROR");
  })
  .get("/api/health", () => ok({ status: "ok", time: toWibIso(new Date()) }))
  .group("/api", (group) =>
    group
      .use(authModule)
      .use(courtsModule)
      .use(availabilityRoutes)
      .use(bookingRoutes)
      .use(paymentRoutes)
      .use(adminRoutes)
      .use(adminCourtRoutes)
      .use(webhookRoutes),
  );
