import "server-only";
import { createHash, randomUUID } from "node:crypto";
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
  // IMPORT_TRACE=1: aşama süreleri (performans ölçümü, docs/12)
  const trace = process.env.IMPORT_TRACE === "1";
  let t0 = performance.now();
  const lap = (label: string) => {
    if (!trace) return;
    const t = performance.now();
    console.log(`  [önizleme] ${label}: ${((t - t0) / 1000).toFixed(1)} sn`);
    t0 = t;
  };
  const parsed = await readRows(b);
  lap("dosya okuma+ayrıştırma");
  const today = new Date();

  const stored: { rowNo: number; s: StoredRow }[] = parsed.rows.map((raw, i) => {
    const { row, issues } = normalizeRow(raw, mapping, { defaultCountry: b.defaultCountry, today });
    return { rowNo: (raw.__row as number) ?? i + 2, s: toStored(row, issues) };
  });

  lap("normalizasyon");
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

  // 1) Yalnız kimlikler (hafif SQL, = ANY(dizi)); 2) her aday misafir bir kez, ilişkileriyle
  const addTo = <K,>(m: Map<K, string[]>, k: K, id: string) => {
    const cur = m.get(k);
    if (!cur) m.set(k, [id]);
    else if (!cur.includes(id)) cur.push(id);
  };
  const ids = new Set<string>();
  const byCrm = new Map<number, string>();
  for (const part of chunk(crmNos, 10_000)) {
    const found = await db.$queryRaw<{ id: string; crmNo: number }[]>`SELECT id, "crmNo" FROM public."Guest" WHERE "crmNo" = ANY(${part}::int[]) AND "anonymizedAt" IS NULL`;
    for (const f of found) {
      byCrm.set(f.crmNo, f.id);
      ids.add(f.id);
    }
  }
  const byExt = new Map<string, string[]>();
  const valuesBySource = new Map<string, Set<string>>();
  for (const e of exts) {
    if (!valuesBySource.has(e.source)) valuesBySource.set(e.source, new Set());
    valuesBySource.get(e.source)!.add(e.value);
  }
  for (const [source, values] of valuesBySource) {
    for (const part of chunk([...values], 10_000)) {
      const found = await db.$queryRaw<{ value: string; guestId: string }[]>`SELECT e.value, e."guestId" FROM public."GuestExternalId" e JOIN public."Guest" g ON g.id = e."guestId" WHERE e.source = ${source} AND e.value = ANY(${part}::text[]) AND g."anonymizedAt" IS NULL`;
      for (const f of found) {
        addTo(byExt, `${source}\u0000${f.value}`, f.guestId);
        ids.add(f.guestId);
      }
    }
  }
  const byPhone = new Map<string, string[]>();
  for (const part of chunk(hashes, 10_000)) {
    const found = await db.$queryRaw<{ phoneHash: string; guestId: string }[]>`SELECT p."phoneHash", p."guestId" FROM public."GuestPhone" p JOIN public."Guest" g ON g.id = p."guestId" WHERE p."phoneHash" = ANY(${part}::text[]) AND g."anonymizedAt" IS NULL`;
    for (const f of found) {
      addTo(byPhone, f.phoneHash, f.guestId);
      ids.add(f.guestId);
    }
  }
  lap(`aday kimlikleri (${ids.size})`);
  const guestsById = new Map<string, Prisma.GuestGetPayload<{ select: typeof select }>>();
  for (const part of chunk([...ids], 5000)) {
    for (const g of await db.guest.findMany({ where: { id: { in: part } }, select })) guestsById.set(g.id, g);
  }

  lap("aday yükleme");
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

  lap("eşleştirme");
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

  // Tek uzun işlem yerine: önce MAPPED'e dön ve eski satırları sil (yarım kalırsa önizleme yok sayılır),
  // satırları parça parça yaz, en son PREVIEWED. 500k satır tek işlemde zaman aşımına uğruyordu.
  await db.$transaction([
    db.importBatch.update({ where: { id: b.id }, data: { status: "MAPPED" } }),
    db.importRow.deleteMany({ where: { batchId: b.id } }),
  ]);
  {
    for (const part of chunk(results, 2000)) {
      await db.importRow.createMany({
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
    await db.importBatch.update({ where: { id: b.id }, data: { status: "PREVIEWED", summary } });
  }
  lap("satırların yazılması");
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
  if (!["USE_NEW", "KEEP", "REVIEW"].includes(decision)) throw new ImportError("BAD_DECISION");
  // Tek sorgu: her satırın çakışmalı alanları için aynı karar (500k satırda satır satır güncelleme dakikalar sürüyordu)
  const rows = await db.$executeRaw`
    UPDATE public."ImportRow" r
    SET decisions = sub.d
    FROM (
      SELECT ir.id, jsonb_object_agg(c->>'field', to_jsonb(${decision}::text)) AS d
      FROM public."ImportRow" ir, jsonb_array_elements(COALESCE(ir.normalized->'changes', '[]'::jsonb)) c
      WHERE ir."batchId" = ${batchId} AND ir.result = 'CONFLICT' AND c->>'action' = 'CONFLICT'
      GROUP BY ir.id
    ) sub
    WHERE r.id = sub.id`;
  await audit({ actorId: user.id, action: "import.bulk_decision", entity: "ImportBatch", entityId: batchId, diff: { decision, rows } });
}

/** Kararı eksik çakışmalı satır sayısı (veritabanında hesaplanır; satırlar belleğe alınmaz). */
export async function pendingDecisionCount(batchId: string) {
  const [r] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM public."ImportRow" r
    WHERE r."batchId" = ${batchId} AND r.result = 'CONFLICT'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(r.normalized->'changes', '[]'::jsonb)) c
        WHERE c->>'action' = 'CONFLICT' AND NOT (COALESCE(r.decisions, '{}'::jsonb) ? (c->>'field'))
      )`;
  return Number(r?.n ?? 0);
}

// ───────────────────────── 5. Uygulama ─────────────────────────

export async function applyImport(user: Principal, batchId: string) {
  const b = await loadBatch(batchId);
  if (b.purpose === "COMPARE") throw new ImportError("COMPARE_ONLY");
  // APPLYING: büyük dosyada işçi tarafından devralınmış iş
  if (b.status !== "PREVIEWED" && b.status !== "APPLYING") throw new ImportError("BAD_STATUS");
  if ((await pendingDecisionCount(batchId)) > 0) throw new ImportError("DECISIONS_PENDING");

  const owners = new Map(
    (await db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]),
  );
  const now = new Date();
  const source = `import:${b.id}`;
  const stats = { created: 0, updated: 0, review: 0, phonesAdded: 0, consents: 0 };

  // 1) Yeni misafirler: toplu yazım (1.000'lik gruplar, kimlik sırasıyla sayfalanarak — bellekte tüm dosya tutulmaz)
  let cursor: bigint | undefined;
  for (;;) {
    const part = await db.importRow.findMany({
      where: { batchId, result: "NEW", ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: 1000,
      select: { id: true, normalized: true },
    });
    if (!part.length) break;
    cursor = part[part.length - 1].id;
    const r = await db.$transaction(
      (tx) => createGuestsBatch(tx, part.map((x) => ({ id: x.id, s: x.normalized as unknown as StoredRow })), { actorId: user.id, source, owners, label: "İçe aktarma: " + b.fileName, refId: b.id }),
      { timeout: 120_000, maxWait: 30_000 },
    );
    stats.created += r.created;
    stats.consents += r.consents;
  }

  // 2) Eşleşen, çakışan ve incelemeye düşen satırlar: alan bazında kararlar uygulanır, yazım sayfa başına toplu
  let mcursor: bigint | undefined;
  for (;;) {
    const part = await db.importRow.findMany({
      where: { batchId, result: { in: ["MATCHED", "CONFLICT", "POSSIBLE", "MULTI_MATCH"] }, ...(mcursor ? { id: { gt: mcursor } } : {}) },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, rowNo: true, result: true, guestId: true, normalized: true, decisions: true },
    });
    if (!part.length) break;
    mcursor = part[part.length - 1].id;
    const r = await db.$transaction(
      (tx) => applyMatchedBatch(tx, part, { actorId: user.id, source, batchId: b.id, now }),
      { timeout: 120_000, maxWait: 30_000 },
    );
    for (const k of Object.keys(r) as (keyof typeof r)[]) stats[k] += r[k];
  }

  const summary = { ...((b.summary as object) ?? {}), applied: stats, job: null, jobError: null };
  await db.importBatch.update({ where: { id: b.id }, data: { status: "APPLIED", appliedAt: now, summary } });
  await audit({ actorId: user.id, action: "import.apply", entity: "ImportBatch", entityId: b.id, diff: stats });
  return stats;
}

/**
 * Eşleşen/çakışan/incelemeye düşen satırların toplu uygulanması. Satır satır uygulamayla aynı sonucu üretir:
 * yalnız USE_NEW (veya boş alanı doldurma) kararlı alanlar yazılır, REVIEW kararı ve izin çakışması inceleme kaydı açar,
 * aynı misafire aynı sayfada iki satır düşerse sonraki satır öncekinin üzerine uygulanır.
 */
async function applyMatchedBatch(
  tx: Prisma.TransactionClient,
  rows: { id: bigint; rowNo: number; result: string | null; guestId: string | null; normalized: Prisma.JsonValue; decisions: Prisma.JsonValue }[],
  ctx: { actorId: string; source: string; batchId: string; now: Date },
) {
  const { actorId, source, batchId, now } = ctx;
  const stats = { created: 0, updated: 0, review: 0, phonesAdded: 0, consents: 0 };
  const reviews: Prisma.ReviewItemCreateManyInput[] = [];
  const histories: Prisma.FieldHistoryCreateManyInput[] = [];
  const phones: Prisma.GuestPhoneCreateManyInput[] = [];
  const consentHist: Prisma.ConsentHistoryCreateManyInput[] = [];
  const consentUpserts = new Map<string, { id: string; gid: string; ch: string; st: string; src: string | null; proof: string | null; ga: string | null; da: string | null }>();
  const applied: { id: bigint; json: string }[] = [];
  const guestSets = new Map<string, Record<string, string>>();

  const gids = [...new Set(rows.filter((r) => r.guestId && (r.result === "MATCHED" || r.result === "CONFLICT")).map((r) => r.guestId!))];
  const fsById = new Map(
    (await tx.guest.findMany({ where: { id: { in: gids } }, select: { id: true, fieldSources: true } })).map((g) => [g.id, { ...((g.fieldSources as Record<string, unknown>) ?? {}) }]),
  );
  const newId = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  for (const row of rows) {
    const s = row.normalized as unknown as StoredRow;
    if (row.result === "POSSIBLE" || row.result === "MULTI_MATCH") {
      reviews.push({
        kind: row.result === "POSSIBLE" ? "POSSIBLE_DUPLICATE" : "MULTI_MATCH",
        candidates: s.match?.candidateIds ?? [],
        payload: { rowNo: row.rowNo, incoming: { ...s.fields, phones: s.phones.map((p) => p.masked).filter((m): m is string => !!m) }, reason: s.match?.reason ?? null } as Prisma.InputJsonValue,
        sourceRef: source,
      });
      stats.review++;
      applied.push({ id: row.id, json: JSON.stringify({ review: true }) });
      continue;
    }

    const guestId = row.guestId!;
    const decisions = (row.decisions as Record<string, Decision> | null) ?? {};
    const fieldSources = fsById.get(guestId);
    if (!fieldSources) throw new ImportError("GUEST_NOT_FOUND", guestId);
    const set = guestSets.get(guestId) ?? {};
    const changedFields: { field: string; old: string | null; new: string }[] = [];
    for (const c of s.changes ?? []) {
      const d = c.action === "FILL" ? "USE_NEW" : decisions[c.field];
      if (d === "USE_NEW") {
        set[c.field] = c.new;
        fieldSources[c.field] = { source, at: now.toISOString() };
        changedFields.push({ field: c.field, old: c.old, new: c.new });
        histories.push({ guestId, field: c.field, oldValue: c.old, newValue: c.new, importBatchId: batchId, sourceId: source, actorId });
      } else if (d === "REVIEW") {
        reviews.push({ kind: "FIELD_CONFLICT", guestId, candidates: [guestId], payload: { field: c.field, current: c.old, incoming: c.new, rowNo: row.rowNo }, sourceRef: source });
        stats.review++;
      }
    }
    if (changedFields.length) {
      guestSets.set(guestId, set);
      stats.updated++;
    }
    const phonesAdded: string[] = [];
    for (const idx of s.addPhones ?? []) {
      const p = s.phones[idx];
      if (!p?.ok || !p.e164Enc) continue;
      const id = newId("p");
      phones.push({ id, guestId, e164Enc: p.e164Enc, phoneHash: p.hash!, masked: p.masked!, country: p.country, lineType: p.lineType, isPrimary: false, formatStatus: p.countryMismatch ? "COUNTRY_MISMATCH" : "VALID", lastCheckedAt: now });
      histories.push({ guestId, field: "phone", oldValue: null, newValue: p.masked ?? null, importBatchId: batchId, sourceId: source, actorId });
      phonesAdded.push(id);
      stats.phonesAdded++;
    }
    const consentsApplied: { channel: string; from: string | null; to: string }[] = [];
    for (const cp of s.consentPlan ?? []) {
      if (cp.action === "CONFLICT") {
        reviews.push({ kind: "CONSENT_CONFLICT", guestId, candidates: [guestId], payload: { channel: cp.channel, current: cp.from, incoming: cp.to, rowNo: row.rowNo }, sourceRef: source });
        stats.review++;
        continue;
      }
      consentUpserts.set(`${guestId}:${cp.channel}`, {
        id: newId("c"), gid: guestId, ch: cp.channel, st: cp.to, src: s.consentSource ?? null, proof: s.consentProofRef ?? null,
        ga: cp.to === "GRANTED" ? new Date(s.consentDate!).toISOString() : null, da: cp.to === "DENIED" ? now.toISOString() : null,
      });
      consentHist.push({ guestId, channel: cp.channel, oldStatus: cp.from, newStatus: cp.to, source, actorId });
      consentsApplied.push({ channel: cp.channel, from: cp.from, to: cp.to });
      stats.consents++;
    }
    applied.push({ id: row.id, json: JSON.stringify({ guestId, fields: changedFields, phonesAdded, consents: consentsApplied }) });
  }

  if (guestSets.size) {
    const ids = [...guestSets.keys()];
    await tx.$executeRaw`
      UPDATE public."Guest" AS g SET
        "firstName" = COALESCE(v.d->>'firstName', g."firstName"),
        "lastName"  = COALESCE(v.d->>'lastName', g."lastName"),
        "language"  = COALESCE(v.d->>'language', g."language"),
        "country"   = COALESCE(v.d->>'country', g."country"),
        "city"      = COALESCE(v.d->>'city', g."city"),
        "birthYear" = COALESCE((v.d->>'birthYear')::int, g."birthYear"),
        "vipLevel"  = COALESCE(v.d->>'vipLevel', g."vipLevel"),
        "fieldSources" = v.fs,
        "updatedAt" = now()
      FROM unnest(${ids}::text[], ${ids.map((id) => JSON.stringify(guestSets.get(id)))}::text[]::jsonb[], ${ids.map((id) => JSON.stringify(fsById.get(id)))}::text[]::jsonb[]) AS v(id, d, fs)
      WHERE g.id = v.id`;
  }
  if (histories.length) await tx.fieldHistory.createMany({ data: histories });
  if (reviews.length) await tx.reviewItem.createMany({ data: reviews });
  if (phones.length) await tx.guestPhone.createMany({ data: phones });
  if (consentUpserts.size) {
    const c = [...consentUpserts.values()];
    await tx.$executeRaw`
      INSERT INTO public."ConsentRecord" (id, "guestId", channel, status, source, "sourceSystem", "proofRef", "updatedBy", "grantedAt", "deniedAt", "updatedAt")
      SELECT v.id, v.gid, v.ch::public."ConsentChannel", v.st::public."ConsentStatus", v.src, ${source}, v.proof, ${actorId}, v.ga::timestamp, v.da::timestamp, now()
      FROM unnest(${c.map((x) => x.id)}::text[], ${c.map((x) => x.gid)}::text[], ${c.map((x) => x.ch)}::text[], ${c.map((x) => x.st)}::text[],
                  ${c.map((x) => x.src)}::text[], ${c.map((x) => x.proof)}::text[], ${c.map((x) => x.ga)}::text[], ${c.map((x) => x.da)}::text[])
           AS v(id, gid, ch, st, src, proof, ga, da)
      ON CONFLICT ("guestId", channel) DO UPDATE SET
        status = EXCLUDED.status, source = EXCLUDED.source, "sourceSystem" = EXCLUDED."sourceSystem", "proofRef" = EXCLUDED."proofRef",
        "updatedBy" = EXCLUDED."updatedBy",
        "grantedAt" = CASE WHEN EXCLUDED.status = 'GRANTED' THEN EXCLUDED."grantedAt" ELSE "ConsentRecord"."grantedAt" END,
        "deniedAt"  = CASE WHEN EXCLUDED.status = 'GRANTED' THEN "ConsentRecord"."deniedAt" ELSE EXCLUDED."deniedAt" END,
        "updatedAt" = now()`;
  }
  if (consentHist.length) await tx.consentHistory.createMany({ data: consentHist });
  if (applied.length) {
    await tx.$executeRaw`
      UPDATE public."ImportRow" AS r SET applied = v.a
      FROM unnest(${applied.map((a) => a.id)}::bigint[], ${applied.map((a) => a.json)}::text[]::jsonb[]) AS v(id, a)
      WHERE r.id = v.id`;
  }
  return stats;
}

/**
 * Toplu yeni misafir oluşturma (performans: 500k satır hedefi). createGuestFromRow ile aynı verileri üretir,
 * ancak her tabloya tek `createMany` ile yazar; kimlikler önceden üretilir. İçe aktarma satırları tek SQL ile güncellenir.
 */
async function createGuestsBatch(
  tx: Prisma.TransactionClient,
  rows: { id: bigint; s: StoredRow }[],
  ctx: { actorId: string; source: string; owners: Map<string, string>; label: string; refId: string },
) {
  const now = new Date();
  const guests: Prisma.GuestCreateManyInput[] = [];
  const phones: Prisma.GuestPhoneCreateManyInput[] = [];
  const emails: Prisma.GuestEmailCreateManyInput[] = [];
  const exts: Prisma.GuestExternalIdCreateManyInput[] = [];
  const notes: Prisma.GuestNoteCreateManyInput[] = [];
  const consents: Prisma.ConsentRecordCreateManyInput[] = [];
  const histories: Prisma.ConsentHistoryCreateManyInput[] = [];
  const interactions: Prisma.InteractionCreateManyInput[] = [];
  const applied: { id: bigint; guestId: string }[] = [];
  let consentCount = 0;
  for (const { id, s } of rows) {
    const gid = `g${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    guests.push({
      id: gid,
      firstName: s.fields.firstName ?? "",
      lastName: s.fields.lastName ?? "",
      language: s.fields.language ?? "tr",
      country: s.fields.country,
      city: s.fields.city,
      birthYear: s.fields.birthYear ? Number(s.fields.birthYear) : undefined,
      vipLevel: s.fields.vipLevel,
      tags: s.tags ?? [],
      ownerId: s.ownerAgent ? ctx.owners.get(s.ownerAgent) : undefined,
      fieldSources: Object.fromEntries(Object.keys(s.fields).map((f) => [f, { source: ctx.source, at: now.toISOString() }])),
    });
    s.phones.filter((p) => p.ok && p.e164Enc).forEach((p, idx) =>
      phones.push({ guestId: gid, e164Enc: p.e164Enc!, phoneHash: p.hash!, masked: p.masked!, country: p.country, lineType: p.lineType, isPrimary: idx === 0, formatStatus: p.countryMismatch ? "COUNTRY_MISMATCH" : "VALID", lastCheckedAt: now }),
    );
    if (s.email) emails.push({ guestId: gid, emailEnc: s.email.enc, emailHash: s.email.hash, masked: s.email.masked, isPrimary: true });
    if (s.externalId && s.externalSource) exts.push({ guestId: gid, source: s.externalSource, value: s.externalId });
    if (s.notesEnc) notes.push({ guestId: gid, bodyEnc: s.notesEnc, authorId: ctx.actorId });
    for (const [ch, st] of Object.entries(s.consent)) {
      if (!st || st === "UNKNOWN") continue;
      consents.push({
        guestId: gid, channel: ch as "CALL", status: st, source: s.consentSource, sourceSystem: ctx.source, proofRef: s.consentProofRef,
        grantedAt: st === "GRANTED" ? new Date(s.consentDate!) : null, deniedAt: st === "DENIED" ? (s.consentDate ? new Date(s.consentDate) : now) : null, updatedBy: ctx.actorId,
      });
      histories.push({ guestId: gid, channel: ch, oldStatus: null, newStatus: st, source: ctx.source, actorId: ctx.actorId });
      consentCount++;
    }
    interactions.push({ guestId: gid, channel: "IMPORT", summary: ctx.label, actorId: ctx.actorId, refId: ctx.refId });
    applied.push({ id, guestId: gid });
  }
  await tx.guest.createMany({ data: guests });
  if (phones.length) await tx.guestPhone.createMany({ data: phones });
  if (emails.length) await tx.guestEmail.createMany({ data: emails });
  if (exts.length) await tx.guestExternalId.createMany({ data: exts });
  if (notes.length) await tx.guestNote.createMany({ data: notes });
  if (consents.length) await tx.consentRecord.createMany({ data: consents });
  if (histories.length) await tx.consentHistory.createMany({ data: histories });
  await tx.interaction.createMany({ data: interactions });
  // İçe aktarma satırları: tek sorguda guestId + applied
  await tx.$executeRaw`
    UPDATE public."ImportRow" AS r
    SET "guestId" = v.gid, applied = jsonb_build_object('createdGuestId', v.gid)
    FROM unnest(${applied.map((a) => a.id)}::bigint[], ${applied.map((a) => a.guestId)}::text[]) AS v(id, gid)
    WHERE r.id = v.id`;
  return { created: guests.length, consents: consentCount };
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
