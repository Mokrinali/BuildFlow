// Parser for material lists pasted from WhatsApp. Pure: no I/O, `today` is injected.
// The text is untrusted plain data: it is only matched with regular expressions, never evaluated,
// and never logged. Rules (CLAUDE.md): lines, bullets, units, decimal point or comma, quantity
// before or after the name; a size in the spec (Ø12, M400, 50მმ, 2x50) is not a quantity.
// When two readings are plausible the item is flagged for the user instead of guessed.
//
// Note: JS \b and \w are ASCII-only. Georgian word boundaries use \p{L} lookarounds (u flag).
import { normalizeQuantity } from "@/lib/quantity";

export const MAX_TEXT_LENGTH = 10_000;
export const MAX_LINES = 400;
export const MAX_LINE_LENGTH = 500;

export type ItemFlag = "quantity" | "unit" | "name";

export type ParsedItem = {
  name: string;
  spec: string;
  /** Canonical decimal string, or null when it must be clarified. */
  quantity: string | null;
  unit: string | null;
  flags: ItemFlag[];
  /** Georgian explanations of the flags, for the preview. */
  issues: string[];
};

export type ParsedLine =
  | { lineNo: number; text: string; kind: "blank" }
  | {
      lineNo: number;
      text: string;
      kind: "skipped";
      reason: string;
      /** The line without WhatsApp header, bullet and emoji: used when it is added as an item. */
      content?: string;
    }
  | { lineNo: number; text: string; kind: "items"; items: ParsedItem[] };

export type DateFlag = "uncertain" | "multiple" | "past";

export type ParsedDate = {
  /** YYYY-MM-DD */
  value: string;
  lineNo: number;
  flags: DateFlag[];
  issues: string[];
};

export type ParseResult = { lines: ParsedLine[]; desiredDate: ParsedDate | null };

// ─── Normalization ───────────────────────────────────────────────────────────

/** Remove invisible format characters and normalize exotic spaces (WhatsApp inserts both). */
export function normalizeText(text: string): string {
  return text.replace(/[​-‏‪-‮⁠-⁤﻿]/g, "").replace(/[    ]/g, " ");
}

/** Georgian capitals (Mtavruli, U+1C90…) → regular letters (Mkhedruli), so units still match. */
export const toMkhedruli = (s: string) =>
  s.replace(/[Ა-ᲺᲽ-Ჿ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xbc0));

/** Canonical form for duplicate detection: case, spacing and blank lines do not matter. */
export function canonicalForHash(text: string): string {
  return normalizeText(text)
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
}

// "[16.11.26, 09:15:30] გიორგი: ..." (iOS) or "16/11/2026, 09:15 - გიორგი: ..." (Android).
const WHATSAPP_HEADER =
  /^\[?\d{1,2}[./-]\d{1,2}[./-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?\]?\s*(?:[-–]\s*)?(?:[^:\n]{1,40}:\s+)?/u;
const BULLET = /^(?:[-–—•*·▪►➤→✔✓☑+]+|\d{1,2}[.)](?=\s))\s*/u;
const EMOJI = /[\p{Extended_Pictographic}️⃣]/gu;

// ─── Units ───────────────────────────────────────────────────────────────────

// Canonical unit → alternatives. Longer alternatives first; single letters only as whole tokens.
const UNIT_TABLE: [string, string][] = [
  ["მ²", String.raw`კვ\.?\s?მ(?:ეტრ\p{L}*)?|კვადრატ\p{L}*|მ2|მ²|m2|m²`],
  ["მ³", String.raw`კუბ(?:ურ\p{L}*)?\.?\s?მ(?:ეტრ\p{L}*)?|კუბ\p{L}*|მ3|მ³|m3|m³`],
  ["ტომარა", String.raw`ტომარ\p{L}*|ტომრ\p{L}*|ტომ`],
  ["ტონა", String.raw`ტონ\p{L}*|ტ`],
  ["კგ", String.raw`კგ|კილოგრამ\p{L}*|კილო(?!მეტრ)\p{L}*|kg`],
  ["ლიტრი", String.raw`ლიტრ\p{L}*|ლიტ|ლ`],
  ["ცალი", String.raw`ცალ\p{L}*|ცლ|ც|შტ|шт|pcs`],
  ["მ", String.raw`მეტრ\p{L}*|გრძ\.?\s?მ|მ|m`],
  ["კომპლექტი", String.raw`კომპლექტ\p{L}*|კომპლ|კომპ`],
  ["შეკვრა", String.raw`შეკვრ\p{L}*`],
  ["რულონი", String.raw`რულონ\p{L}*|რულ`],
  ["ფურცელი", String.raw`ფურცელ\p{L}*|ფურცლ\p{L}*|ფურც`],
  ["ღერი", String.raw`ღერ\p{L}*`],
  ["ყუთი", String.raw`ყუთ\p{L}*`],
  ["პალეტი", String.raw`პალეტ\p{L}*`],
  ["ბიდონი", String.raw`ბიდონ\p{L}*`],
  ["ვედრო", String.raw`ვედრ\p{L}*`],
  ["მანქანა", String.raw`მანქან\p{L}*`],
];
const UNIT_AFTER_NUMBER = UNIT_TABLE.map(
  ([unit, alt]) => [unit, new RegExp(String.raw`^\s*(?:${alt})(?!\p{L})\.?`, "u")] as const,
);
// Standalone unit words elsewhere in the line (multi-letter forms only: "ც" alone is too risky).
const UNIT_WORD = UNIT_TABLE.flatMap(([unit, alt]) => {
  const words = alt.split("|").filter((a) => a.endsWith(String.raw`\p{L}*`) || a === "კგ");
  return words.length
    ? [[unit, new RegExp(String.raw`(?<!\p{L})(?:${words.join("|")})(?!\p{L})`, "u")] as const]
    : [];
});

/** Units that count pieces or packages (as opposed to sizes such as metres or kilograms). */
const COUNT_UNITS = new Set([
  "ცალი",
  "ტომარა",
  "კომპლექტი",
  "შეკვრა",
  "რულონი",
  "ფურცელი",
  "ღერი",
  "ყუთი",
  "პალეტი",
  "ბიდონი",
  "ვედრო",
  "მანქანა",
]);

function unitAt(text: string): { unit: string; length: number } | null {
  for (const [unit, re] of UNIT_AFTER_NUMBER) {
    const m = re.exec(text);
    if (m) return { unit, length: m[0].length };
  }
  return null;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

// Full month stems (nominative and declined forms, e.g. ნოემბერი / ნოემბრამდე) followed only by
// a case ending, so ordinary words like „დეკორატიული“ or „მარტივი“ are not read as months.
const MONTHS = [
  "იანვ(?:არ|რ)",
  "თებერვ(?:ალ|ლ)",
  "მარტ",
  "აპრილ",
  "მაის",
  "ივნის",
  "ივლის",
  "აგვისტო",
  "სექტემბ(?:ერ|რ)",
  "ოქტომბ(?:ერ|რ)",
  "ნოემბ(?:ერ|რ)",
  "დეკემბ(?:ერ|რ)",
];
const MONTH_ENDING = String.raw`(?:ი|ს|ის|ამდე|მდე|ში|ისთვის|ზე|იდან)?(?!\p{L})`;
const WEEKDAYS = ["კვირ", "ორშაბათ", "სამშაბათ", "ოთხშაბათ", "ხუთშაბათ", "პარასკევ", "შაბათ"];
const DATE_SUFFIX = String.raw`(?:\s*-?\s*(?:მდე|ში|ისთვის|თვის|ზე|ს)(?!\p{L}))`;
const DATE_KEYWORD = /(?:მიწოდ|თარიღ|ვადა|მოიტან|მოტან|ჩამოიტან|ჩამოტან)\p{L}*/u;

type DateHit = { start: number; end: number; value: string; uncertain: boolean };

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};
const addDays = (isoDay: string, n: number) =>
  new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A day/month without a year: this year, or next year if it passed long ago ("5 იანვარს" in
 * November). A date that passed in the last month stays this year, so it is flagged as past
 * instead of silently jumping a year ahead ("14 ნოემბრამდე" written on the 16th).
 */
function inferYear(today: string, m: number, d: number): string | null {
  const y = Number(today.slice(0, 4));
  const v = iso(y, m, d);
  if (!v) return null;
  if (v >= today || v >= addDays(today, -31)) return v;
  return iso(y + 1, m, d);
}

/**
 * The day a WhatsApp message was written, from its header ("[15.11.26, 18:02]" or
 * "15/11/2026, 18:02 - "). Day first, as in Georgian exports; month first only when the first
 * number cannot be a month.
 */
function messageDay(line: string): string | null {
  const m = /^\[?(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4}),?\s+\d{1,2}:\d{2}/u.exec(line);
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const [a, b] = [Number(m[1]), Number(m[2])];
  return b > 12 ? iso(year, a, b) : iso(year, b, a);
}

function findDates(text: string, today: string, base: string = today): DateHit[] {
  const hits: DateHit[] = [];
  const add = (m: RegExpExecArray, value: string | null, uncertain = false) => {
    if (value) hits.push({ start: m.index, end: m.index + m[0].length, value, uncertain });
  };
  let m: RegExpExecArray | null;
  // Full dates: 20.11.2026, 20/11/26.
  const full = new RegExp(
    String.raw`(?<![\d.,/])(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?![\d.,/])${DATE_SUFFIX}?`,
    "gu",
  );
  while ((m = full.exec(text))) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const value = iso(y, Number(m[2]), Number(m[1]));
    // With a two-digit year, "10/12/14" is more likely sizes than 10 Dec 2014: accept only dates
    // within a year back or two years ahead.
    if (
      value &&
      m[3]!.length === 2 &&
      (value < addDays(today, -366) || value > addDays(today, 731))
    ) {
      continue;
    }
    add(m, value);
  }
  // Day and month name: "20 ნოემბრამდე", "5 დეკემბერს".
  const named = new RegExp(
    String.raw`(?<!\d)(\d{1,2})\s*-?\s*(?:${MONTHS.map((s) => `(${s})`).join("|")})${MONTH_ENDING}`,
    "gu",
  );
  while ((m = named.exec(text))) {
    const month = m.slice(2).findIndex((g) => g !== undefined) + 1;
    add(m, inferYear(today, month, Number(m[1])));
  }
  // Short d.m / d/m only with a date suffix or a delivery keyword ("20.11" could be a quantity).
  const short = new RegExp(
    String.raw`(?<![\d.,/])(\d{1,2})[./](\d{1,2})(?![\d.,/])(${DATE_SUFFIX})?`,
    "gu",
  );
  const keyword = DATE_KEYWORD.test(text);
  while ((m = short.exec(text))) {
    if (!m[3] && !keyword) continue;
    // "მოიტანეთ არმატურა 1.5 ტონა": a number followed by a unit is a quantity, not a date.
    if (!m[3] && unitAt(text.slice(m.index + m[0].length))) continue;
    if (hits.some((h) => m!.index < h.end && m!.index + m![0].length > h.start)) continue;
    // Read as a date only because of a keyword on the line: the user must confirm it.
    add(m, inferYear(today, Number(m[2]), Number(m[1])), !m[3]);
  }
  // Relative words count from the day the message was written (its WhatsApp header), which can
  // differ from the import day: then the result is uncertain. Only real case endings are allowed,
  // so "დღესასწაული" or "ზეგანი" are not dates.
  const relative: [RegExp, number][] = [
    [/(?<!\p{L})დღეს(?:ვე)?(?!\p{L})/gu, 0],
    [/(?<!\p{L})ხვალ(?:ვე|ისთვის|ამდე|იდან|ინდელ\p{L}*)?(?!\p{L})/gu, 1],
    [/(?<!\p{L})ზეგ(?:ისთვის|ამდე)?(?!\p{L})/gu, 2],
  ];
  for (const [re, n] of relative) {
    while ((m = re.exec(text))) add(m, addDays(base, n), base !== today);
  }
  // Weekdays: the next such day, but always uncertain ("კვირა" also means "week").
  const weekday = new RegExp(String.raw`(?<!\p{L})(${WEEKDAYS.join("|")})\p{L}*`, "gu");
  const dow = new Date(`${base}T00:00:00Z`).getUTCDay();
  while ((m = weekday.exec(text))) {
    // "ორშაბათ" etc. contain "შაბათ": the alternation order prefers the longer names.
    const target = WEEKDAYS.indexOf(m[1]!);
    add(m, addDays(base, (target - dow + 7) % 7 || 7), true);
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ─── Specs, noise and quantities ─────────────────────────────────────────────

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const SPEC_PATTERNS: RegExp[] = [
  // Slash-separated sizes: 10/12/14 (not a date, not a fraction)
  /(?<![\p{L}\d])\d+(?:\/\d+){2,}(?![\d])/gu,
  // Hyphenated dimensions: 500-250-200 (a block size, not a range or a phone number)
  /(?<![\p{L}\d])\d+(?:\s*-\s*\d+){2,}(?![\d])/gu,
  // Dimensions: 2x50, 10×20×300 მმ
  new RegExp(
    String.raw`(?<![\p{L}\d])${NUM}(?:\s*[xX×хХ*]\s*${NUM})+(?:\s*(?:მმ|სმ|მ|mm|cm|m)(?!\p{L}))?`,
    "gu",
  ),
  // Diameter, number sign: Ø12, d12, #8, №5
  new RegExp(String.raw`(?:[Øø⌀Ф]|(?<!\p{L})[dD]|[#№])\s*${NUM}`, "gu"),
  // Grades: M400, М-300, მ400, B25
  new RegExp(
    String.raw`(?<!\p{L})(?:[MmМм]\s?-?|მ-?)\d{3}(?!\d)|(?<!\p{L})[BbВв]\s?-?\d{2}(?:[.,]\d)?(?!\d)`,
    "gu",
  ),
  // Sizes: 50მმ, 12 mm, 3/4", 2 დუიმი, 15%
  new RegExp(
    String.raw`(?<![\p{L}\d])(?:\d+/\d+|${NUM})\s*(?:მმ|mm|სმ|cm|"|''|დუიმ\p{L}*|დიუმ\p{L}*|ინჩ\p{L}*|%)(?!\p{L})`,
    "gu",
  ),
  // Adjectival size: 12-იანი, 50კგ-იანი
  new RegExp(String.raw`(?<![\p{L}\d])${NUM}\s*\p{L}{0,6}-?იან\p{L}*`, "gu"),
];
// Phone numbers only in an unmistakable shape, so "არმატურა 500 12 50 ღერი" stays an item:
// a +995 prefix, a mobile number grouped 5XX XX XX XX, or 7+ digits in a row. Looser shapes
// (5XX XXX XXX, landlines) count only when the line talks about calling.
const NOISE_PATTERNS: RegExp[] = [
  // +995 599 12 34 56, +995 32 2 12 34 56 (landline)
  /\+?995[\s-]?\d{2,3}(?:[\s-]?\d{1,3}){2,4}(?!\d)/gu,
  /(?<![\d.,-])5\d{2}(?:[\s-]?\d{2}){3}(?![\d-])/gu,
  /(?<!\d)\d{7,}(?!\d)/gu,
  // Times: 09:30, 10 საათზე
  /(?<!\d)\d{1,2}:\d{2}(?!\d)/gu,
  /(?<!\d)\d{1,2}\s*საათ\p{L}*/gu,
];
// "დარეკეთ", "დამირეკეთ", "ტელ.", "ნომერი", "მობილური"
const PHONE_CONTEXT = /(?:რეკ|ტელ|ნომერ|მობ|კონტაქტ)/u;
const LOOSE_PHONE = /(?<!\d)(?:5\d{2}|0\d{2,3})(?:[\s-]?\d{2,3}){2,3}(?!\d)/gu;
const noisePatterns = (line: string) =>
  PHONE_CONTEXT.test(line) ? [LOOSE_PHONE, ...NOISE_PATTERNS] : NOISE_PATTERNS;

const NUMBER_WORDS: Record<string, string> = {
  ერთი: "1",
  ორი: "2",
  ორ: "2",
  სამი: "3",
  სამ: "3",
  ოთხი: "4",
  ოთხ: "4",
  ხუთი: "5",
  ხუთ: "5",
  ექვსი: "6",
  შვიდი: "7",
  რვა: "8",
  ცხრა: "9",
  ათი: "10",
  თორმეტი: "12",
  თხუთმეტი: "15",
  ოცი: "20",
  ოცდაათი: "30",
  ორმოცი: "40",
  ორმოცდაათი: "50",
  ასი: "100",
};
const NUMBER_WORD_RE = new RegExp(
  String.raw`(?<!\p{L})(${Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .join("|")})(?!\p{L})`,
  "gu",
);

const GREETING =
  /^(?:გამარჯობა|გაგიმარჯოს|სალამი|მადლობა|გმადლობთ|დიდი მადლობა|ნახვამდის|კარგი|კარგით|ოკ|ok|okay|დიახ|ხო|კი|არა|ბატონო|ქალბატონო|დილა მშვიდობისა|საღამო მშვიდობისა)(?!\p{L})/iu;

type Span = { start: number; end: number };
type Candidate = Span & {
  quantity: string | null;
  raw: string;
  unit: string | null;
  /** Several values ("20-25", "2 ან 3", "25+5"): no quantity, the user must choose. */
  range: boolean;
  /** A reading that is plausible but not certain ("2 500" → 2500, "1/2" → 0.5). */
  issue?: string;
};

/** Replace spans with spaces so positions of the remaining text stay valid. */
const blank = (text: string, spans: Span[]) =>
  spans.reduce((t, s) => t.slice(0, s.start) + " ".repeat(s.end - s.start) + t.slice(s.end), text);

function collect(text: string, patterns: RegExp[]): Span[] {
  const spans: Span[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const s = { start: m.index, end: m.index + m[0].length };
      if (!spans.some((o) => s.start < o.end && s.end > o.start)) spans.push(s);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function findCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  // 1: space-grouped thousands "2 500"; 2/3: fraction "1/2"; 4: a number (several separators
  // like "25.5.5" are kept whole so they fail validation); 5: a second value after -, +, ან.
  const re = new RegExp(
    String.raw`(?<![\p{L}\d.,/])(?:(\d{1,3}(?: \d{3})+)(?![\d.,])|(\d+)/(\d+)|(\d+(?:[.,]\d+)*)(?:(?:\s*[-–+]\s*|\s+ან\s+)(\d+(?:[.,]\d+)?))?)(?![\d])`,
    "gu",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const u = unitAt(text.slice(end));
    const raw = text.slice(m.index, end + (u?.length ?? 0)).trim();
    let quantity: string | null = null;
    let issue: string | undefined;
    if (m[1]) {
      quantity = normalizeQuantity(m[1].replace(/ /g, ""));
      issue = `„${m[1]}“ წაკითხულია როგორც ${quantity}. შეამოწმეთ.`;
    } else if (m[2]) {
      const value = Number(m[2]) / Number(m[3]);
      quantity = Number.isFinite(value) ? normalizeQuantity(String(value)) : null;
      issue = quantity
        ? `წილადი „${m[2]}/${m[3]}“ წაკითხულია როგორც ${quantity}. შეამოწმეთ.`
        : `წილადი „${m[2]}/${m[3]}“: მიუთითეთ ზუსტი რაოდენობა.`;
    } else if (!m[5]) {
      quantity = normalizeQuantity(m[4]!);
      // "1,000" / "2.500": a decimal or a thousands separator? For pieces it is surely thousands.
      if (quantity && /^[1-9]\d{0,2}[.,]\d{3}$/.test(m[4]!)) {
        if (u && COUNT_UNITS.has(u.unit)) {
          quantity = null;
          issue = `„${m[4]}“: ${m[4]!.slice(0, -4)} თუ ${m[4]!.replace(/[.,]/, "")}? მიუთითეთ ზუსტი რაოდენობა.`;
        } else {
          issue = `„${m[4]}“ წაკითხულია როგორც ${quantity}. თუ ათასებია, შეასწორეთ.`;
        }
      }
    }
    out.push({
      start: m.index,
      end: end + (u?.length ?? 0),
      raw,
      quantity,
      unit: u?.unit ?? null,
      range: Boolean(m[5]),
      issue,
    });
  }
  NUMBER_WORD_RE.lastIndex = 0;
  while ((m = NUMBER_WORD_RE.exec(text))) {
    const end = m.index + m[0].length;
    const u = unitAt(text.slice(end));
    // A number word counts only before a unit ("ორი ტომარა"); otherwise it is part of the name.
    if (!u) continue;
    out.push({
      start: m.index,
      end: end + u.length,
      raw: text.slice(m.index, end + u.length).trim(),
      quantity: NUMBER_WORDS[m[1]!]!,
      unit: u.unit,
      range: false,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

const hasLetters = (s: string) => /\p{L}/u.test(s);
const trimPunctuation = (s: string) => s.replace(/^[\s\-–—:,;.()]+|[\s\-–—:,;.(]+$/gu, "");
const cleanName = (s: string) =>
  trimPunctuation(
    trimPunctuation(s.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1"))
      // Connectors left at the edge after splitting "ცემენტი და ქვიშა" into items.
      .replace(/^(?:და|ან)(?=\s)|(?<=\s)(?:და|ან)$/u, ""),
  )
    .replace(/\(\s*\)/g, "")
    .trim();

function parseSegment(segment: string): ParsedItem | null {
  const specs = collect(segment, SPEC_PATTERNS);
  const specText = specs.map((s) => segment.slice(s.start, s.end).trim());
  const rest = blank(segment, specs);
  const candidates = findCandidates(rest);
  if (candidates.length === 0) return specs.length > 0 ? specOnlyItem(rest, specText) : null;

  const atStart = (c: Candidate) => !hasLetters(rest.slice(0, c.start));
  const atEnd = (c: Candidate) => !hasLetters(rest.slice(c.end));
  const issues: string[] = [];
  const flags = new Set<ItemFlag>();
  let chosen: Candidate;
  if (candidates.length === 1) {
    chosen = candidates[0]!;
  } else {
    const edge = candidates.filter((c) => atStart(c) || atEnd(c));
    const withUnit = edge.filter((c) => c.unit);
    // A count or package unit beats a size: "ფიცარი 20 ცალი 6მ", "ცემენტი 25 ტომარა 50კგ".
    const counted = candidates.filter((c) => c.unit && COUNT_UNITS.has(c.unit));
    const unitCount = candidates.filter((c) => c.unit).length;
    if (counted.length === 1) chosen = counted[0]!;
    else if (withUnit.length === 1 && unitCount === 1) chosen = withUnit[0]!;
    else if (unitCount > 1) {
      // Several measures ("5 ტონა ქვიშა 3 კუბი"): take an edge one, but ask the user.
      chosen = withUnit[0] ?? candidates.find((c) => c.unit)!;
      flags.add("quantity");
      issues.push("ხაზში რამდენიმე რაოდენობაა. შეამოწმეთ, რომელია სწორი.");
    } else if (edge.length > 0) {
      chosen = edge[0]!;
      flags.add("quantity");
      issues.push("ხაზში რამდენიმე რიცხვია. შეამოწმეთ რაოდენობა.");
    } else {
      chosen = candidates[candidates.length - 1]!;
      flags.add("quantity");
      issues.push("ხაზში რამდენიმე რიცხვია. შეამოწმეთ რაოდენობა.");
    }
  }
  // Unchosen numbers stay with the specification (e.g. "6 მ" length of a board).
  for (const c of candidates) if (c !== chosen) specText.push(c.raw);

  let nameText = blank(rest, candidates);
  let unit = chosen.unit;
  if (!unit) {
    for (const [u, re] of UNIT_WORD) {
      const m = re.exec(nameText);
      if (m) {
        unit = u;
        nameText = nameText.slice(0, m.index) + " " + nameText.slice(m.index + m[0].length);
        // "გამანაწილებელი ყუთი 10": the word may belong to the name, not be the unit.
        flags.add("unit");
        issues.push(`ერთეული („${m[0]}“) აღებულია ხაზის სხვა ადგილიდან. შეამოწმეთ.`);
        break;
      }
    }
  }
  let quantity = chosen.quantity;
  if (chosen.issue) {
    flags.add("quantity");
    issues.push(chosen.issue);
  }
  if (chosen.range) {
    flags.add("quantity");
    issues.push(`მითითებულია რამდენიმე მნიშვნელობა („${chosen.raw}“). მიუთითეთ ზუსტი რაოდენობა.`);
  } else if (!quantity || !/[1-9]/.test(quantity)) {
    quantity = null;
    flags.add("quantity");
    if (!chosen.issue) {
      issues.push("რაოდენობა ვერ ამოიცნო. მიუთითეთ დადებითი რიცხვი (მაქსიმუმ 3 ათწილადი).");
    }
  }
  if (!unit) {
    flags.add("unit");
    issues.push("ერთეული ვერ ამოიცნო.");
  }
  const name = cleanName(nameText);
  if (!name) {
    flags.add("name");
    issues.push("დასახელება ვერ ამოიცნო.");
  }
  return {
    name,
    spec: cleanName(specText.join(" ")),
    quantity,
    unit,
    flags: [...flags],
    issues,
  };
}

/**
 * "ფიცარი 50x150": a name with a size but no quantity. The size shows it is a material, so it
 * becomes an item with the quantity (and unit, unless a unit word is present) to clarify, instead
 * of a skipped line. Lines without a size ("რამე სხვა, მერე გეტყვი") stay skipped.
 */
function specOnlyItem(rest: string, specText: string[]): ParsedItem | null {
  let nameText = rest;
  let unit: string | null = null;
  for (const [u, re] of UNIT_WORD) {
    const m = re.exec(nameText);
    if (m) {
      unit = u;
      nameText = nameText.slice(0, m.index) + " " + nameText.slice(m.index + m[0].length);
      break;
    }
  }
  const name = cleanName(nameText);
  if (!name) return null;
  const flags: ItemFlag[] = ["quantity"];
  const issues = ["რაოდენობა მითითებული არ არის. მიუთითეთ."];
  if (!unit) {
    flags.push("unit");
    issues.push("ერთეული ვერ ამოიცნო.");
  }
  return { name, spec: cleanName(specText.join(" ")), quantity: null, unit, flags, issues };
}

/**
 * "საღებავი 3 ვედრო, წებო 15 ტომარა" holds two items. Split on a comma followed by a letter
 * (a decimal comma is followed by a digit), but only when every part has its own quantity.
 */
function splitOnCommas(segment: string): (ParsedItem | null)[] {
  const parts = segment.split(/,\s*(?=\p{L})/u);
  if (parts.length > 1) {
    const items = parts.flatMap(splitMaterials);
    if (items.every(isComplete)) return items;
  }
  return splitMaterials(segment);
}

const isComplete = (i: ParsedItem | null): i is ParsedItem => Boolean(i && i.name && i.quantity);

/**
 * Two materials without a comma: "ცემენტი 25 ტომარა ქვიშა 3 კუბი" or
 * "25 ტომარა ცემენტი და 3 კუბი ქვიშა". Cut between the measured quantities (after each one when
 * the name comes first, before each one when the quantity comes first) and keep the cut only if
 * every part is a complete item; "ფიცარი 20 ცალი 6მ" fails that test and stays one item.
 */
function splitMaterials(segment: string): (ParsedItem | null)[] {
  const rest = blank(segment, collect(segment, SPEC_PATTERNS));
  const measured = findCandidates(rest).filter((c) => c.unit);
  if (measured.length >= 2) {
    const quantityFirst = !hasLetters(rest.slice(0, measured[0]!.start));
    const cuts = quantityFirst
      ? measured.slice(1).map((c) => c.start)
      : measured.slice(0, -1).map((c) => c.end);
    const parts = [0, ...cuts].map((from, i) => segment.slice(from, cuts[i] ?? segment.length));
    const items = parts.map(parseSegment);
    if (items.every(isComplete)) {
      for (const it of items) it.issues.push("ხაზიდან ამოცნობილია რამდენიმე პოზიცია. შეამოწმეთ.");
      return items;
    }
  }
  return [parseSegment(segment)];
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Parse pasted text into lines with items, skipped lines and an optional desired date. */
export function parseMaterialText(input: string, today: string): ParseResult {
  if (input.length > MAX_TEXT_LENGTH) throw new RangeError("text too long");
  const rawLines = normalizeText(input).split(/\r\n|\r|\n/);
  if (rawLines.length > MAX_LINES) throw new RangeError("too many lines");

  const lines: ParsedLine[] = [];
  const dates: { value: string; lineNo: number; uncertain: boolean }[] = [];
  // Lines without a header continue the previous message, so they keep its day.
  let base = today;

  rawLines.forEach((raw, i) => {
    const lineNo = i + 1;
    const full = raw.trim();
    const text = full.length > MAX_LINE_LENGTH ? `${full.slice(0, MAX_LINE_LENGTH)}…` : full;
    if (!text) {
      lines.push({ lineNo, text, kind: "blank" });
      return;
    }
    // Never parse a truncated line: items after the cut would silently disappear.
    if (full.length > MAX_LINE_LENGTH) {
      lines.push({
        lineNo,
        text,
        kind: "skipped",
        reason: `ხაზი ძალიან გრძელია (მაქსიმუმ ${MAX_LINE_LENGTH} სიმბოლო). გაყავით რამდენიმე ხაზად.`,
      });
      return;
    }
    base = messageDay(text) ?? base;
    let body = toMkhedruli(text).replace(WHATSAPP_HEADER, "").replace(EMOJI, " ");
    body = body.replace(BULLET, "").trim();
    if (!body) {
      lines.push({ lineNo, text, kind: "skipped", reason: "ცარიელი შეტყობინება" });
      return;
    }

    const dateHits = findDates(body, today, base);
    for (const d of dateHits) dates.push({ value: d.value, lineNo, uncertain: d.uncertain });
    const noise = collect(body, noisePatterns(body));
    const cleaned = blank(blank(body, dateHits), noise);

    if (GREETING.test(cleaned.trim()) && !/\d/.test(cleaned)) {
      lines.push({
        lineNo,
        text,
        kind: "skipped",
        reason: "მისალმება ან პასუხი",
        content: body.slice(0, 200),
      });
      return;
    }
    const items = cleaned
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap(splitOnCommas)
      .filter((x): x is ParsedItem => x !== null);
    if (items.length > 0) {
      lines.push({ lineNo, text, kind: "items", items });
      return;
    }
    const reason = dateHits.length
      ? "მიწოდების თარიღი"
      : noise.length
        ? "კონტაქტი ან დრო"
        : /[:：]\s*$/.test(body)
          ? "სათაური"
          : "რაოდენობა არ არის. თუ ეს მასალაა, დაამატეთ პოზიციად.";
    lines.push({ lineNo, text, kind: "skipped", reason, content: body.slice(0, 200) });
  });

  return { lines, desiredDate: pickDate(dates, today) };
}

function pickDate(
  dates: { value: string; lineNo: number; uncertain: boolean }[],
  today: string,
): ParsedDate | null {
  const first = dates[0];
  if (!first) return null;
  const flags: DateFlag[] = [];
  const issues: string[] = [];
  if (first.uncertain) {
    flags.push("uncertain");
    issues.push("თარიღი სავარაუდოა (კვირის დღე ან მოკლე ჩანაწერი). შეამოწმეთ.");
  }
  if (new Set(dates.map((d) => d.value)).size > 1) {
    flags.push("multiple");
    issues.push("ტექსტში რამდენიმე თარიღია. აღებულია პირველი.");
  }
  if (first.value < today) {
    flags.push("past");
    issues.push("თარიღი წარსულშია.");
  }
  return { value: first.value, lineNo: first.lineNo, flags, issues };
}
