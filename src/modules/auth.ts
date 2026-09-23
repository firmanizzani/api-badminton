import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  requireAuth,
  type AuthContext,
} from "../middleware/auth";
import { AppError, ok } from "../utils/response";
import { hashPassword, verifyPassword } from "../utils/password";
import { env } from "../config/env";
import { nextId } from "../utils/id";
import { toWibIso } from "../utils/wib";

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "USER" | "ADMIN";
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

interface JwtSigner {
  sign(payload: Record<string, unknown>): Promise<string>;
  verify(token: string): Promise<Record<string, unknown> | false>;
}

function getJwt(context: unknown): JwtSigner {
  const jwt = (context as AuthContext).jwt;
  if (!jwt) throw new AppError(500, "INTERNAL_ERROR", "JWT plugin tidak terpasang");
  return jwt as JwtSigner;
}

type SetLike = {
  cookie?: Record<string, unknown> | undefined;
  status?: number | string | undefined;
};

async function issueSession(
  user: { id: string; role: "USER" | "ADMIN" },
  set: SetLike,
  jwt: JwtSigner,
): Promise<void> {
  const sessionId = await nextId("session");
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });

  const token = await jwt.sign({
    sub: user.id,
    jti: sessionId,
    role: user.role,
    exp: Math.floor((Date.now() + SESSION_TTL_SECONDS * 1000) / 1000),
  });

  if (!set.cookie) set.cookie = {};
  // Cross-origin (frontend/backend beda domain): butuh SameSite=None + Secure.
  const secure = env.FRONTEND_URL.startsWith("https://");
  set.cookie[SESSION_COOKIE] = {
    value: token,
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export const authModule = new Elysia({ name: "auth" })
  .post(
    "/auth/register",
    async (context) => {
      const { body, set } = context;
      const jwt = getJwt(context);
      const email = body.email.trim().toLowerCase();
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing.length > 0) {
        throw new AppError(409, "EMAIL_EXISTS", "Email sudah terdaftar");
      }

      const passwordHash = await hashPassword(body.password);
      const [user] = await db
        .insert(users)
        .values({
          id: await nextId("user"),
          name: body.name.trim(),
          email,
          phone: body.phone.trim(),
          passwordHash,
          role: "USER",
          status: "ACTIVE",
        })
        .returning();
      if (!user) throw new AppError(500, "INTERNAL_ERROR", "Gagal membuat akun");

      await issueSession(user, set, jwt);
      set.status = 201;
      return ok(publicUser(user));
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        email: t.String({ format: "email", maxLength: 160 }),
        phone: t.String({ minLength: 1, maxLength: 32 }),
        password: t.String({ minLength: 6, maxLength: 72 }),
      }),
    },
  )
  .post(
    "/auth/login",
    async (context) => {
      const { body, set } = context;
      const jwt = getJwt(context);
      const email = body.email.trim().toLowerCase();
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
      if (!user || !valid) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Email atau password salah");
      }
      if (user.status !== "ACTIVE") {
        throw new AppError(403, "ACCOUNT_DISABLED", "Akun nonaktif");
      }

      await issueSession(user, set, jwt);
      return ok(publicUser(user));
    },
    {
      body: t.Object({
        email: t.String({ format: "email", maxLength: 160 }),
        password: t.String({ minLength: 1, maxLength: 72 }),
      }),
    },
  )
  .post("/auth/logout", async (context) => {
    const { cookie, set } = context;
    const jwt = getJwt(context);
    const token = cookie[SESSION_COOKIE]?.value;
    if (typeof token === "string" && token) {
      const payload = await jwt.verify(token);
      if (payload && typeof payload.jti === "string") {
        await db.delete(sessions).where(eq(sessions.id, payload.jti));
      }
    }
set.status = 200;
  if (!set.cookie) set.cookie = {};
  const secureOut = env.FRONTEND_URL.startsWith("https://");
  set.cookie[SESSION_COOKIE] = {
    value: "",
    httpOnly: true,
    sameSite: secureOut ? "none" : "lax",
    secure: secureOut,
    path: "/",
    maxAge: 0,
  };
  return ok(null);
  })
  .get("/auth/me", async (context) => {
    const user = await requireAuth(context);
    return ok(publicUser(user));
  })
  .get(
    "/users/:id",
    async (context) => {
      const auth = await requireAuth(context);
      if (auth.id !== context.params.id && auth.role !== "ADMIN") {
        throw new AppError(403, "FORBIDDEN", "Bukan akun Anda");
      }
      const [user] = await db.select().from(users).where(eq(users.id, context.params.id)).limit(1);
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "Pengguna tidak ditemukan");
      return ok({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        password_hash: "",
        created_at: toWibIso(user.createdAt),
        updated_at: toWibIso(user.updatedAt),
      });
    },
    { params: t.Object({ id: t.String() }) },
  );

// env dipakai indirekt oleh plugin jwt di app.ts — re-export mencegah unused import.
void env;
