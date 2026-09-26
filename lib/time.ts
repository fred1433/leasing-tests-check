/** Leasing office time zone. All wall-clock rules are evaluated here, never in UTC or server time. */
export const OFFICE_TZ = "America/Toronto";

const parts = (date: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: OFFICE_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

export function localParts(date: Date) {
  return parts(date);
}

/** Minutes since local midnight in the office time zone. */
export function localMinutes(date: Date): number {
  const p = parts(date);
  return p.hour * 60 + p.minute;
}

/** The instant at which the office wall clock shows the given local date and time. Handles DST. */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute = 0): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const wanted = Date.UTC(year, month - 1, day, hour, minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "4:00 p.m." Built by hand: ICU output (narrow no-break spaces, "PM") changes between Node versions. */
export function formatClock(date: Date): string {
  const p = parts(date);
  const suffix = p.hour < 12 ? "a.m." : "p.m.";
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour}:${String(p.minute).padStart(2, "0")} ${suffix}`;
}

/** "Thursday, October 8, 4:00 p.m. to 4:30 p.m." in office time. */
export function formatShowingWindow(start: Date, minutes: number): string {
  const end = new Date(start.getTime() + minutes * 60_000);
  const p = parts(start);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday}, ${MONTHS[p.month - 1]} ${p.day}, ${formatClock(start)} to ${formatClock(end)}`;
}

/** Graph wants a wall-clock dateTime plus a zone name. */
export function graphDateTime(date: Date): { dateTime: string; timeZone: string } {
  const p = parts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dateTime: `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`,
    timeZone: "Eastern Standard Time",
  };
}
