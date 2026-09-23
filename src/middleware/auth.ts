import { eq } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { AppError } from "../utils/response";

export const SESSION_COOKIE = "smash_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 hari

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  phone: string;
  status: "ACTIVE" | "INACTIVE";
}

interface JwtLike {
  verify(token: string): Promise<Record<string, unknown> | false>;
}

export interface AuthContext {
  jwt?: JwtLike | undefined;
  cookie?: Record<string, { value?: unknown } | undefined> | undefined;
}

function readToken(context: AuthContext): string | undefined {
  const cookie = context.cookie?.[SESSION_COOKIE];
  const value = cookie && typeof cookie === "object" ? cookie.value : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function requireAuth(context: AuthContext): Promise<AuthUser> {
  if (!context.jwt) {
    throw new AppError(500, "INTERNAL_ERROR", "JWT plugin tidak terpasang");
  }
  const token = readToken(context);
  if (!token) throw new AppError(401, "UNAUTHORIZED", "Silakan login terlebih dahulu");

  const payload = await context.jwt.verify(token);
  if (!payload) throw new AppError(401, "INVALID_TOKEN", "Sesi tidak valid");

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  const sessionId = typeof payload.jti === "string" ? payload.jti : "";
  if (!userId || !sessionId) throw new AppError(401, "INVALID_TOKEN", "Sesi tidak valid");

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await db.delete(sessions).where(eq(sessions.id, sessionId));
    throw new AppError(401, "SESSION_EXPIRED", "Sesi berakhir, silakan login kembali");
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Akun tidak ditemukan");
  if (user.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_DISABLED", "Akun nonaktif");

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
  };
}

export async function requireAdmin(context: AuthContext): Promise<AuthUser> {
  const user = await requireAuth(context);
  if (user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "Akses khusus admin");
  }
  return user;
}
