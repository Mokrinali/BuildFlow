import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, formatWorkDate, todayInTbilisi } from "./format";

describe("ka-GE formatting", () => {
  it("shows timestamps in Tbilisi time (UTC+4)", () => {
    expect(formatDateTime(new Date("2026-11-16T20:30:00Z"))).toContain("00:30");
    expect(formatDateTime(new Date("2026-11-16T20:30:00Z"))).toContain("17");
  });

  it("uses the Tbilisi calendar day for 'today'", () => {
    // 21:00 UTC on the 16th is already the 17th in Tbilisi.
    expect(todayInTbilisi(new Date("2026-11-16T21:00:00Z"))).toBe("2026-11-17");
  });

  it("shows @db.Date work dates as stored, not shifted to the next Tbilisi day", () => {
    // 22:00 UTC is already the next day in Tbilisi: a timestamp moves, a work date must not.
    const d = new Date("2026-11-16T22:00:00Z");
    expect(formatDate(d)).toBe("17.11.2026");
    expect(formatWorkDate(d)).toBe("16.11.2026");
  });

  it("formats GEL amounts", () => {
    const s = formatMoney("1234.5", "GEL");
    expect(s).toMatch(/1\s?234,50/);
  });
});
