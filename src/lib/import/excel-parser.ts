import * as XLSX from "xlsx";
import type { ReleaseCategory, ReleaseFormat } from "@prisma/client";
import type { ParsedReleaseRow } from "@/lib/import/import-types";
import { clampCollectionPriority, type EditableCollectionStatus } from "@/lib/releases/release-types";

const ignoredSheets = new Set(["总览", "收藏口径", "术语与排除项", "选项"]);

const headerAliases = {
  type: ["分类", "类型"],
  title: ["标题"],
  releaseDate: ["原版发行日", "发行日", "原版CD发行日", "原版 CD 发行日"],
  format: ["格式"],
  catalogNo: ["原版品番", "品番", "应找原版 CD 品番", "原版CD品番", "原版 CD 品番"],
  label: ["厂牌"],
  isReissue: ["是否再版"],
  notes: ["备注"],
  coverImageUrl: ["封面图"],
  sourceUrl: ["来源 URL", "来源URL", "来源 url", "Source URL"],
  priority: ["优先级", "优先度"],
  status: ["收集状态", "收藏状态"],
  included: ["是否纳入"],
} satisfies Record<string, string[]>;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
}

function findValue(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row);
  const found = entries.find(([header]) =>
    aliases.some((alias) => normalizeHeader(header).toLowerCase() === alias.toLowerCase()),
  );

  return found ? found[1] : undefined;
}

export function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  const text = cellText(value);
  if (!text) {
    return null;
  }

  const normalized = text
    .replace(/[.]/g, "-")
    .replace(/年|月/g, "-")
    .replace(/日/g, "")
    .replace(/\//g, "-")
    .trim();
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function isoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function parseBooleanValue(value: unknown, defaultValue = false) {
  const text = cellText(value).toLowerCase();
  if (!text) {
    return defaultValue;
  }

  if (["是", "true", "yes", "y", "1", "再版"].includes(text)) {
    return true;
  }

  if (["否", "false", "no", "n", "0", "原版"].includes(text)) {
    return false;
  }

  return defaultValue;
}

function parseIncluded(value: unknown) {
  const text = cellText(value).toLowerCase();
  if (!text) {
    return true;
  }

  return !["否", "false", "no", "n", "0", "排除"].includes(text);
}

function parseStatus(value: unknown, included: boolean): EditableCollectionStatus {
  if (!included) {
    return "EXCLUDED";
  }

  const text = cellText(value).toLowerCase();

  if (["已拥有", "拥有", "owned", "have"].includes(text)) {
    return "OWNED";
  }

  if (["未拥有", "skip", "跳过"].includes(text)) {
    return "NOT_OWNED";
  }

  if (["想买", "want", "wishlist"].includes(text)) {
    return "WANTED";
  }

  if (["排除", "excluded"].includes(text)) {
    return "EXCLUDED";
  }

  return "NOT_OWNED";
}

function parseFormat(value: unknown): ReleaseFormat {
  const text = cellText(value).toUpperCase().replace(/\s+/g, "_").replace("+", "_");

  if (text.includes("SHM")) return "SHM_CD";
  if (text.includes("BLU")) return "BLU_SPEC_CD";
  if (text.includes("HYBRID") || text.includes("SACD")) return "HYBRID_SACD";
  if (text.includes("DVD")) return "CD_DVD";
  if (text.includes("BOX")) return "BOX_SET";
  if (text.includes("CD") || !text) return "CD";

  return "OTHER";
}

function parsePriority(value: unknown) {
  const text = cellText(value);
  if (["必收", "最高", "high"].includes(text.toLowerCase())) {
    return 1;
  }

  if (["候补", "低", "low"].includes(text.toLowerCase())) {
    return 5;
  }

  const priority = Number.parseInt(text, 10);
  return Number.isFinite(priority) ? clampCollectionPriority(priority) : 3;
}

function inferCategory(sheetName: string, typeValue: unknown): ReleaseCategory {
  if (sheetName.includes("A_原创专辑原版CD")) {
    return "ORIGINAL_ALBUM";
  }

  if (sheetName.includes("B_单曲原版CD")) {
    return "SINGLE";
  }

  const type = cellText(typeValue);

  if (/Best|ベスト|精选/i.test(type)) {
    return "BEST";
  }

  if (/COLLECTION|Collection|合集/i.test(type)) {
    return "COLLECTION";
  }

  if (/Live|ライブ|现场/i.test(type)) {
    return "LIVE";
  }

  if (/Remix|リミックス|混音/i.test(type)) {
    return "REMIX";
  }

  return "OTHER";
}

function shouldImportSheet(sheetName: string) {
  if (ignoredSheets.has(sheetName)) {
    return false;
  }

  return sheetName.includes("A_原创专辑原版CD") ||
    sheetName.includes("B_单曲原版CD") ||
    sheetName.includes("C_精选现场混音");
}

function normalizeRawRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => normalizeHeader(key))
      .map(([key, value]) => [normalizeHeader(key), cellText(value)]),
  );
}

export function parseExcelBuffer(buffer: Buffer, fileName = "upload.xlsx"): ParsedReleaseRow[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });
  const rows: ParsedReleaseRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (!shouldImportSheet(sheetName)) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: true,
    });

    rawRows.forEach((row, index) => {
      const typeValue = findValue(row, headerAliases.type);
      const title = cellText(findValue(row, headerAliases.title));
      const releaseDate = parseDateValue(findValue(row, headerAliases.releaseDate));
      const catalogNo = cellText(findValue(row, headerAliases.catalogNo)) || null;
      const format = parseFormat(findValue(row, headerAliases.format));
      const included = parseIncluded(findValue(row, headerAliases.included));
      const status = parseStatus(findValue(row, headerAliases.status), included);
      const errors: string[] = [];

      if (!title) {
        errors.push("缺少标题");
      }

      rows.push({
        rowId: `${fileName}:${sheetName}:${index + 2}`,
        sheetName,
        rowNumber: index + 2,
        category: inferCategory(sheetName, typeValue),
        title,
        originalReleaseDate: isoDate(releaseDate),
        format,
        originalCatalogNo: catalogNo,
        label: cellText(findValue(row, headerAliases.label)) || null,
        isReissue: parseBooleanValue(findValue(row, headerAliases.isReissue), false),
        notes: cellText(findValue(row, headerAliases.notes)) || null,
        coverImageUrl: cellText(findValue(row, headerAliases.coverImageUrl)) || null,
        sourceUrl: cellText(findValue(row, headerAliases.sourceUrl)) || null,
        priority: parsePriority(findValue(row, headerAliases.priority)),
        status,
        included,
        duplicate: false,
        duplicateReleaseId: null,
        errors,
        raw: normalizeRawRow(row),
      });
    });
  }

  return rows;
}
