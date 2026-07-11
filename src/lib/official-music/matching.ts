import type { OfficialMusicCandidate } from "@/lib/official-music/types";

export type OfficialDateFact = {
  normalized: string;
  year: number;
  month: number | null;
  day: number | null;
  precision: "year" | "month" | "day";
};

function validDateParts(year: number, month: number | null, day: number | null) {
  if (!Number.isInteger(year) || year < 1000 || year > 2999) return false;
  if (month === null) return day === null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (day === null) return true;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateFact(year: number, month: number | null, day: number | null): OfficialDateFact | null {
  if (!validDateParts(year, month, day)) return null;
  const normalized = day !== null
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : month !== null
      ? `${year}-${String(month).padStart(2, "0")}`
      : String(year);
  return {
    normalized,
    year,
    month,
    day,
    precision: day !== null ? "day" : month !== null ? "month" : "year",
  };
}

export function parseOfficialDate(value: string | null | undefined) {
  const match = value?.normalize("NFKC").trim().match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (!match) return null;
  return dateFact(
    Number(match[1]),
    match[2] ? Number(match[2]) : null,
    match[3] ? Number(match[3]) : null,
  );
}

export function extractOfficialDates(facts: readonly string[]) {
  const dates = new Map<string, OfficialDateFact>();
  const add = (value: OfficialDateFact | null) => {
    if (value) dates.set(value.normalized, value);
  };

  for (const fact of facts) {
    const normalized = fact.normalize("NFKC");
    for (const match of normalized.matchAll(/(?:^|[^\p{L}\p{N}\-/.])(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?!\d)/gu)) {
      add(dateFact(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null));
    }
    for (const match of normalized.matchAll(/(?<!\d)(\d{4})年\s*(\d{1,2})月(?:\s*(\d{1,2})日)?/g)) {
      add(dateFact(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null));
    }
    const mayContainStandaloneYear =
      !/(?:copyright|all rights reserved|©|&copy;)/i.test(normalized) &&
      (
        /^[\s([（【]*\d{4}[\s)\]）】]*$/u.test(normalized) ||
        /(?:release(?:d|\s*date)?|date|issued|発売|発行|発表|リリース|年度|年)/iu.test(normalized)
      );
    if (mayContainStandaloneYear) {
      for (const match of normalized.matchAll(/(?:^|[^\p{L}\p{N}\-/.])(\d{4})(?!\d|[-/.年]\s*\d)/gu)) {
        add(dateFact(Number(match[1]), null, null));
      }
    }
  }
  return [...dates.values()];
}

function datesCompatible(candidate: OfficialDateFact, observed: OfficialDateFact) {
  if (candidate.year !== observed.year) return false;
  if (candidate.month !== null && observed.month !== null && candidate.month !== observed.month) return false;
  return !(candidate.day !== null && observed.day !== null && candidate.day !== observed.day);
}

function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}\p{S}]/gu, "");
}

function titleVariants(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const segments = normalized.split(/\s+(?:=|\/|\||｜|／)\s+/u);
  return [...new Set([normalized, ...segments].map((item) => item.trim()).filter(Boolean))];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titlePattern(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("und").trim();
  const pieces: string[] = [];
  let separatorPending = false;
  for (const char of normalized) {
    if (/[\p{P}\p{Z}\p{Cf}\p{S}]/u.test(char)) {
      separatorPending = pieces.length > 0;
      continue;
    }
    if (separatorPending) pieces.push("[\\p{P}\\p{Z}\\p{Cf}\\p{S}]*");
    pieces.push(escapeRegex(char));
    separatorPending = false;
  }
  if (pieces.length === 0) return null;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${pieces.join("")}(?=$|[^\\p{L}\\p{N}])`, "iu");
}

function containsControlledTitle(facts: readonly string[], title: string) {
  for (const variant of titleVariants(title)) {
    const expected = normalizeTitle(variant);
    if (!expected) continue;
    const pattern = titlePattern(variant);
    for (const fact of facts) {
      const factVariants = titleVariants(fact);
      if (factVariants.some((value) => normalizeTitle(value) === expected)) return true;
      if (pattern?.test(fact.normalize("NFKC").toLocaleLowerCase("und"))) return true;
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(variant) && expected.length >= 2) {
        if (normalizeTitle(fact).includes(expected)) return true;
      }
    }
  }
  return false;
}

export function normalizeOfficialCatalogNumber(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function catalogPattern(value: string) {
  const chars = value.normalize("NFKC").toUpperCase().match(/[\p{L}\p{N}]/gu) ?? [];
  if (chars.length < 3 || !chars.some((char) => /\p{N}/u.test(char))) return null;
  return new RegExp(
    `(?<![A-Z0-9])${chars.map(escapeRegex).join("[\\p{P}\\p{Z}\\p{S}]*")}(?![A-Z0-9])`,
    "iu",
  );
}

function containsCatalogNumber(facts: readonly string[], catalogNumber: string) {
  const pattern = catalogPattern(catalogNumber);
  return Boolean(pattern && facts.some((fact) => pattern.test(fact.normalize("NFKC").toUpperCase())));
}

export function validOfficialCandidate(candidate: OfficialMusicCandidate) {
  return Boolean(
    candidate.id.normalize("NFKC").trim() &&
    candidate.id.length <= 200 &&
    candidate.title.normalize("NFKC").trim() &&
    candidate.title.length <= 1_000 &&
    normalizeOfficialCatalogNumber(candidate.catalogNumber).length >= 3 &&
    /\p{N}/u.test(normalizeOfficialCatalogNumber(candidate.catalogNumber)) &&
    parseOfficialDate(candidate.date),
  );
}

export function matchOfficialPage(
  candidate: OfficialMusicCandidate,
  facts: readonly string[],
) {
  if (!validOfficialCandidate(candidate)) return null;
  if (!containsCatalogNumber(facts, candidate.catalogNumber as string)) return null;
  if (!containsControlledTitle(facts, candidate.title)) return null;

  const candidateDate = parseOfficialDate(candidate.date)!;
  const rank = { year: 1, month: 2, day: 3 } as const;
  const sameYear = extractOfficialDates(facts).filter((value) => value.year === candidateDate.year);
  const highestObservedPrecision = sameYear.reduce(
    (highest, value) => Math.max(highest, rank[value.precision]),
    0,
  );
  const observed = sameYear
    .filter((value) => rank[value.precision] === highestObservedPrecision)
    .filter((value) => datesCompatible(candidateDate, value))
    .sort((left, right) => left.normalized.localeCompare(right.normalized))[0];
  if (!observed) return null;
  const commonPrecision = rank[candidateDate.precision] <= rank[observed.precision]
    ? candidateDate.precision
    : observed.precision;
  return { observed, commonPrecision };
}

const catalogHints = [
  "discography",
  "music",
  "musics",
  "release",
  "album",
  "single",
  "ディスコグラフィ",
  "作品",
];

export function hasOfficialCatalogHint(value: string) {
  let normalized: string;
  try {
    normalized = decodeURIComponent(value).normalize("NFKC").toLocaleLowerCase("und");
  } catch {
    normalized = value.normalize("NFKC").toLocaleLowerCase("und");
  }
  return catalogHints.some((hint) => normalized.includes(hint));
}

export function hasOfficialPaginationHint(url: URL, anchorText: string, rel: string) {
  if (rel.split(/\s+/).includes("next")) return true;
  const anchor = anchorText.normalize("NFKC").trim().toLocaleLowerCase("und");
  if (/^(?:next|older|more|次|次へ|次のページ|続き|>|»|\d{1,4})$/u.test(anchor)) return true;
  return /(?:^|[?&])(?:page|paged|p)=\d{1,4}(?:&|$)/i.test(url.search) ||
    /\/page\/\d{1,4}\/?$/i.test(url.pathname);
}
