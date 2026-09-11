/**
 * Time helpers.
 *
 * Rule for the whole project: anything a person thinks of as a wall-clock
 * time ("gym at 7am") is handled as a local date plus a local time, never as
 * a UTC instant. Only genuine moments (created, completed, reminder fired)
 * become timestamps. This is what stops recurring tasks drifting an hour
 * when daylight saving changes.
 */

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

export function greetingFor(date: Date): Greeting {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Local calendar day as YYYY-MM-DD. Never use toISOString() for this: it
 *  converts to UTC first and gives the wrong day for anyone west of London. */
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

export function formatClock(date: Date, use24h = false): string {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  if (use24h) return `${String(h).padStart(2, "0")}:${m}`;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m}`;
}

export function meridiem(date: Date): "AM" | "PM" {
  return date.getHours() >= 12 ? "PM" : "AM";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function weekdayName(date: Date): string {
  return WEEKDAYS[date.getDay()];
}

export function formatLongDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
