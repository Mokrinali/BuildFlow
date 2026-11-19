// Suggest which order line a waybill goods line belongs to, and the unit factor.
// 1. A match a person made before for this supplier's goods with the same name (remembered).
// 2. Otherwise the order line whose name and spec share the most words with the goods name.
// Suggestions are only a starting point: the receiver confirms or changes them.
import { canonicalUnit, unitFactor } from "@/lib/unit-convert";
import type { RsGoods } from "@/server/rs/soap";

export type MatchTarget = {
  orderItemId: string;
  name: string;
  spec: string | null;
  unit: string;
};

/** A past match of this supplier: goods name/unit → request item name/unit, with its factor. */
export type LearnedMatch = {
  goodsName: string;
  goodsUnit: string;
  itemName: string;
  itemUnit: string;
  factor: string | null;
};

export type Suggestion = { orderItemId: string | null; factor: string | null };

/** Lower-case words and numbers; "Ø12" gives "ø12" and "12", so sizes still match. */
export function words(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}ø]+/u)) {
    if (!w) continue;
    out.add(w);
    const digits = w.replace(/\D/g, "");
    if (digits && digits !== w) out.add(digits);
  }
  return out;
}

/** Key for remembering a supplier's goods name across waybills. */
export const goodsKey = (name: string) => [...words(name)].sort().join(" ");

function score(goods: Set<string>, target: MatchTarget): number {
  const name = words(target.name);
  const all = words(`${target.name} ${target.spec ?? ""}`);
  let common = 0;
  for (const w of all) if (goods.has(w)) common++;
  if (common === 0) return 0;
  // Every word of the material name present in the goods name is a strong sign.
  const nameCovered = [...name].every((w) => goods.has(w));
  const jaccard = common / new Set([...goods, ...all]).size;
  return (nameCovered ? 0.5 : 0) + jaccard;
}

const MIN_SCORE = 0.3;

export function suggestMatches(
  goods: RsGoods[],
  targets: MatchTarget[],
  learned: LearnedMatch[],
): Suggestion[] {
  const memory = new Map<string, LearnedMatch>();
  // `learned` is newest first: keep the most recent match per goods name.
  for (const m of learned) {
    const k = goodsKey(m.goodsName);
    if (!memory.has(k)) memory.set(k, m);
  }
  return goods.map((g) => {
    const past = memory.get(goodsKey(g.name));
    if (past) {
      const target = targets.find(
        (t) => goodsKey(t.name) === goodsKey(past.itemName) && t.unit === past.itemUnit,
      );
      if (target) {
        const sameUnits = canonicalUnit(past.goodsUnit) === canonicalUnit(g.unit);
        return {
          orderItemId: target.orderItemId,
          factor: (sameUnits ? past.factor : null) ?? unitFactor(g.unit, target.unit),
        };
      }
    }
    const gw = words(g.name);
    let best: MatchTarget | null = null;
    let bestScore = MIN_SCORE;
    for (const t of targets) {
      const s = score(gw, t);
      if (s > bestScore) {
        best = t;
        bestScore = s;
      }
    }
    return best
      ? { orderItemId: best.orderItemId, factor: unitFactor(g.unit, best.unit) }
      : { orderItemId: null, factor: null };
  });
}
