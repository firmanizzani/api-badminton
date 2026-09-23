import { Elysia, t } from "elysia";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { courtImages, courts, schedules } from "../db/schema";
import type { Court } from "../db/schema";
import { AppError, ok } from "../utils/response";

export interface CourtSummary {
  id: string;
  name: string;
  type: Court["type"];
  label: string;
  price: number;
  description: string;
  facilities: string[];
  status: Court["status"];
  available: boolean;
  image: string | null;
  alt: string | null;
}

const TIER_LABEL: Record<Court["type"], string> = {
  REGULAR: "Regular Court",
  PREMIUM: "Premium Court",
  VIP: "VIP Court",
};

export function courtLabel(type: Court["type"]): string {
  return TIER_LABEL[type];
}

export async function loadCourtSummaries(includeInactive = false): Promise<CourtSummary[]> {
  const rows = await db
    .select()
    .from(courts)
    .where(includeInactive ? undefined : ne(courts.status, "INACTIVE"))
    .orderBy(asc(courts.id));
  if (rows.length === 0) return [];

  const images = await db
    .select()
    .from(courtImages)
    .where(
      inArray(
        courtImages.courtId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(courtImages.position));
  const imageByCourt = new Map(images.map((img) => [img.courtId, img]));

  return rows.map((court) => {
    const image = imageByCourt.get(court.id);
    return {
      id: court.id,
      name: court.name,
      type: court.type,
      label: TIER_LABEL[court.type],
      price: court.price,
      description: court.description,
      facilities: court.facilities,
      status: court.status,
      available: court.status === "AVAILABLE",
      image: image?.imageUrl ?? null,
      alt: image?.alt ?? null,
    };
  });
}

export interface ScheduleApi {
  id: string;
  court_id: string;
  start_time: string;
  end_time: string;
  price: number | null;
  is_active: boolean;
}

function mapSchedule(row: typeof schedules.$inferSelect): ScheduleApi {
  return {
    id: row.id,
    court_id: row.courtId,
    start_time: row.startTime,
    end_time: row.endTime,
    price: row.price,
    is_active: row.isActive,
  };
}

export const courtsModule = new Elysia({ name: "courts" })
  .get("/courts", async () => ok(await loadCourtSummaries(false)))
  .get(
    "/courts/:id",
    async ({ params }) => {
      const rows = await db.select().from(courts).where(eq(courts.id, params.id)).limit(1);
      const court = rows[0];
      if (!court || court.status === "INACTIVE") {
        throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");
      }
      const [image] = await db
        .select()
        .from(courtImages)
        .where(eq(courtImages.courtId, court.id))
        .orderBy(asc(courtImages.position))
        .limit(1);
      return ok({
        id: court.id,
        name: court.name,
        type: court.type,
        label: TIER_LABEL[court.type],
        price: court.price,
        description: court.description,
        facilities: court.facilities,
        status: court.status,
        available: court.status === "AVAILABLE",
        image: image?.imageUrl ?? null,
        alt: image?.alt ?? null,
      });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/courts/:id/schedules",
    async ({ params }) => {
      const [court] = await db.select({ id: courts.id }).from(courts).where(eq(courts.id, params.id)).limit(1);
      if (!court) throw new AppError(404, "COURT_NOT_FOUND", "Lapangan tidak ditemukan");
      const rows = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.courtId, params.id), eq(schedules.isActive, true)))
        .orderBy(asc(schedules.startTime));
      return ok(rows.map(mapSchedule));
    },
    { params: t.Object({ id: t.String() }) },
  );
