import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { courtImages, courts, schedules, users } from "./schema";
import { hashPassword } from "../utils/password";
import { nextId } from "../utils/id";

const image = (id: number, width = 1000) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;

const SEED_COURTS = [
  {
    id: "court-00001",
    name: "Court 01",
    type: "REGULAR" as const,
    price: 50000,
    description: "Lapangan nyaman untuk latihan rutin dan permainan santai bersama teman.",
    facilities: ["Premium Flooring", "LED Lighting", "Standard Net"],
    image: image(32975183),
    alt: "Suasana pertandingan badminton indoor di lapangan Court 01 Smash Arena",
  },
  {
    id: "court-00002",
    name: "Court 02",
    type: "REGULAR" as const,
    price: 50000,
    description: "Pilihan favorit komunitas untuk sparring malam dengan pencahayaan merata.",
    facilities: ["Premium Flooring", "LED Lighting", "Standard Net"],
    image: image(36815793),
    alt: "Raket badminton di atas lantai lapangan indoor Court 02",
  },
  {
    id: "court-00003",
    name: "Court 03",
    type: "PREMIUM" as const,
    price: 75000,
    description: "Lantai vinyl premium dan pencahayaan anti-glare untuk permainan intens.",
    facilities: ["Premium Flooring", "LED Lighting", "Professional Net"],
    image: image(8007076),
    alt: "Pemain badminton siap melayani di lapangan premium Court 03",
  },
  {
    id: "court-00004",
    name: "Court 04",
    type: "PREMIUM" as const,
    price: 75000,
    description: "Lapangan premium dengan ruang gerak lega dan suhu ruangan terjaga.",
    facilities: ["Premium Flooring", "LED Lighting", "Professional Net"],
    image: image(8007405),
    alt: "Pemain badminton memegang raket di lapangan premium Court 04",
  },
  {
    id: "court-00005",
    name: "Court 05",
    type: "VIP" as const,
    price: 100000,
    description: "Lapangan eksklusif dengan lantai tournament-grade dan net profesional.",
    facilities: ["Premium Flooring", "Pro Tournament Net", "VIP Lounge Access"],
    image: image(8007176),
    alt: "Raket dan shuttlecock di lapangan VIP Court 05",
  },
  {
    id: "court-00006",
    name: "Court 06",
    type: "VIP" as const,
    price: 100000,
    description: "VIP terjauh dari area tunggu, ideal untuk latihan fokus dan coaching.",
    facilities: ["Premium Flooring", "Pro Tournament Net", "VIP Lounge Access"],
    image: image(8007483),
    alt: "Shuttlecock diambil dari lantai lapangan VIP Court 06",
  },
];

const SEED_USERS = [
  {
    name: "Admin Smash Arena",
    email: "admin@example.com",
    phone: "6281111111111",
    password: "Admin123!",
    role: "ADMIN" as const,
  },
  {
    name: "Customer Smash",
    email: "customer@example.com",
    phone: "6282222222222",
    password: "Customer123!",
    role: "USER" as const,
  },
];

const SLOTS: { start: string; end: string }[] = Array.from({ length: 17 }, (_, i) => {
  const hour = i + 6;
  return {
    start: `${String(hour).padStart(2, "0")}:00`,
    end: `${String(hour + 1).padStart(2, "0")}:00`,
  };
});

async function seed(): Promise<void> {
  for (const user of SEED_USERS) {
    const passwordHash = await hashPassword(user.password);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);
    if (existing) {
      await db
        .update(users)
        .set({ name: user.name, phone: user.phone, role: user.role, status: "ACTIVE" })
        .where(eq(users.email, user.email));
    } else {
      await db.insert(users).values({
        id: await nextId("user"),
        name: user.name,
        email: user.email,
        phone: user.phone,
        passwordHash,
        role: user.role,
        status: "ACTIVE",
      });
    }
  }

  for (const court of SEED_COURTS) {
    await db
      .insert(courts)
      .values({
        id: court.id,
        name: court.name,
        type: court.type,
        description: court.description,
        price: court.price,
        status: "AVAILABLE",
        facilities: court.facilities,
      })
      .onConflictDoUpdate({
        target: courts.id,
        set: {
          name: court.name,
          type: court.type,
          description: court.description,
          price: court.price,
          status: "AVAILABLE",
          facilities: court.facilities,
        },
      });

    const existingImage = await db
      .select({ id: courtImages.id })
      .from(courtImages)
      .where(eq(courtImages.courtId, court.id))
      .limit(1);
    if (existingImage.length === 0) {
      await db.insert(courtImages).values({
        id: await nextId("court_image"),
        courtId: court.id,
        imageUrl: court.image,
        alt: court.alt,
        position: 0,
      });
    }

    for (const slot of SLOTS) {
      const [existingSlot] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(and(eq(schedules.courtId, court.id), eq(schedules.startTime, slot.start)))
        .limit(1);
      if (existingSlot) {
        await db
          .update(schedules)
          .set({ endTime: slot.end, isActive: true })
          .where(eq(schedules.id, existingSlot.id));
      } else {
        await db.insert(schedules).values({
          id: await nextId("schedule"),
          courtId: court.id,
          startTime: slot.start,
          endTime: slot.end,
          price: null,
          isActive: true,
        });
      }
    }
  }

  const [courtCount] = await db.select({ count: sql<number>`count(*)::int` }).from(courts);
  const [scheduleCount] = await db.select({ count: sql<number>`count(*)::int` }).from(schedules);
  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  console.log(
    `Seed selesai: ${userCount.count} users, ${courtCount.count} courts, ${scheduleCount.count} schedules.`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed gagal:", error);
    process.exit(1);
  });
