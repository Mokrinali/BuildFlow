// WhatsApp text import: preview (parse, no writes) and confirm (create a draft).
// Privacy (CLAUDE.md): the pasted text is never logged or stored. The database keeps the
// confirmed items, a SHA-256 hash of the canonical text, counts, and item → line numbers.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { todayInTbilisi } from "@/lib/format";
import { errors } from "@/lib/i18n/ka";
import { requireProjectAccess, type Actor } from "@/server/access";
import { AppError, isUniqueViolation } from "@/server/errors";
import {
  MAX_LINES,
  MAX_TEXT_LENGTH,
  canonicalForHash,
  normalizeText,
  parseMaterialText,
} from "@/server/import/parser";
import { consumeRateLimit } from "@/server/rate-limit";
import { MAX_ITEMS, createRequestInput, insertDraft, itemInput } from "@/server/requests/service";
import { parseInput } from "@/server/validation";

export const PREVIEW_LIMIT_PER_MINUTE = 30;
export const CONFIRM_LIMIT_PER_MINUTE = 10;

const previewInput = z.object({
  projectId: z.string().min(1, "აირჩიეთ პროექტი.").max(64),
  text: z
    .string()
    // Browsers submit textarea line breaks as CRLF; count them as one character, like the form.
    .transform((t) => t.replace(/\r\n?/g, "\n"))
    .pipe(
      z
        .string()
        .max(MAX_TEXT_LENGTH, `ტექსტი ძალიან გრძელია (მაქსიმუმ ${MAX_TEXT_LENGTH} სიმბოლო).`),
    )
    .refine((t) => t.trim().length > 0, "ჩასვით შეტყობინების ტექსტი."),
});

const hashOf = (text: string) =>
  createHash("sha256").update(canonicalForHash(text), "utf8").digest("hex");

/** Parse pasted text for an editable preview. Writes nothing except the rate-limit counter. */
export async function previewImport(actor: Actor, raw: unknown) {
  const input = parseInput(previewInput, raw);
  await consumeRateLimit(`import-preview:${actor.userId}`, PREVIEW_LIMIT_PER_MINUTE);
  await requireProjectAccess(db, actor, input.projectId, {
    requiredRoles: ["REQUESTER"],
    write: true,
  });
  const lineCount = normalizeText(input.text).split(/\r\n|\r|\n/).length;
  if (lineCount > MAX_LINES) {
    throw new AppError("VALIDATION", `ტექსტში ძალიან ბევრი ხაზია (მაქსიმუმ ${MAX_LINES}).`, {
      text: `მაქსიმუმ ${MAX_LINES} ხაზი.`,
    });
  }

  const parsed = parseMaterialText(input.text, todayInTbilisi());
  const items = parsed.lines.flatMap((l) => (l.kind === "items" ? l.items : []));
  if (items.length > MAX_ITEMS) {
    throw new AppError("VALIDATION", `ტექსტში ${MAX_ITEMS}-ზე მეტი პოზიციაა. გაყავით ნაწილებად.`, {
      text: `მაქსიმუმ ${MAX_ITEMS} პოზიცია.`,
    });
  }
  const textHash = hashOf(input.text);
  // Same project only, so the warning never points at a request the user cannot see.
  const previous = await db.requestImport.findFirst({
    where: { organizationId: actor.organizationId, projectId: input.projectId, textHash },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      user: { select: { name: true } },
      request: { select: { id: true, number: true } },
    },
  });

  return {
    projectId: input.projectId,
    lines: parsed.lines,
    desiredDate: parsed.desiredDate,
    textHash,
    idempotencyKey: randomUUID(),
    duplicateOf: previous
      ? {
          requestId: previous.request.id,
          number: previous.request.number,
          createdAt: previous.createdAt,
          by: previous.user.name,
        }
      : null,
    stats: {
      lineCount,
      skippedLineCount: parsed.lines.filter((l) => l.kind === "skipped").length,
      itemCount: items.length,
      flaggedItemCount: items.filter((i) => i.flags.length > 0).length,
    },
  };
}

export type ImportPreview = Awaited<ReturnType<typeof previewImport>>;

const count = z.number().int().min(0).max(MAX_LINES);

export const confirmImportInput = createRequestInput.extend({
  idempotencyKey: z.uuid(),
  textHash: z.string().regex(/^[0-9a-f]{64}$/),
  allowRepeat: z.boolean().default(false),
  items: z
    .array(itemInput.extend({ lineNo: z.number().int().min(1).max(MAX_LINES).nullable() }))
    .min(1, errors.requestNoItems)
    .max(MAX_ITEMS, `მაქსიმუმ ${MAX_ITEMS} პოზიცია.`),
  stats: z.object({ lineCount: count, skippedLineCount: count, flaggedItemCount: count }),
});

/**
 * Create a draft from the reviewed preview. Idempotent per `idempotencyKey`: a repeated submit
 * (double click, retry after a timeout) returns the draft created the first time.
 */
export async function confirmImport(actor: Actor, raw: unknown) {
  const input = parseInput(confirmImportInput, raw);
  await consumeRateLimit(`import-confirm:${actor.userId}`, CONFIRM_LIMIT_PER_MINUTE);

  const replay = await findByKey(actor, input.idempotencyKey);
  if (replay) return replay;

  if (!input.allowRepeat) {
    const previous = await db.requestImport.findFirst({
      where: {
        organizationId: actor.organizationId,
        projectId: input.projectId,
        textHash: input.textHash,
      },
      select: { id: true },
    });
    if (previous) {
      // A parallel submit of this same preview may have committed since the first key lookup:
      // that is a replay, not a repeated text.
      const winner = await findByKey(actor, input.idempotencyKey);
      if (winner) return winner;
      throw new AppError("CONFLICT", errors.importRepeat, { allowRepeat: errors.importRepeat });
    }
  }

  try {
    return await db.$transaction(async (tx) => {
      const request = await insertDraft(
        tx,
        actor,
        {
          projectId: input.projectId,
          desiredDate: input.desiredDate,
          priority: input.priority,
          note: input.note,
          items: input.items,
        },
        { action: "request.imported", changes: { source: "whatsapp" } },
      );
      // The unique key makes a parallel double-submit fail here and roll back its draft.
      await tx.requestImport.create({
        data: {
          organizationId: actor.organizationId,
          projectId: input.projectId,
          userId: actor.userId,
          requestId: request.id,
          idempotencyKey: input.idempotencyKey,
          textHash: input.textHash,
          lineCount: input.stats.lineCount,
          skippedLineCount: input.stats.skippedLineCount,
          itemCount: input.items.length,
          flaggedItemCount: input.stats.flaggedItemCount,
          repeatConfirmed: input.allowRepeat,
          sourceLines: input.items.map((it, i) => ({ position: i + 1, lineNo: it.lineNo })),
        },
      });
      return { id: request.id, number: request.number, replayed: false };
    });
  } catch (e) {
    // Postgres aborts the transaction on the violation, so look up the winner afterwards.
    if (isUniqueViolation(e)) {
      const winner = await findByKey(actor, input.idempotencyKey);
      if (winner) return winner;
    }
    throw e;
  }
}

async function findByKey(actor: Actor, idempotencyKey: string) {
  const found = await db.requestImport.findUnique({
    where: {
      organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey },
    },
    select: { userId: true, request: { select: { id: true, number: true } } },
  });
  if (!found) return null;
  if (found.userId !== actor.userId) throw new AppError("VALIDATION", errors.invalidInput);
  return { id: found.request.id, number: found.request.number, replayed: true };
}
