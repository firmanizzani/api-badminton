export const pad2 = (n: number): string => String(n).padStart(2, "0");

export const pad4 = (n: number): string => String(n).padStart(4, "0");

function wibParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

export function todayISO(now: Date = new Date()): string {
  const p = wibParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function nowHHMM(now: Date = new Date()): string {
  const p = wibParts(now);
  return `${p.hour}:${p.minute}`;
}

export function addHoursHHMM(hhmm: string, hours: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;
