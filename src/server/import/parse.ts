import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS = 500_000;

export class ParseError extends Error {
  constructor(public code: "UNSUPPORTED_TYPE" | "MACRO" | "EMPTY" | "TOO_MANY_ROWS" | "TOO_LARGE" | "CORRUPT" | "NO_HEADER" | "ENCRYPTED", detail?: string) {
    super(detail ?? code);
  }
}

export interface ParsedSheet {
  sheets: string[];
  sheet: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Dosya türü uzantıya değil içeriğe göre de doğrulanır (docs/02 §1). */
export function detectKind(fileName: string, data: Buffer): "xlsx" | "csv" {
  if (data.length > MAX_FILE_BYTES) throw new ParseError("TOO_LARGE");
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "xlsm" || ext === "xls" || ext === "xlsb") throw new ParseError(ext === "xlsm" ? "MACRO" : "UNSUPPORTED_TYPE");
  const isZip = data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const isOle = data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (isOle) throw new ParseError("ENCRYPTED", "Şifreli veya eski biçimli Excel dosyası");
  if (ext === "xlsx") {
    if (!isZip) throw new ParseError("CORRUPT");
    if (data.includes(Buffer.from("vbaProject.bin"))) throw new ParseError("MACRO");
    if (data.includes(Buffer.from("externalLink"))) throw new ParseError("UNSUPPORTED_TYPE", "Harici bağlantı içeren dosya");
    return "xlsx";
  }
  if (ext === "csv" || ext === "txt") {
    if (isZip) throw new ParseError("UNSUPPORTED_TYPE");
    return "csv";
  }
  throw new ParseError("UNSUPPORTED_TYPE");
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlink
    if ("result" in v) return v.result ?? ""; // formül: yalnız sonuç, formül çalıştırılmaz
    if ("error" in v) return "";
  }
  return v;
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Sütun ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

export async function parseFile(fileName: string, data: Buffer, sheetName?: string | null): Promise<ParsedSheet> {
  const kind = detectKind(fileName, data);
  if (kind === "csv") {
    let text = data.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: "" });
    const [head, ...body] = res.data;
    if (!head?.length) throw new ParseError("NO_HEADER");
    if (body.length > MAX_ROWS) throw new ParseError("TOO_MANY_ROWS");
    const headers = uniqueHeaders(head.map(String));
    return {
      sheets: ["CSV"],
      sheet: "CSV",
      headers,
      rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
    };
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch (e) {
    throw new ParseError("CORRUPT", (e as Error).message);
  }
  const sheets = wb.worksheets.filter((w) => w.state === "visible").map((w) => w.name);
  if (!sheets.length) throw new ParseError("EMPTY");
  const ws = wb.getWorksheet(sheetName && sheets.includes(sheetName) ? sheetName : sheets[0])!;
  if (ws.actualRowCount - 1 > MAX_ROWS) throw new ParseError("TOO_MANY_ROWS");

  const headRow = ws.getRow(1);
  const rawHeaders: string[] = [];
  for (let c = 1; c <= ws.actualColumnCount; c++) rawHeaders.push(String(cellValue(headRow.getCell(c).value) ?? ""));
  if (!rawHeaders.some((h) => h.trim())) throw new ParseError("NO_HEADER");
  const headers = uniqueHeaders(rawHeaders);

  const rows: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const rec: Record<string, unknown> = {};
    let any = false;
    headers.forEach((h, i) => {
      const v = cellValue(row.getCell(i + 1).value);
      if (v !== "") any = true;
      rec[h] = v;
    });
    if (any) rows.push({ __row: n, ...rec });
  });
  return { sheets, sheet: ws.name, headers, rows };
}
