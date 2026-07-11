import { NDL_SEARCH_ORIGIN } from "@/lib/ndl/constants";
import type {
  NdlDatePrecision,
  NdlIdentifier,
  NdlRecord,
  NdlSearchResponse,
} from "@/lib/ndl/types";

const MAX_XML_CHARACTERS = 8 * 1024 * 1024;
const MAX_RECORDS = 500;
const MAX_FIELD_LENGTH = 2_000;
const MAX_REPEATED_FIELDS = 100;
const predefinedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

export class NdlXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NdlXmlError";
  }
}

function validateEntityReferences(xml: string) {
  const outsideCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (let index = outsideCdata.indexOf("&"); index >= 0; index = outsideCdata.indexOf("&", index + 1)) {
    const reference = outsideCdata.slice(index).match(/^&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/i);
    if (!reference) throw new NdlXmlError("The XML response contained a malformed entity reference.");
    const name = reference[1]!;
    if (!name.startsWith("#") && predefinedEntities[name.toLowerCase()] === undefined) {
      throw new NdlXmlError("The XML response contained an unsupported entity.");
    }
    if (name.startsWith("#")) {
      const hexadecimal = name[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(hexadecimal ? name.slice(2) : name.slice(1), hexadecimal ? 16 : 10);
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) throw new NdlXmlError("The XML response contained an invalid character reference.");
    }
  }
}

function decodeXmlText(value: string) {
  if (value.includes("<![CDATA[")) {
    throw new NdlXmlError("CDATA is not allowed in bibliographic scalar fields.");
  }
  if (/[<>]/.test(value)) {
    throw new NdlXmlError("Nested markup is not allowed in bibliographic scalar fields.");
  }

  const decoded = value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,
    (entity, name: string) => {
      if (name.startsWith("#")) {
        const hexadecimal = name[1]?.toLowerCase() === "x";
        const digits = hexadecimal ? name.slice(2) : name.slice(1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (
          !Number.isSafeInteger(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          throw new NdlXmlError("The XML response contained an invalid character reference.");
        }
        return String.fromCodePoint(codePoint);
      }
      const replacement = predefinedEntities[name.toLowerCase()];
      if (replacement === undefined) {
        throw new NdlXmlError("The XML response contained an unsupported entity.");
      }
      return replacement;
    },
  );

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded)) {
    throw new NdlXmlError("The XML response contained a disallowed control character.");
  }
  const normalized = decoded.replace(/\s+/g, " ").trim();
  if (normalized.length > MAX_FIELD_LENGTH) {
    throw new NdlXmlError("A bibliographic scalar field exceeded its safety limit.");
  }
  return normalized;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scalarValues(block: string, tagName: string) {
  const escaped = escapeRegExp(tagName);
  const expression = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`,
    "gi",
  );
  const values: string[] = [];
  for (const match of block.matchAll(expression)) {
    values.push(decodeXmlText(match[1] ?? ""));
    if (values.length > MAX_REPEATED_FIELDS) {
      throw new NdlXmlError("A repeated bibliographic field exceeded its safety limit.");
    }
  }
  return values;
}

function parseAttribute(attributes: string, name: string) {
  const escaped = escapeRegExp(name);
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (!match) return null;
  return decodeXmlText(match[2] ?? "");
}

function identifierValues(block: string) {
  const values: NdlIdentifier[] = [];
  const expression = /<dc:identifier\b([^>]*)>([\s\S]*?)<\/dc:identifier\s*>/gi;
  for (const match of block.matchAll(expression)) {
    const value = decodeXmlText(match[2] ?? "");
    if (!value) continue;
    values.push({
      value,
      scheme: parseAttribute(match[1] ?? "", "xsi:type"),
    });
    if (values.length > MAX_REPEATED_FIELDS) {
      throw new NdlXmlError("The identifier list exceeded its safety limit.");
    }
  }
  return values;
}

function validCalendarDate(year: number, month: number, day: number) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseNdlIssuedDate(rawValue: string | null): {
  value: string;
  precision: NdlDatePrecision;
} | null {
  if (!rawValue) return null;
  const raw = rawValue.normalize("NFKC").trim().replace(/^\[|\]$/g, "");
  const match = raw.match(/^(\d{4})(?:[.\/-](\d{1,2}))?(?:[.\/-](\d{1,2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month === null) {
    if (year < 1 || year > 9999) return null;
    return { value: String(year).padStart(4, "0"), precision: "year" };
  }
  if (day === null) {
    if (!validCalendarDate(year, month, 1)) return null;
    return {
      value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
      precision: "month",
    };
  }
  if (!validCalendarDate(year, month, day)) return null;
  return {
    value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    precision: "day",
  };
}

function parseRecordSource(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NdlXmlError("An NDL record URL was invalid.");
  }
  if (
    url.origin !== NDL_SEARCH_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new NdlXmlError("An NDL record URL violated the fixed-origin policy.");
  }
  const recordId = url.pathname.match(/^\/books\/(R\d{9}-I[A-Za-z0-9._~-]+)\/?$/)?.[1];
  if (!recordId) throw new NdlXmlError("An NDL record URL did not contain a safe record identifier.");
  return { recordId, sourceUrl: `${NDL_SEARCH_ORIGIN}/books/${recordId}` };
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function parseRecord(block: string): NdlRecord {
  const title = scalarValues(block, "dc:title")[0] ?? scalarValues(block, "title")[0] ?? "";
  const source = scalarValues(block, "link")[0] ?? scalarValues(block, "guid")[0] ?? "";
  if (!title || !source) throw new NdlXmlError("An NDL record omitted its required title or URL.");
  const parsedSource = parseRecordSource(source);
  const creators = uniqueNonEmpty([
    ...scalarValues(block, "dc:creator"),
    ...scalarValues(block, "author"),
  ]);
  const publishers = uniqueNonEmpty(scalarValues(block, "dc:publisher"));
  const issuedRaw = scalarValues(block, "dcterms:issued")[0] ?? scalarValues(block, "dc:date")[0] ?? null;
  const issued = parseNdlIssuedDate(issuedRaw);
  const identifierDetails = identifierValues(block);
  const identifiers = uniqueNonEmpty(identifierDetails.map((item) => item.value));
  const catalogNumbers = uniqueNonEmpty(identifierDetails
    .filter((item) => item.scheme?.toLowerCase() === "dcndl:ris502")
    .map((item) => item.value));
  return {
    ...parsedSource,
    title,
    creators,
    publishers,
    issued: issued?.value ?? null,
    issuedRaw,
    issuedPrecision: issued?.precision ?? null,
    identifiers,
    identifierDetails,
    catalogNumbers,
  };
}

export function parseNdlOpenSearchXml(xml: string, queryUrl: string): NdlSearchResponse {
  if (xml.length === 0 || xml.length > MAX_XML_CHARACTERS) {
    throw new NdlXmlError("The XML response was empty or exceeded its parser safety limit.");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new NdlXmlError("DTD and entity declarations are forbidden in NDL responses.");
  }
  validateEntityReferences(xml);
  const withoutDeclaration = xml.replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/i, "");
  if (!/^<rss\b/i.test(withoutDeclaration) || !/<channel\b/i.test(withoutDeclaration)) {
    throw new NdlXmlError("The response was not an NDL OpenSearch RSS document.");
  }

  const totalRaw = scalarValues(xml, "openSearch:totalResults")[0];
  if (!totalRaw || !/^\d{1,9}$/.test(totalRaw)) {
    throw new NdlXmlError("The response omitted a valid OpenSearch result count.");
  }
  const sourceTotal = Number(totalRaw);
  const itemBlocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi) ?? [];
  if (itemBlocks.length > MAX_RECORDS) {
    throw new NdlXmlError("The response exceeded the 500-record safety limit.");
  }
  const records = itemBlocks.map(parseRecord);
  if (new Set(records.map((record) => record.recordId)).size !== records.length) {
    throw new NdlXmlError("The response contained duplicate NDL record identifiers.");
  }
  if (sourceTotal < records.length) {
    throw new NdlXmlError("The response record count exceeded its declared total.");
  }
  return {
    queryUrl,
    sourceTotal,
    records,
    complete: sourceTotal <= records.length,
  };
}
