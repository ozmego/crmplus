import "server-only";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { ImportPurpose, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, type Principal } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { blindIndex, decrypt, encrypt } from "@/server/crypto/field-encryption";
import { getDecrypted, putEncrypted } from "@/server/storage";
import { scanBuffer } from "@/server/scan";
import { parseFile, ParseError } from "@/server/import/parse";
import { FIELD_BY_KEY, suggestMapping, type Mapping } from "@/lib/import/fields";
import { normalizeRow, type NormalizedRow, type RowIssue } from "@/lib/import/normalize";
import { classifyMatch, fieldDiff, normName, type Candidate, type FieldChange } from "@/lib/import/match";

/**
 * İçe aktarma sihirbazı servisi — docs/02, plan v4 §1.
 * Veritabanında ham satır tutulmaz: iletişim bilgisi şifreli, notlar şifreli, finansal sütunlar hiç saklanmaz.
 * Not: satır işleme şu an istek içinde yapılır; büyük dosyalar için aynı fonksiyonlar BullMQ worker'ına taşınacak.
 */

export class ImportError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ?? code);
  }
}

const FILE_TTL_DAYS = 30;
const UPDATABLE = ["firstName", "lastName", "language", "country", "city", "birthYear", "vipLevel"] as const;
type Updatable = (typeof UPDATABLE)[number];

export type RowResult = "NEW" | "MATCHED" | "UNCHANGED" | "CONFLICT" | "MULTI_MATCH" | "POSSIBLE" | "INVALID" | "DUP_IN_FILE";
export type Decision = "KEEP" | "USE_NEW" | "REVIEW";

interface StoredPhone {
  field: string;
  ok: boolean;
  error?: string;
  e164Enc?: string;
  hash?: string;
  masked?: string;
  country?: string;
  lineType?: string;
  changed?: boolean;
  countryMismatch?: boolean;
}

export interface StoredRow {
  crmNo?: number;
  externalId?: string;
  externalSource?: string;
  fields: Partial<Record<Updatable, string>>;
  phones: StoredPhone[];
  email?: { enc: string; hash: string; masked: string };
  tags?: string[];
  ownerAgent?: string;
  notesEnc?: string;
  consent: NormalizedRow["consent"];
  consentDate?: string;
  consentSource?: string;
  consentProofRef?: string;
  issues: RowIssue[];
  match?: { guestId?: string; candidateIds?: string[]; via?: string; reason?: string };
  changes?: FieldChange[];
  addPhones?: number[]; // phones[] indeksleri
  consentPlan?: { channel: string; from: string | null; to: string; action: "APPLY" | "CONFLICT" }[];
}

function maskEmail(e: string) {
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}

function toStored(row: NormalizedRow, issues: RowIssue[]): StoredRow {
  const fields: StoredRow["fields"] = {};
  for (const f of UPDATABLE) {
    const v = row[f as keyof NormalizedRow];
    if (v !== undefined && v !== null && v !== "") fields[f] = String(v);
  }
  return {
    crmNo: row.crmNo,
    externalId: row.externalId,
    externalSource: row.externalSource,
    fields,
    phones: row.phones.map((p) => ({
      field: p.field,
      ok: p.ok,
      error: p.error,
      e164Enc: p.e164 ? encrypt(p.e164) : undefined,
      hash: p.e164 ? blindIndex(p.e164) : undefined,
      masked: p.masked,
      country: p.country,
      lineType: p.lineType,
      changed: p.changed,
      countryMismatch: p.countryMismatch,
    })),
    email: row.email ? { enc: encrypt(row.email), hash: blindIndex(row.email), masked: maskEmail(row.email) } : undefined,
    tags: row.tags,
    ownerAgent: row.ownerAgent,
    notesEnc: row.notes ? encrypt(row.notes) : undefined,
    consent: row.consent,
    consentDate: row.consentDate,
    consentSource: row.consentSource,
    consentProofRef: row.consentProofRef,
    issues,
  };
}

// ───────────────────────── 1. Yükleme ─────────────────────────

export async function createImport(
  user: Principal,
  input: { fileName: string; data: Buffer; purpose: ImportPurpose; sourceLabel: string; defaultCountry: string },
) {
  const sha = createHash("sha256").update(input.data).digest("hex");
  const scan = await scanBuffer(input.data);
  const base = {
    purpose: input.purpose,
    sourceLabel: input.sourceLabel,
    fileName: input.fileName.slice(0, 200),
    fileSha256: sha,
    fileSize: input.data.length,
    defaultCountry: input.defaultCountry,
    uploadedById: user.id,
    scanResult: scan.status === "INFECTED" ? `INFECTED: ${scan.signature}` : scan.status === "ERROR" ? `ERROR: ${scan.message}` : scan.status,
  };
  if (scan.status === "INFECTED" || scan.status === "ERROR") {
    const b = await db.importBatch.create({ data: { ...base, status: "REJECTED" } });
    await audit({ actorId: user.id, action: "import.rejected", entity: "ImportBatch", entityId: b.id, diff: { scan: base.scanResult } });
    throw new ImportError(scan.status === "INFECTED" ? "INFECTED" : "SCAN_ERROR", base.scanResult);
  }

  let parsed;
  try {
    parsed = await parseFile(input.fileName, input.data);
  } catch (e) {
    if (e instanceof ParseError) {
      const b = await db.importBatch.create({ data: { ...base, status: "REJECTED", summary: { parseError: e.code } } });
      await audit({ actorId: user.id, action: "import.rejected", entity: "ImportBatch", entityId: b.id, diff: { parseError: e.code } });
      throw new ImportError(e.code, e.message);
    }
    throw e;
  }
  if (parsed.rows.length === 0) throw new ImportError("EMPTY");

  const storageKey = await putEncrypted("imports", input.data);
  const batch = await db.importBatch.create({
    data: {
      ...base,
      status: "SCANNED",
      storageKey,
      fileExpiresAt: new Date(Date.now() + FILE_TTL_DAYS * 86_400_000),
      sheetName: parsed.sheet,
      headers: parsed.headers,
      mapping: suggestMapping(parsed.headers),
      summary: { rowCount: parsed.rows.length, sheets: parsed.sheets },
    },
  });
  await audit({ actorId: user.id, action: "import.upload", entity: "ImportBatch", entityId: batch.id, diff: { fileName: base.fileName, sha256: sha, rows: parsed.rows.length, scan: base.scanResult } });
  return batch;
}

async function loadBatch(id: string) {
  const b = await db.importBatch.findUnique({ where: { id } });
  if (!b) throw new ImportError("NOT_FOUND");
  return b;
}

async function readRows(b: { storageKey: string | null; fileName: string; sheetName: string | null }) {
  if (!b.storageKey) throw new ImportError("FILE_EXPIRED");
  return parseFile(b.fileName, await getDecrypted(b.storageKey), b.sheetName);
}

// ───────────────────────── 2. Eşleme ─────────────────────────

export async function saveMapping(user: Principal, batchId: string, mapping: Mapping, sheetName?: string) {
  const b = await loadBatch(batchId);
  if (!["SCANNED", "MAPPED", "PREVIEWED"].includes(b.status)) throw new ImportError("BAD_STATUS");
  const headers = new Set(b.headers);
  for (const [h, f] of Object.entries(mapping)) {
    if (!headers.has(h)) throw new ImportError("UNKNOWN_HEADER", h);
    if (f !== null && !FIELD_BY_KEY.has(f)) throw new ImportError("UNKNOWN_FIELD", f);
  }
  const counts = new Map<string, number>();
  for (const f of Object.values(mapping)) if (f && f !== "financial") counts.set(f, (counts.get(f) ?? 0) + 1);
  const dup = [...counts].find(([, n]) => n > 1);
  if (dup) throw new ImportError("DUPLICATE_TARGET", dup[0]);
  const values = Object.values(mapping);
  const hasName = values.includes("fullName") || (values.includes("firstName") && values.includes("lastName"));
  if (!values.includes("crmId") && !hasName) throw new ImportError("NAME_REQUIRED");
  if (!values.includes("crmId") && !values.includes("externalId") && !values.includes("phone1") && !values.includes("email")) {
    throw new ImportError("KEY_REQUIRED");
  }
  const matchKey = values.includes("crmId") ? "CRM_ID" : values.includes("externalId") ? "EXTERNAL_ID" : "PHONE_PLUS";
  await db.importBatch.update({ where: { id: b.id }, data: { mapping, matchKey, status: "MAPPED", sheetName: sheetName ?? b.sheetName } });
  await audit({ actorId: user.id, action: "import.mapping", entity: "ImportBatch", entityId: b.id, diff: { mapping, matchKey } });
}

// ───────────────────────── 3. Önizleme ─────────────────────────

export async function buildPreview(user: Principal, batchId: string) {
  const b = await loadBatch(batchId);
  if (!["MAPPED", "PREVIEWED"].includes(b.status)) throw new ImportError("BAD_STATUS");
  const mapping = b.mapping as Mapping;
  const parsed = await readRows(b);
  const today = new Date();

  const stored: { rowNo: number; s: StoredRow }[] = parsed.rows.map((raw, i) => {
    const { row, issues } = normalizeRow(raw, mapping, { defaultCountry: b.defaultCountry, today });
    return { rowNo: (raw.__row as number) ?? i + 2, s: toStored(row, issues) };
  });

  // Aday kayıtları toplu yükle
  const crmNos = [...new Set(stored.map((r) => r.s.crmNo).filter((n): n is number => n !== undefined))];
  const exts = stored.filter((r) => r.s.externalId && r.s.externalSource).map((r) => ({ source: r.s.externalSource!, value: r.s.externalId! }));
  const hashes = [...new Set(stored.flatMap((r) => r.s.phones.map((p) => p.hash).filter((h): h is string => !!h)))];
  const select = {
    id: true, crmNo: true, firstName: true, lastName: true, language: true, country: true, city: true, birthYear: true, vipLevel: true,
    emails: { select: { emailHash: true } },
    phones: { select: { phoneHash: true } },
    consents: { select: { channel: true, status: true } },
    blocks: { where: { removedAt: null }, select: { allChannels: true, channel: true } },
  } satisfies Prisma.GuestSelect;
  const chunk = <T,>(arr: T[], n = 1000) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const guestsById = new Map<string, Prisma.GuestGetPayload<{ select: typeof select }>>();
  const byCrm = new Map<number, string>();
  for (const part of chunk(crmNos)) {
    for (const g of await db.guest.findMany({ where: { crmNo: { in: part }, anonymizedAt: null }, select })) {
      guestsById.set(g.id, g);
      byCrm.set(g.crmNo, g.id);
    }
  }
  const byExt = new Map<string, string[]>();
  for (const part of chunk(exts, 500)) {
    const found = await db.guestExternalId.findMany({ where: { OR: part }, select: { source: true, value: true, guest: { select } } });
    for (const f of found) {
      guestsById.set(f.guest.id, f.guest);
      const k = `${f.source}\u0000${f.value}`;
      byExt.set(k, [...(byExt.get(k) ?? []), f.guest.id]);
    }
  }
  const byPhone = new Map<string, string[]>();
  for (const part of chunk(hashes)) {
    const found = await db.guestPhone.findMany({ where: { phoneHash: { in: part }, guest: { anonymizedAt: null } }, select: { phoneHash: true, guest: { select } } });
    for (const f of found) {
      guestsById.set(f.guest.id, f.guest);
      byPhone.set(f.phoneHash, [...new Set([...(byPhone.get(f.phoneHash) ?? []), f.guest.id])]);
    }
  }

  const seen = new Set<string>();
  const results: { rowNo: number; result: RowResult; s: StoredRow; guestId?: string }[] = [];
  for (const { rowNo, s } of stored) {
    if (s.issues.some((i) => i.severity === "error")) {
      results.push({ rowNo, result: "INVALID", s });
      continue;
    }
    const firstPhone = s.phones.find((p) => p.hash)?.hash;
    const dupKey = s.crmNo !== undefined ? `crm:${s.crmNo}` : firstPhone ? `ph:${firstPhone}:${normName(`${s.fields.firstName ?? ""} ${s.fields.lastName ?? ""}`)}` : null;
    if (dupKey) {
      if (seen.has(dupKey)) {
        results.push({ rowNo, result: "DUP_IN_FILE", s });
        continue;
      }
      seen.add(dupKey);
    }

    const candidates: Candidate[] = [];
    const push = (id: string, via: Candidate["via"]) => {
      const g = guestsById.get(id);
      if (g) candidates.push({ id, firstName: g.firstName, lastName: g.lastName, birthYear: g.birthYear, emailHash: g.emails[0]?.emailHash, via });
    };
    if (s.crmNo !== undefined && byCrm.has(s.crmNo)) push(byCrm.get(s.crmNo)!, "CRM_ID");
    if (s.externalId && s.externalSource) for (const id of byExt.get(`${s.externalSource}\u0000${s.externalId}`) ?? []) push(id, "EXTERNAL_ID");
    for (const p of s.phones) if (p.hash) for (const id of byPhone.get(p.hash) ?? []) push(id, "PHONE");

    const m = classifyMatch(
      { crmNo: s.crmNo, firstName: s.fields.firstName, lastName: s.fields.lastName, birthYear: s.fields.birthYear ? Number(s.fields.birthYear) : undefined, emailHash: s.email?.hash },
      candidates,
    );
    if (m.kind === "CRM_ID_NOT_FOUND") {
      s.issues.push({ code: "E_REQUIRED", field: "crmId", message: `CRM ID sistemde yok: ${s.crmNo}`, severity: "error" });
      results.push({ rowNo, result: "INVALID", s });
      continue;
    }
    if (m.kind === "NEW") {
      results.push({ rowNo, result: "NEW", s });
      continue;
    }
    if (m.kind === "MULTI_MATCH" || m.kind === "POSSIBLE") {
      s.match = { candidateIds: m.candidateIds, reason: m.kind === "POSSIBLE" ? m.reason : "MULTI" };
      results.push({ rowNo, result: m.kind, s });
      continue;
    }

    const g = guestsById.get(m.guestId)!;
    s.match = { guestId: g.id, via: m.via };
    const existing: Record<string, string | null> = {};
    for (const f of UPDATABLE) existing[f] = g[f] === null || g[f] === undefined ? null : String(g[f]);
    s.changes = fieldDiff(existing, s.fields);
    const have = new Set(g.phones.map((p) => p.phoneHash));
    s.addPhones = s.phones.map((p, i) => (p.hash && !have.has(p.hash) ? i : -1)).filter((i) => i >= 0);
    s.consentPlan = [];
    for (const [ch, to] of Object.entries(s.consent)) {
      if (!to || to === "UNKNOWN") continue;
      const cur = g.consents.find((c) => c.channel === ch)?.status ?? null;
      const blocked = g.blocks.some((bl) => bl.allChannels || bl.channel === ch);
      if (cur === to) continue;
      if (to === "GRANTED" && (cur === "DENIED" || blocked)) s.consentPlan.push({ channel: ch, from: cur, to, action: "CONFLICT" });
      else s.consentPlan.push({ channel: ch, from: cur, to, action: "APPLY" });
    }
    const hasConflict = s.changes.some((c) => c.action === "CONFLICT");
    const hasChange = s.changes.length > 0 || s.addPhones.length > 0 || s.consentPlan.length > 0;
    results.push({ rowNo, result: hasConflict ? "CONFLICT" : hasChange ? "MATCHED" : "UNCHANGED", s, guestId: g.id });
  }

  const count = (r: RowResult) => results.filter((x) => x.result === r).length;
  const summary = {
    rowCount: results.length,
    new: count("NEW"),
    matched: count("MATCHED") + count("UNCHANGED") + count("CONFLICT"),
    changed: count("MATCHED"),
    unchanged: count("UNCHANGED"),
    conflict: count("CONFLICT"),
    multi: count("MULTI_MATCH"),
    possible: count("POSSIBLE"),
    invalid: count("INVALID"),
    dupInFile: count("DUP_IN_FILE"),
    invalidPhones: results.filter((r) => r.s.phones.some((p) => !p.ok)).length,
    missingRequired: results.filter((r) => r.s.issues.some((i) => i.code === "E_REQUIRED")).length,
    consentMissing: results.filter((r) => r.result !== "INVALID" && r.s.consent.CALL !== "GRANTED" && r.s.consent.CALL !== "DENIED").length,
    consentConflicts: results.filter((r) => r.s.consentPlan?.some((c) => c.action === "CONFLICT")).length,
    financialColumns: Object.values(b.mapping as Mapping).filter((v) => v === "financial").length,
    warnings: results.filter((r) => r.s.issues.some((i) => i.severity === "warning")).length,
    sheets: (b.summary as { sheets?: string[] } | null)?.sheets ?? [],
  };

  await db.$transaction(async (tx) => {
    await tx.importRow.deleteMany({ where: { batchId: b.id } });
    for (const part of chunk(results, 500)) {
      await tx.importRow.createMany({
        data: part.map((r) => ({
          batchId: b.id,
          rowNo: r.rowNo,
          raw: {},
          normalized: r.s as unknown as Prisma.InputJsonValue,
          result: r.result,
          guestId: r.guestId ?? null,
          errors: r.s.issues.length ? (r.s.issues as unknown as Prisma.InputJsonValue) : undefined,
        })),
      });
    }
    await tx.importBatch.update({ where: { id: b.id }, data: { status: "PREVIEWED", summary } });
  }, { timeout: 120_000 });
  await audit({ actorId: user.id, action: "import.preview", entity: "ImportBatch", entityId: b.id, diff: summary });
  return summary;
}

// ───────────────────────── 4. Kararlar ─────────────────────────

export async function setRowDecisions(user: Principal, batchId: string, rowNo: number, decisions: Record<string, Decision>) {
  const b = await loadBatch(batchId);
  if (b.status !== "PREVIEWED") throw new ImportError("BAD_STATUS");
  const row = await db.importRow.findFirst({ where: { batchId, rowNo, result: "CONFLICT" } });
  if (!row) throw new ImportError("ROW_NOT_FOUND");
  const s = row.normalized as unknown as StoredRow;
  const allowed = new Set((s.changes ?? []).filter((c) => c.action === "CONFLICT").map((c) => c.field));
  for (const f of Object.keys(decisions)) if (!allowed.has(f)) throw new ImportError("UNKNOWN_FIELD", f);
  await db.importRow.update({ where: { id: row.id }, data: { decisions: { ...((row.decisions as object) ?? {}), ...decisions } } });
}

/** Tüm çakışmalı alanlara aynı kararı uygular (ör. hepsini incelemeye gönder). */
export async function setAllDecisions(user: Principal, batchId: string, decision: Decision) {
  const b = await loadBatch(batchId);
  if (b.status !== "PREVIEWED") throw new ImportError("BAD_STATUS");
  const rows = await db.importRow.findMany({ where: { batchId, result: "CONFLICT" } });
  for (const row of rows) {
    const s = row.normalized as unknown as StoredRow;
    const d = Object.fromEntries((s.changes ?? []).filter((c) => c.action === "CONFLICT").map((c) => [c.field, decision]));
    await db.importRow.update({ where: { id: row.id }, data: { decisions: d } });
  }
  await audit({ actorId: user.id, action: "import.bulk_decision", entity: "ImportBatch", entityId: batchId, diff: { decision, rows: rows.length } });
}

export async function pendingDecisionCount(batchId: string) {
  const rows = await db.importRow.findMany({ where: { batchId, result: "CONFLICT" }, select: { normalized: true, decisions: true } });
  return rows.filter((r) => {
    const s = r.normalized as unknown as StoredRow;
    const d = (r.decisions as Record<string, Decision> | null) ?? {};
    return (s.changes ?? []).some((c) => c.action === "CONFLICT" && !d[c.field]);
  }).length;
}

// ───────────────────────── 5. Uygulama ─────────────────────────

export async function applyImport(user: Principal, batchId: string) {
  const b = await loadBatch(batchId);
  if (b.purpose === "COMPARE") throw new ImportError("COMPARE_ONLY");
  if (b.status !== "PREVIEWED") throw new ImportError("BAD_STATUS");
  if ((await pendingDecisionCount(batchId)) > 0) throw new ImportError("DECISIONS_PENDING");

  const rows = await db.importRow.findMany({ where: { batchId, result: { in: ["NEW", "MATCHED", "CONFLICT", "POSSIBLE", "MULTI_MATCH"] } }, orderBy: { rowNo: "asc" } });
  const owners = new Map(
    (await db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]),
  );
  const now = new Date();
  const source = `import:${b.id}`;
  const stats = { created: 0, updated: 0, review: 0, phonesAdded: 0, consents: 0 };

  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100);
    await db.$transaction(async (tx) => {
      for (const row of part) {
        const s = row.normalized as unknown as StoredRow;
        const applied: Record<string, unknown> = {};

        if (row.result === "POSSIBLE" || row.result === "MULTI_MATCH") {
          await tx.reviewItem.create({
            data: {
              kind: row.result === "POSSIBLE" ? "POSSIBLE_DUPLICATE" : "MULTI_MATCH",
              candidates: s.match?.candidateIds ?? [],
              payload: {
                rowNo: row.rowNo,
                incoming: { ...s.fields, phones: s.phones.map((p) => p.masked).filter((m): m is string => !!m) },
                reason: s.match?.reason ?? null,
              } as Prisma.InputJsonValue,
              sourceRef: source,
            },
          });
          stats.review++;
          await tx.importRow.update({ where: { id: row.id }, data: { applied: { review: true } } });
          continue;
        }

        if (row.result === "NEW") {
          const g = await createGuestFromRow(tx, s, { actorId: user.id, source, ownerId: s.ownerAgent ? owners.get(s.ownerAgent) : undefined, label: "İçe aktarma: " + b.fileName, refId: b.id });
          stats.consents += g.consents;
          applied.createdGuestId = g.id;
          stats.created++;
          await tx.importRow.update({ where: { id: row.id }, data: { applied: applied as Prisma.InputJsonValue, guestId: g.id } });
          continue;
        }

        // MATCHED / CONFLICT
        const guestId = row.guestId!;
        const decisions = (row.decisions as Record<string, Decision> | null) ?? {};
        const guest = await tx.guest.findUniqueOrThrow({ where: { id: guestId } });
        const update: Prisma.GuestUpdateInput = {};
        const fieldSources = { ...((guest.fieldSources as Record<string, unknown>) ?? {}) };
        const changedFields: { field: string; old: string | null; new: string }[] = [];
        for (const c of s.changes ?? []) {
          const d = c.action === "FILL" ? "USE_NEW" : decisions[c.field];
          if (d === "USE_NEW") {
            (update as Record<string, unknown>)[c.field] = c.field === "birthYear" ? Number(c.new) : c.new;
            fieldSources[c.field] = { source, at: now.toISOString() };
            changedFields.push({ field: c.field, old: c.old, new: c.new });
            await tx.fieldHistory.create({ data: { guestId, field: c.field, oldValue: c.old, newValue: c.new, importBatchId: b.id, sourceId: source, actorId: user.id } });
          } else if (d === "REVIEW") {
            await tx.reviewItem.create({
              data: { kind: "FIELD_CONFLICT", guestId, candidates: [guestId], payload: { field: c.field, current: c.old, incoming: c.new, rowNo: row.rowNo }, sourceRef: source },
            });
            stats.review++;
          }
        }
        if (changedFields.length) {
          update.fieldSources = fieldSources as Prisma.InputJsonValue;
          await tx.guest.update({ where: { id: guestId }, data: update });
          stats.updated++;
        }
        const phonesAdded: string[] = [];
        for (const idx of s.addPhones ?? []) {
          const p = s.phones[idx];
          if (!p?.ok || !p.e164Enc) continue;
          const created = await tx.guestPhone.create({
            data: { guestId, e164Enc: p.e164Enc, phoneHash: p.hash!, masked: p.masked!, country: p.country, lineType: p.lineType, isPrimary: false, formatStatus: p.countryMismatch ? "COUNTRY_MISMATCH" : "VALID", lastCheckedAt: now },
          });
          await tx.fieldHistory.create({ data: { guestId, field: "phone", oldValue: null, newValue: p.masked ?? null, importBatchId: b.id, sourceId: source, actorId: user.id } });
          phonesAdded.push(created.id);
          stats.phonesAdded++;
        }
        const consentsApplied: { channel: string; from: string | null; to: string }[] = [];
        for (const cp of s.consentPlan ?? []) {
          if (cp.action === "CONFLICT") {
            await tx.reviewItem.create({
              data: { kind: "CONSENT_CONFLICT", guestId, candidates: [guestId], payload: { channel: cp.channel, current: cp.from, incoming: cp.to, rowNo: row.rowNo }, sourceRef: source },
            });
            stats.review++;
            continue;
          }
          await tx.consentRecord.upsert({
            where: { guestId_channel: { guestId, channel: cp.channel as "CALL" } },
            update: {
              status: cp.to as "GRANTED", source: s.consentSource, sourceSystem: source, proofRef: s.consentProofRef, updatedBy: user.id,
              ...(cp.to === "GRANTED" ? { grantedAt: new Date(s.consentDate!) } : { deniedAt: now }),
            },
            create: {
              guestId, channel: cp.channel as "CALL", status: cp.to as "GRANTED", source: s.consentSource, sourceSystem: source, proofRef: s.consentProofRef, updatedBy: user.id,
              grantedAt: cp.to === "GRANTED" ? new Date(s.consentDate!) : null, deniedAt: cp.to === "DENIED" ? now : null,
            },
          });
          await tx.consentHistory.create({ data: { guestId, channel: cp.channel, oldStatus: cp.from, newStatus: cp.to, source, actorId: user.id } });
          consentsApplied.push({ channel: cp.channel, from: cp.from, to: cp.to });
          stats.consents++;
        }
        await tx.importRow.update({
          where: { id: row.id },
          data: { applied: { guestId, fields: changedFields, phonesAdded, consents: consentsApplied } as Prisma.InputJsonValue },
        });
      }
    }, { timeout: 120_000 });
  }

  const summary = { ...((b.summary as object) ?? {}), applied: stats };
  await db.importBatch.update({ where: { id: b.id }, data: { status: "APPLIED", appliedAt: now, summary } });
  await audit({ actorId: user.id, action: "import.apply", entity: "ImportBatch", entityId: b.id, diff: stats });
  return stats;
}

/** İçe aktarılan (normalize, şifreli) satırdan yeni misafir oluşturur. İçe aktarma ve inceleme kuyruğu ortak kullanır. */
export async function createGuestFromRow(
  tx: Prisma.TransactionClient,
  s: StoredRow,
  ctx: { actorId: string; source: string; ownerId?: string; label: string; refId: string },
) {
  const now = new Date();
  const okPhones = s.phones.filter((p) => p.ok && p.e164Enc);
  const g = await tx.guest.create({
    data: {
      firstName: s.fields.firstName ?? "",
      lastName: s.fields.lastName ?? "",
      language: s.fields.language ?? "tr",
      country: s.fields.country,
      city: s.fields.city,
      birthYear: s.fields.birthYear ? Number(s.fields.birthYear) : undefined,
      vipLevel: s.fields.vipLevel,
      tags: s.tags ?? [],
      ownerId: ctx.ownerId,
      fieldSources: Object.fromEntries(Object.keys(s.fields).map((f) => [f, { source: ctx.source, at: now.toISOString() }])),
      phones: {
        create: okPhones.map((p, idx) => ({
          e164Enc: p.e164Enc!, phoneHash: p.hash!, masked: p.masked!, country: p.country, lineType: p.lineType,
          isPrimary: idx === 0, formatStatus: p.countryMismatch ? "COUNTRY_MISMATCH" : "VALID", lastCheckedAt: now,
        })),
      },
      emails: s.email ? { create: { emailEnc: s.email.enc, emailHash: s.email.hash, masked: s.email.masked, isPrimary: true } } : undefined,
      externalIds: s.externalId && s.externalSource ? { create: { source: s.externalSource, value: s.externalId } } : undefined,
      notes: s.notesEnc ? { create: { bodyEnc: s.notesEnc, authorId: ctx.actorId } } : undefined,
    },
  });
  let consents = 0;
  for (const [ch, st] of Object.entries(s.consent)) {
    if (!st || st === "UNKNOWN") continue;
    await tx.consentRecord.create({
      data: {
        guestId: g.id, channel: ch as "CALL", status: st, source: s.consentSource, sourceSystem: ctx.source, proofRef: s.consentProofRef,
        grantedAt: st === "GRANTED" ? new Date(s.consentDate!) : null, deniedAt: st === "DENIED" ? (s.consentDate ? new Date(s.consentDate) : now) : null,
        updatedBy: ctx.actorId,
      },
    });
    await tx.consentHistory.create({ data: { guestId: g.id, channel: ch, oldStatus: null, newStatus: st, source: ctx.source, actorId: ctx.actorId } });
    consents++;
  }
  await tx.interaction.create({ data: { guestId: g.id, channel: "IMPORT", summary: ctx.label, actorId: ctx.actorId, refId: ctx.refId } });
  return { id: g.id, consents };
}

/**
 * İnceleme kuyruğundan birleştirme: yalnız boş alanları doldurur, yeni numaraları ekler,
 * ret izinlerini uygular. Dolu alan ve mevcut izin ezilmez.
 */
export async function mergeRowIntoGuest(tx: Prisma.TransactionClient, guestId: string, s: StoredRow, ctx: { actorId: string; source: string }) {
  const now = new Date();
  const g = await tx.guest.findUniqueOrThrow({ where: { id: guestId }, include: { phones: true, consents: true, blocks: { where: { removedAt: null } } } });
  const existing: Record<string, string | null> = {};
  for (const f of UPDATABLE) existing[f] = g[f] === null || g[f] === undefined ? null : String(g[f]);
  const fills = fieldDiff(existing, s.fields).filter((c) => c.action === "FILL");
  if (fills.length) {
    const fs = { ...((g.fieldSources as Record<string, unknown>) ?? {}) };
    const data: Record<string, unknown> = {};
    for (const c of fills) {
      data[c.field] = c.field === "birthYear" ? Number(c.new) : c.new;
      fs[c.field] = { source: ctx.source, at: now.toISOString() };
      await tx.fieldHistory.create({ data: { guestId, field: c.field, oldValue: null, newValue: c.new, sourceId: ctx.source, actorId: ctx.actorId } });
    }
    await tx.guest.update({ where: { id: guestId }, data: { ...data, fieldSources: fs as Prisma.InputJsonValue } });
  }
  const have = new Set(g.phones.map((p) => p.phoneHash));
  let phones = 0;
  for (const p of s.phones) {
    if (!p.ok || !p.e164Enc || !p.hash || have.has(p.hash)) continue;
    await tx.guestPhone.create({
      data: { guestId, e164Enc: p.e164Enc, phoneHash: p.hash, masked: p.masked!, country: p.country, lineType: p.lineType, formatStatus: p.countryMismatch ? "COUNTRY_MISMATCH" : "VALID", lastCheckedAt: now },
    });
    await tx.fieldHistory.create({ data: { guestId, field: "phone", oldValue: null, newValue: p.masked ?? null, sourceId: ctx.source, actorId: ctx.actorId } });
    phones++;
  }
  for (const [ch, st] of Object.entries(s.consent)) {
    if (!st || st === "UNKNOWN") continue;
    const cur = g.consents.find((c) => c.channel === ch);
    const blocked = g.blocks.some((b) => b.allChannels || b.channel === ch);
    // Ret her zaman uygulanır; izin yalnız kayıt yoksa ve durdurma yoksa
    if (st === "GRANTED" && (cur || blocked)) continue;
    if (cur?.status === st) continue;
    await tx.consentRecord.upsert({
      where: { guestId_channel: { guestId, channel: ch as "CALL" } },
      update: { status: st, source: s.consentSource, sourceSystem: ctx.source, proofRef: s.consentProofRef, updatedBy: ctx.actorId, ...(st === "DENIED" ? { deniedAt: now } : {}) },
      create: {
        guestId, channel: ch as "CALL", status: st, source: s.consentSource, sourceSystem: ctx.source, proofRef: s.consentProofRef, updatedBy: ctx.actorId,
        grantedAt: st === "GRANTED" && s.consentDate ? new Date(s.consentDate) : null, deniedAt: st === "DENIED" ? now : null,
      },
    });
    await tx.consentHistory.create({ data: { guestId, channel: ch, oldStatus: cur?.status ?? null, newStatus: st, source: ctx.source, actorId: ctx.actorId } });
  }
  return { filled: fills.map((c) => c.field), phones };
}

// ───────────────────────── 6. Geri alma ─────────────────────────

/**
 * Bu içe aktarmanın yaptığı değişiklikleri geri çevirir. Sonradan başka kaynakça değiştirilmiş alanlar
 * ve iletişim kurulmuş misafirler dokunulmadan "çakışma" olarak raporlanır. Ret (DENIED) kayıtları geri alınmaz.
 */
export async function rollbackImport(user: Principal, batchId: string, reason: string) {
  const b = await loadBatch(batchId);
  if (b.status !== "APPLIED") throw new ImportError("BAD_STATUS");
  const rows = await db.importRow.findMany({ where: { batchId, applied: { not: undefined } } });
  const source = `import:${b.id}`;
  const result = { reverted: 0, guestsRemoved: 0, conflicts: [] as { rowNo: number; reason: string }[] };

  for (const row of rows) {
    const a = row.applied as Record<string, unknown> | null;
    if (!a) continue;
    await db.$transaction(async (tx) => {
      if (a.createdGuestId) {
        const gid = a.createdGuestId as string;
        const [calls, tasks, others] = await Promise.all([
          tx.call.count({ where: { guestId: gid } }),
          tx.task.count({ where: { guestId: gid } }),
          tx.fieldHistory.count({ where: { guestId: gid, NOT: { sourceId: source } } }),
        ]);
        if (calls || tasks || others) {
          result.conflicts.push({ rowNo: row.rowNo, reason: "Misafir sonradan kullanıldı (çağrı/görev/değişiklik); silinmedi." });
          return;
        }
        await tx.guest.delete({ where: { id: gid } });
        result.guestsRemoved++;
        return;
      }
      const gid = a.guestId as string | undefined;
      if (!gid) return;
      const guest = await tx.guest.findUnique({ where: { id: gid } });
      if (!guest) return;
      const fs = { ...((guest.fieldSources as Record<string, { source?: string }>) ?? {}) };
      const revert: Record<string, unknown> = {};
      for (const f of (a.fields as { field: string; old: string | null; new: string }[]) ?? []) {
        const cur = (guest as Record<string, unknown>)[f.field];
        if (String(cur ?? "") !== f.new || fs[f.field]?.source !== source) {
          result.conflicts.push({ rowNo: row.rowNo, reason: `${f.field} sonradan değişmiş; geri alınmadı.` });
          continue;
        }
        revert[f.field] = f.field === "birthYear" ? (f.old ? Number(f.old) : null) : f.old;
        delete fs[f.field];
        await tx.fieldHistory.create({ data: { guestId: gid, field: f.field, oldValue: f.new, newValue: f.old, sourceId: `rollback:${b.id}`, actorId: user.id } });
      }
      if (Object.keys(revert).length) await tx.guest.update({ where: { id: gid }, data: { ...revert, fieldSources: fs as Prisma.InputJsonValue } });
      for (const pid of (a.phonesAdded as string[]) ?? []) {
        if (await tx.call.count({ where: { phoneId: pid } })) {
          result.conflicts.push({ rowNo: row.rowNo, reason: "Eklenen numara aranmış; silinmedi." });
          continue;
        }
        await tx.guestPhone.delete({ where: { id: pid } }).catch(() => undefined);
      }
      for (const c of (a.consents as { channel: string; from: string | null; to: string }[]) ?? []) {
        if (c.to === "DENIED") {
          result.conflicts.push({ rowNo: row.rowNo, reason: `${c.channel} ret kaydı güvenlik gereği geri alınmadı.` });
          continue;
        }
        const cur = await tx.consentRecord.findUnique({ where: { guestId_channel: { guestId: gid, channel: c.channel as "CALL" } } });
        if (!cur || cur.status !== c.to || cur.sourceSystem !== source) {
          result.conflicts.push({ rowNo: row.rowNo, reason: `${c.channel} izni sonradan değişmiş; geri alınmadı.` });
          continue;
        }
        if (c.from) await tx.consentRecord.update({ where: { id: cur.id }, data: { status: c.from as "GRANTED", sourceSystem: `rollback:${b.id}` } });
        else await tx.consentRecord.delete({ where: { id: cur.id } });
        await tx.consentHistory.create({ data: { guestId: gid, channel: c.channel, oldStatus: c.to, newStatus: c.from ?? "UNKNOWN", source: `rollback:${b.id}`, actorId: user.id } });
      }
      result.reverted++;
    });
  }
  await db.reviewItem.updateMany({ where: { sourceRef: source, status: "OPEN" }, data: { status: "DISMISSED", reason: "İçe aktarma geri alındı", decidedBy: user.id, decidedAt: new Date() } });
  await db.importBatch.update({
    where: { id: b.id },
    data: { status: "ROLLED_BACK", rolledBackAt: new Date(), summary: { ...((b.summary as object) ?? {}), rollback: result } },
  });
  await audit({ actorId: user.id, action: "import.rollback", entity: "ImportBatch", entityId: b.id, reason, diff: { reverted: result.reverted, guestsRemoved: result.guestsRemoved, conflicts: result.conflicts.length } });
  return result;
}

// ───────────────────────── 7. Hata raporu ─────────────────────────

/** Hatalı/uyarılı satırları orijinal sütunlarla (finansal sütunlar hariç) Excel olarak üretir. */
export async function buildErrorReport(user: Principal, batchId: string): Promise<{ fileName: string; data: Buffer }> {
  const b = await loadBatch(batchId);
  const issues = await db.importRow.findMany({ where: { batchId, errors: { not: undefined } }, select: { rowNo: true, errors: true, result: true }, orderBy: { rowNo: "asc" } });
  const byRow = new Map(issues.map((r) => [r.rowNo, r]));
  const parsed = await readRows(b);
  const mapping = (b.mapping as Mapping) ?? {};
  const headers = parsed.headers.filter((h) => mapping[h] !== "financial" && (mapping[h] !== "notes" || can(user, "field.notes")));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hatalar");
  ws.addRow(["Satır No", "Sonuç", "Hata/uyarı kodu", "Açıklama", ...headers]).font = { bold: true };
  for (const raw of parsed.rows) {
    const r = byRow.get(raw.__row as number);
    if (!r) continue;
    const list = (r.errors as unknown as RowIssue[]) ?? [];
    ws.addRow([raw.__row, r.result, list.map((i) => i.code).join(", "), list.map((i) => i.message).join(" · "), ...headers.map((h) => raw[h] as ExcelJS.CellValue)]);
  }
  ws.columns.forEach((c) => (c.width = 22));
  await audit({ actorId: user.id, action: "import.error_report", entity: "ImportBatch", entityId: batchId, diff: { rows: issues.length } });
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return { fileName: `hata-raporu-${b.fileName.replace(/\.[^.]+$/, "")}.xlsx`, data };
}

export function decryptMaybe(enc?: string) {
  return enc ? decrypt(enc) : undefined;
}
