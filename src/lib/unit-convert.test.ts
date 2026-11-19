import { describe, expect, it } from "vitest";
import { canonicalUnit, mulDecimal, normalizeFactor, sumDecimal, unitFactor } from "./unit-convert";

describe("unit conversion", () => {
  it("recognizes spellings from the app and from waybills", () => {
    expect(canonicalUnit("კგ.")).toBe("კგ");
    expect(canonicalUnit("კილოგრამი")).toBe("კგ");
    expect(canonicalUnit("ტ")).toBe("ტონა");
    expect(canonicalUnit("კუბ.მ")).toBe("მ³");
    expect(canonicalUnit("მ3")).toBe("მ³");
    expect(canonicalUnit("ც.")).toBe("ცალი");
    expect(canonicalUnit("ტომარა")).toBe("ტომარა");
  });

  it("converts physical units and leaves package units to a person", () => {
    expect(unitFactor("კგ", "ტონა")).toBe("0.001");
    expect(unitFactor("ტონა", "კგ")).toBe("1000");
    expect(unitFactor("ლიტრი", "მ³")).toBe("0.001");
    expect(unitFactor("სმ", "მ")).toBe("0.01");
    expect(unitFactor("ც", "ცალი")).toBe("1");
    expect(unitFactor("ტომარა", "ტომარა")).toBe("1");
    expect(unitFactor("ტომარა", "კგ")).toBeNull();
    expect(unitFactor("კგ", "მ")).toBeNull();
  });

  it("multiplies and sums decimals exactly", () => {
    expect(mulDecimal("1800", "0.001")).toBe("1.8");
    expect(mulDecimal("2", "1000")).toBe("2000");
    expect(mulDecimal("0.3333", "3")).toBe("1");
    expect(mulDecimal("1.0005", "1")).toBe("1.001"); // half up to 3 places
    expect(sumDecimal(["1.8", "-2"])).toBe("-0.2");
    expect(sumDecimal(["0.1", "0.2"])).toBe("0.3");
    expect(sumDecimal([])).toBe("0");
  });

  it("accepts positive factors only", () => {
    expect(normalizeFactor("0,001")).toBe("0.001");
    expect(normalizeFactor("25")).toBe("25");
    expect(normalizeFactor("0")).toBeNull();
    expect(normalizeFactor("-1")).toBeNull();
    expect(normalizeFactor("abc")).toBeNull();
    expect(normalizeFactor("1.1234567")).toBeNull();
  });
});
