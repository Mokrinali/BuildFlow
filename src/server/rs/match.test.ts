import { describe, expect, it } from "vitest";
import { compareWaybill } from "./compare";
import { suggestMatches, type MatchTarget } from "./match";

const targets: MatchTarget[] = [
  { orderItemId: "rebar", name: "არმატურა", spec: "Ø12", unit: "ტონა" },
  { orderItemId: "rebar16", name: "არმატურა", spec: "Ø16", unit: "ტონა" },
  { orderItemId: "cement", name: "ცემენტი", spec: "M400", unit: "ტომარა" },
  { orderItemId: "sand", name: "ქვიშა", spec: null, unit: "მ³" },
];
const g = (name: string, unit: string) => ({ name, unit, quantity: "1", unitPrice: null });

describe("match suggestions", () => {
  it("matches by name and size, with the unit factor", () => {
    expect(
      suggestMatches(
        [g("არმატურა A500C Ø12", "კგ"), g("ცემენტი M400 50კგ", "ტომარა"), g("ფიცარი", "მ³")],
        targets,
        [],
      ),
    ).toEqual([
      { orderItemId: "rebar", factor: "0.001" },
      { orderItemId: "cement", factor: "1" },
      { orderItemId: null, factor: null },
    ]);
    expect(suggestMatches([g("არმატურა Ø16", "ტ")], targets, [])).toEqual([
      { orderItemId: "rebar16", factor: "1" },
    ]);
  });

  it("prefers a remembered match of this supplier, with its factor", () => {
    const learned = [
      {
        goodsName: "წვრილი ფრაქცია",
        goodsUnit: "მანქანა",
        itemName: "ქვიშა",
        itemUnit: "მ³",
        factor: "8",
      },
    ];
    expect(suggestMatches([g("ფრაქცია წვრილი", "მანქანა")], targets, learned)).toEqual([
      { orderItemId: "sand", factor: "8" },
    ]);
    // Without the memory nothing in the name matches.
    expect(suggestMatches([g("ფრაქცია წვრილი", "მანქანა")], targets, [])).toEqual([
      { orderItemId: null, factor: null },
    ]);
  });
});

describe("waybill comparison", () => {
  const lines = new Map([
    ["rebar", { name: "არმატურა", unit: "ტონა" }],
    ["cement", { name: "ცემენტი", unit: "ტომარა" }],
    ["sand", { name: "ქვიშა", unit: "მ³" }],
  ]);
  const line = (position: number, over: object) => ({
    id: `l${position}`,
    position,
    name: "x",
    unit: "კგ",
    quantity: "2000",
    unitPrice: null,
    orderItemId: null,
    factor: null,
    ...over,
  });

  it("flags differences, unknown factors and lines missing from the waybill", () => {
    const c = compareWaybill(
      [
        line(0, { orderItemId: "rebar", factor: "0.001" }),
        line(1, { unit: "ტომარა", quantity: "10", orderItemId: "cement", factor: "1" }),
        line(2, { unit: "მანქანა", quantity: "1", orderItemId: "sand", factor: null }),
        line(3, { name: "სხვა შეკვეთის" }),
      ],
      [
        { orderItemId: "rebar", quantity: "1.8" },
        { orderItemId: "cement", quantity: "10" },
      ],
      lines,
    );
    expect(c.rows).toEqual([
      expect.objectContaining({
        orderItemId: "rebar",
        waybill: "2",
        received: "1.8",
        diff: "-0.2",
        ok: false,
      }),
      expect.objectContaining({
        orderItemId: "cement",
        waybill: "10",
        received: "10",
        diff: "0",
        ok: true,
      }),
      expect.objectContaining({
        orderItemId: "sand",
        waybill: null,
        received: "0",
        diff: null,
        ok: false,
      }),
    ]);
    expect(c.unmatched).toBe(1);
    expect(c.mismatch).toBe(true);
  });

  it("is clean when everything matches", () => {
    const c = compareWaybill(
      [line(0, { orderItemId: "rebar", factor: "0.001" })],
      [{ orderItemId: "rebar", quantity: "2" }],
      lines,
    );
    expect(c.mismatch).toBe(false);
  });
});
