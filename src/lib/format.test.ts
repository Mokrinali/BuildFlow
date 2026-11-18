import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatUnitPrice,
  formatWorkDate,
  todayInTbilisi,
} from "./format";
import { eventLabel } from "./i18n/ka";

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

describe("code review findings: display", () => {
  it("shows unit prices with up to 4 decimals", () => {
    expect(formatUnitPrice("0.0375", "GEL")).toContain("0,0375");
    expect(formatUnitPrice("18.5", "GEL")).toContain("18,50");
  });

  it("labels every audit action in Georgian, never with the raw key", () => {
    expect(eventLabel("order.created")).toBe("შეკვეთა გაფორმდა");
    expect(eventLabel("request.approved")).toBe("დამტკიცდა");
    expect(eventLabel("project.created", { "project.created": "პროექტი შეიქმნა" })).toBe(
      "პროექტი შეიქმნა",
    );
    expect(eventLabel("something.unknown")).toBe("ცვლილება");
  });
});

describe("logging without user data", () => {
  it("keeps only stack frames, never message lines", async () => {
    const { stackFrames } = await import("@/server/action");
    const frames = stackFrames(new Error("first line\nსაიდუმლო ცემენტი 25 ტომარა\nmore"));
    expect(frames).toMatch(/^\s+at /);
    expect(frames).not.toContain("საიდუმლო");
    expect(frames).not.toContain("first line");
  });
});

describe("browser test findings: formatting without Intl locale data", () => {
  // The formatter must match Node's ka-GE Intl output exactly, so server and client agree even
  // in a browser that has no ka-GE data.
  const intl = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat("ka-GE", o);
  const values = [
    0,
    1.5,
    "1.5",
    "0.001",
    "0.0005",
    1234.5,
    "4415",
    "12345.678",
    1234567,
    "9999.9995",
    -5,

    "18.5",
    "0.0375",
    "100000",
    2.675,
    "1.005",
    1e21,
    1e-7,
    "999.999",
  ];

  it.each(values)("quantity %s", async (v) => {
    const { formatQuantity } = await import("./format");
    expect(formatQuantity(v)).toBe(intl({ maximumFractionDigits: 3 }).format(Number(v)));
  });

  it.each(["GEL", "USD", "EUR"])("money and unit prices in %s", async (currency) => {
    const { formatMoney, formatUnitPrice } = await import("./format");
    for (const v of values.filter((x) => Math.abs(Number(x)) < 1e15)) {
      expect(formatMoney(v, currency)).toBe(
        intl({ style: "currency", currency }).format(Number(v)),
      );
      expect(formatUnitPrice(v, currency)).toBe(
        intl({
          style: "currency",
          currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        }).format(Number(v)),
      );
    }
  });

  it("formats dates as dd.mm.yyyy in Tbilisi time", async () => {
    const { formatIsoDate } = await import("./format");
    const d = new Date("2026-11-18T10:02:00Z");
    expect(formatDateTime(d)).toBe("18.11.2026, 14:02");
    expect(formatDate(d)).toBe("18.11.2026");
    expect(formatIsoDate("2026-01-05")).toBe("05.01.2026");
    expect(formatIsoDate("bad")).toBe("bad");
  });
});
