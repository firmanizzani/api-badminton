/** Format Date → ISO string WIB (Asia/Jakarta, +07:00). */
export function toWibIso(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.000+07:00`;
}

/** Date → wall-clock WIB `YYYY-MM-DD HH:MM:SS.mmm` (untuk kolom timestamp tanpa zona). */
export function toWibParam(date: Date): string {
  const iso = toWibIso(date); // 2026-09-23T11:51:48.000+07:00
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}
