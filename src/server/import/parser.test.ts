import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_LENGTH,
  canonicalForHash,
  parseMaterialText,
  type ParsedItem,
  type ParsedLine,
} from "./parser";

const TODAY = "2026-11-16"; // Monday

const parse = (text: string) => parseMaterialText(text, TODAY);
/** Items of a single-line text. */
const itemsOf = (line: string): ParsedItem[] => {
  const l = parse(line).lines[0]!;
  return l.kind === "items" ? l.items : [];
};
const one = (line: string) => {
  const items = itemsOf(line);
  expect(items, line).toHaveLength(1);
  const it = items[0]!;
  return { name: it.name, spec: it.spec, quantity: it.quantity, unit: it.unit, flags: it.flags };
};
const skipped = (l: ParsedLine) => l.kind === "skipped";

describe("CLAUDE.md examples", () => {
  it("quantity after the name", () => {
    expect(one("ცემენტი 25 ტომარა")).toEqual({
      name: "ცემენტი",
      spec: "",
      quantity: "25",
      unit: "ტომარა",
      flags: [],
    });
  });

  it("quantity before the name; the diameter is a spec, not a quantity", () => {
    expect(one("12 ც. არმატურა Ø12")).toEqual({
      name: "არმატურა",
      spec: "Ø12",
      quantity: "12",
      unit: "ცალი",
      flags: [],
    });
  });
});

describe("quantities and units", () => {
  it.each([
    ["არმატურა 1,5 ტონა", "1.5", "ტონა", "არმატურა"],
    ["არმატურა 1.5 ტ", "1.5", "ტონა", "არმატურა"],
    ["ქვიშა 3 კუბი", "3", "მ³", "ქვიშა"],
    ["ქვიშა 3მ3", "3", "მ³", "ქვიშა"],
    ["ღორღი 2,5 კუბ.მ", "2.5", "მ³", "ღორღი"],
    ["თაბაშირმუყაო 40 კვ.მ", "40", "მ²", "თაბაშირმუყაო"],
    ["25ტომარა ცემენტი", "25", "ტომარა", "ცემენტი"],
    ["ლურსმანი 5 კგ", "5", "კგ", "ლურსმანი"],
    ["საღებავი 20 ლ", "20", "ლიტრი", "საღებავი"],
    ["კაბელი 100 მეტრი", "100", "მ", "კაბელი"],
    ["ბლოკი 500 ცალი", "500", "ცალი", "ბლოკი"],
    ["ორი ტომარა წებო", "2", "ტომარა", "წებო"],
    ["0,25 ტონა მავთული", "0.25", "ტონა", "მავთული"],
  ])("%s", (line, quantity, unit, name) => {
    expect(one(line)).toMatchObject({ quantity, unit, name, flags: [] });
  });

  it("does not take a word starting with a unit letter as the unit", () => {
    // "მილი" (pipe) starts with "მ" (metre) but is the name.
    expect(one("მილი 10")).toMatchObject({ name: "მილი", quantity: "10", unit: null });
    expect(one("მილი 10").flags).toEqual(["unit"]);
  });

  it("finds a unit word away from the number", () => {
    expect(one("ცემენტი ტომარა 25")).toMatchObject({ name: "ცემენტი", unit: "ტომარა" });
  });
});

describe("specifications are not quantities", () => {
  it.each([
    ["ცემენტი M400 25 ტომარა", "ცემენტი", "M400", "25", "ტომარა"],
    ["მილი 50მმ 10 ცალი", "მილი", "50მმ", "10", "ცალი"],
    ["ბადე 2x50 3 რულონი", "ბადე", "2x50", "3", "რულონი"],
    ["ფიცარი 6მ 20 ცალი", "ფიცარი", "6მ", "20", "ცალი"],
    ["12-იანი არმატურა 2 ტონა", "არმატურა", "12-იანი", "2", "ტონა"],
    ['ონკანი 1/2" 4 ცალი', "ონკანი", '1/2"', "4", "ცალი"],
    ["ბეტონი B25 6 კუბი", "ბეტონი", "B25", "6", "მ³"],
    ["ფანერა 1220×2440×18 მმ 15 ფურცელი", "ფანერა", "1220×2440×18 მმ", "15", "ფურცელი"],
  ])("%s", (line, name, spec, quantity, unit) => {
    expect(one(line)).toMatchObject({ name, spec, quantity, unit, flags: [] });
  });
});

describe("chat formatting", () => {
  it("strips bullets, numbering, emoji and WhatsApp headers", () => {
    const text = [
      "[16.11.26, 09:15:30] გიორგი ბერიძე: ცემენტი 25 ტომარა",
      "16/11/2026, 09:16 - გიორგი: - ქვიშა 3 კუბი",
      "• ბლოკი 200 ცალი 👍",
      "1. წებო 10 ტომარა",
      "2) ლურსმანი 5 კგ",
    ].join("\n");
    const items = parse(text).lines.flatMap((l) => (l.kind === "items" ? l.items : []));
    expect(items.map((i) => [i.name, i.quantity, i.unit])).toEqual([
      ["ცემენტი", "25", "ტომარა"],
      ["ქვიშა", "3", "მ³"],
      ["ბლოკი", "200", "ცალი"],
      ["წებო", "10", "ტომარა"],
      ["ლურსმანი", "5", "კგ"],
    ]);
    // The header date and time are not a delivery date.
    expect(parse(text).desiredDate).toBeNull();
  });

  it("reads text typed in Georgian capitals (Mtavruli)", () => {
    expect(one("ცემენტი 25 ტომარა".toUpperCase())).toMatchObject({
      name: "ცემენტი",
      quantity: "25",
      unit: "ტომარა",
      flags: [],
    });
  });

  it("removes invisible characters and odd spaces", () => {
    expect(one("‎ცემენტი 25 ტომარა‏")).toMatchObject({
      name: "ცემენტი",
      quantity: "25",
      unit: "ტომარა",
    });
  });

  it("splits a line on semicolons", () => {
    expect(itemsOf("ცემენტი 25 ტომარა; ქვიშა 3 კუბი").map((i) => i.name)).toEqual([
      "ცემენტი",
      "ქვიშა",
    ]);
  });

  it("splits comma-separated items only when each part has a quantity", () => {
    expect(
      itemsOf("საღებავი თეთრი 3 ვედრო, წებოცემენტი 15 ტომარა").map((i) => [i.name, i.quantity]),
    ).toEqual([
      ["საღებავი თეთრი", "3"],
      ["წებოცემენტი", "15"],
    ]);
    expect(one("არმატურა Ø12, 1,5 ტონა")).toMatchObject({ name: "არმატურა", quantity: "1.5" });
    expect(one("ბლოკი 20 ცალი, თეთრი")).toMatchObject({ name: "ბლოკი, თეთრი", quantity: "20" });
  });

  it("keeps line numbers and shows non-material lines as skipped", () => {
    const r = parse(
      [
        "გამარჯობა!",
        "საჭიროა შემდეგი მასალა:",
        "",
        "ცემენტი 25 ტომარა",
        "დარეკეთ 599 12 34 56",
        "მადლობა",
        "ცემენტიც",
      ].join("\n"),
    );
    expect(r.lines.map((l) => [l.lineNo, l.kind])).toEqual([
      [1, "skipped"],
      [2, "skipped"],
      [3, "blank"],
      [4, "items"],
      [5, "skipped"],
      [6, "skipped"],
      [7, "skipped"],
    ]);
    expect(r.lines.filter(skipped).map((l) => (l.kind === "skipped" ? l.reason : ""))).toEqual([
      "მისალმება ან პასუხი",
      "სათაური",
      "კონტაქტი ან დრო",
      "მისალმება ან პასუხი",
      "რაოდენობა არ არის. თუ ეს მასალაა, დაამატეთ პოზიციად.",
    ]);
  });
});

describe("unclear lines are flagged, not guessed", () => {
  it("flags a range", () => {
    const it = one("ცემენტი 20-25 ტომარა");
    expect(it.quantity).toBeNull();
    expect(it.flags).toContain("quantity");
    expect(it.unit).toBe("ტომარა");
  });

  it("prefers a count unit over a size, in either order", () => {
    for (const line of ["ფიცარი 20 ცალი 6მ", "ფიცარი 6მ 20 ცალი", "20 ცალი ფიცარი 6 მ"]) {
      expect(one(line), line).toMatchObject({ quantity: "20", unit: "ცალი", flags: [] });
    }
    expect(one("ცემენტი 25 ტომარა 50კგ")).toMatchObject({
      quantity: "25",
      unit: "ტომარა",
      spec: "50კგ",
      flags: [],
    });
  });

  it("flags two measures that could both be the quantity", () => {
    expect(one("5 ტონა ქვიშა 3 კუბი").flags).toContain("quantity");
  });

  it("skips an over-long line instead of parsing a truncated part", () => {
    const l = parse(`ცემენტი 25 ტომარა ${"ა".repeat(600)}`).lines[0]!;
    expect(l).toMatchObject({ kind: "skipped" });
    expect(l.text.length).toBeLessThanOrEqual(501);
  });

  it("flags too many decimals and zero", () => {
    expect(one("ცემენტი 1,2345 ტონა")).toMatchObject({ quantity: null, flags: ["quantity"] });
    expect(one("ცემენტი 0 ტომარა")).toMatchObject({ quantity: null, flags: ["quantity"] });
  });

  it("flags a missing unit and a missing name", () => {
    expect(one("ქვიშა 3").flags).toEqual(["unit"]);
    expect(one("25 ტომარა").flags).toEqual(["name"]);
  });
});

describe("delivery date", () => {
  it.each([
    ["ხვალ მოიტანეთ", "2026-11-17", []],
    ["მიწოდება ზეგ", "2026-11-18", []],
    ["მიწოდება 20.11-მდე", "2026-11-20", []],
    ["მიწოდება 25/11", "2026-11-25", ["uncertain"]],
    ["5 დეკემბრამდე", "2026-12-05", []],
    ["მიწოდება 10.01.2027", "2027-01-10", []],
    ["5 იანვრამდე", "2027-01-05", []], // already passed this year → next year
    ["პარასკევს მოიტანეთ", "2026-11-20", ["uncertain"]],
    ["მიწოდება 01.11.2026", "2026-11-01", ["past"]],
  ])("%s", (line, value, flags) => {
    const d = parse(line).desiredDate;
    expect(d?.value).toBe(value);
    expect(d?.flags).toEqual(flags);
    expect(parse(line).lines[0]?.kind).toBe("skipped");
  });

  it("does not read ordinary words starting like a month as a date", () => {
    for (const line of ["10 დეკორატიული აგური", "20 დეკინგის დაფა", "5 მარტივი ონკანი"]) {
      const r = parse(line);
      expect(r.desiredDate, line).toBeNull();
      expect(r.lines[0]?.kind, line).toBe("items");
    }
    expect(parse("მიწოდება 3 მარტამდე").desiredDate?.value).toBe("2027-03-03");
    expect(parse("15 ნოემბერს").desiredDate?.value).toBe("2027-11-15");
  });

  it("does not treat a bare d.m next to a list header as a date", () => {
    const r = parse("საჭიროა არმატურა 12.5");
    expect(r.desiredDate).toBeNull();
    expect(r.lines[0]).toMatchObject({ kind: "items" });
  });

  it("does not read a decimal quantity as a date", () => {
    const r = parse("მოიტანეთ არმატურა 1.5 ტონა");
    expect(r.desiredDate).toBeNull();
    expect(r.lines[0]).toMatchObject({ kind: "items" });
  });

  it("takes the date out of a material line and flags several dates", () => {
    const r = parse("ცემენტი 25 ტომარა ხვალ\nქვიშა 3 კუბი 20.11-მდე");
    expect(r.desiredDate).toMatchObject({ value: "2026-11-17", lineNo: 1, flags: ["multiple"] });
    const items = r.lines.flatMap((l) => (l.kind === "items" ? l.items : []));
    expect(items.map((i) => [i.name, i.quantity])).toEqual([
      ["ცემენტი", "25"],
      ["ქვიშა", "3"],
    ]);
  });
});

describe("limits and hashing", () => {
  it("refuses oversized input before parsing", () => {
    expect(() => parse("ა".repeat(MAX_TEXT_LENGTH + 1))).toThrow(RangeError);
    expect(() => parse("ა\n".repeat(401))).toThrow(RangeError);
  });

  it("treats the text as plain data", () => {
    const r = parse("<script>alert(1)</script> 5 ცალი");
    expect(r.lines[0]).toMatchObject({ kind: "items" });
  });

  it("hashes text independent of spacing, case and blank lines", () => {
    expect(canonicalForHash("Ცემენტი  25\r\n\r\n ქვიშა 3 ")).toBe(
      canonicalForHash("ცემენტი 25\nქვიშა 3"),
    );
  });
});
