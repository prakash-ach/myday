import { describe, expect, it } from "vitest";
import { addDays, dayKey, formatClock, greetingFor, meridiem } from "@/lib/time";

describe("greetingFor", () => {
  it("changes across the day", () => {
    expect(greetingFor(new Date(2026, 8, 11, 7, 0))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 8, 11, 13, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 8, 11, 19, 0))).toBe("Good evening");
  });

  it("treats noon as afternoon and midnight as morning", () => {
    expect(greetingFor(new Date(2026, 8, 11, 12, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 8, 11, 0, 30))).toBe("Good morning");
  });
});

describe("dayKey", () => {
  it("uses the local calendar day, not UTC", () => {
    // 11pm local on the 11th is already the 12th in UTC for US timezones.
    // Getting this wrong is how a task lands on the wrong day.
    expect(dayKey(new Date(2026, 8, 11, 23, 30))).toBe("2026-09-11");
  });

  it("pads single digits", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("survives a daylight saving change", () => {
    // US DST ends 1 November 2026. Naive date maths that adds 24 hours
    // lands back on the same day here; calendar maths must not.
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });
});

describe("formatClock", () => {
  it("shows 12-hour time by default", () => {
    expect(formatClock(new Date(2026, 8, 11, 15, 28))).toBe("3:28");
    expect(formatClock(new Date(2026, 8, 11, 0, 5))).toBe("12:05");
  });

  it("shows 24-hour time when asked", () => {
    expect(formatClock(new Date(2026, 8, 11, 15, 28), true)).toBe("15:28");
    expect(formatClock(new Date(2026, 8, 11, 9, 5), true)).toBe("09:05");
  });

  it("reports the right half of the day", () => {
    expect(meridiem(new Date(2026, 8, 11, 11, 59))).toBe("AM");
    expect(meridiem(new Date(2026, 8, 11, 12, 0))).toBe("PM");
  });
});
