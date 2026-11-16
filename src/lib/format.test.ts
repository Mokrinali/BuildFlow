import { describe, expect, it } from "vitest";
import { formatDateTime, formatMoney, formatWorkDate, todayInTbilisi } from "./format";

describe("ka-GE formatting", () => {
  it("shows timestamps in Tbilisi time (UTC+4)", () => {
    expect(formatDateTime(new Date("2026-11-16T20:30:00Z"))).toContain("00:30");
    expect(formatDateTime(new Date("2026-11-16T20:30:00Z"))).toContain("17");
  });

  it("uses the Tbilisi calendar day for 'today'", () => {
    // 21:00 UTC on the 16th is already the 17th in Tbilisi.
    expect(todayInTbilisi(new Date("2026-11-16T21:00:00Z"))).toBe("2026-11-17");
  });

  it("does not shift @db.Date work dates", () => {
    expect(formatWorkDate(new Date("2026-11-16T00:00:00Z"))).toContain("16");
  });

  it("formats GEL amounts", () => {
    const s = formatMoney("1234.5", "GEL");
    expect(s).toMatch(/1\s?234,50/);
  });
});
