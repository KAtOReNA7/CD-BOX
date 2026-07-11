export type OfficialHtmlLink = {
  href: string;
  anchorText: string;
  rel: string;
};

export type OfficialHtmlFacts = {
  facts: string[];
  records: OfficialHtmlRecord[];
  links: OfficialHtmlLink[];
  linksTruncated: boolean;
  pageTitle: string | null;
};

export type OfficialHtmlRecord = {
  kind: "json-ld" | "page-metadata" | "product-block";
  facts: string[];
};

const relevantMetadataNames = new Set([
  "title",
  "name",
  "headline",
  "date",
  "datepublished",
  "releasedate",
  "release_date",
  "sku",
  "mpn",
  "productid",
  "catalognumber",
  "og:title",
  "twitter:title",
  "article:published_time",
  "music:release_date",
]);

function decodeEntity(entity: string) {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const code = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : `&${entity};`;
  }
  if (entity.startsWith("#")) {
    const code = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : `&${entity};`;
  }
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    raquo: "»",
    rdquo: "”",
    rsquo: "’",
  };
  return named[entity.toLowerCase()] ?? `&${entity};`;
}

export function decodeHtmlEntities(value: string) {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (_, entity: string) =>
    decodeEntity(entity));
}

function attribute(tag: string, name: string) {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function visibleLines(html: string) {
  const withoutExecutableOrHiddenBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<(?:style|noscript|template|svg|canvas|form|iframe|object)\b[^>]*>[\s\S]*?<\/(?:style|noscript|template|svg|canvas|form|iframe|object)\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeHtmlEntities(withoutExecutableOrHiddenBlocks)
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 10_000);
}

function navigationHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<(?:style|noscript|template|svg|canvas|form|iframe|object)\b[^>]*>[\s\S]*?<\/(?:style|noscript|template|svg|canvas|form|iframe|object)\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function directEntityFacts(value: Record<string, unknown>) {
  const facts: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (!relevantMetadataNames.has(key.toLowerCase())) continue;
    const stack: Array<{ value: unknown; depth: number }> = [{ value: nested, depth: 0 }];
    let inspected = 0;
    while (stack.length > 0 && inspected < 200 && facts.length < 500) {
      const current = stack.pop()!;
      inspected += 1;
      if (typeof current.value === "string") {
        if (current.value.length <= 4_000) facts.push(current.value.normalize("NFKC").trim());
        continue;
      }
      if (current.depth >= 2) continue;
      if (Array.isArray(current.value)) {
        current.value.slice(0, 100).forEach((item) =>
          stack.push({ value: item, depth: current.depth + 1 }));
      } else if (current.value && typeof current.value === "object") {
        Object.values(current.value as Record<string, unknown>).slice(0, 100).forEach((item) =>
          stack.push({ value: item, depth: current.depth + 1 }));
      }
    }
  }
  return facts.filter(Boolean);
}

function jsonLdRecords(html: string) {
  const records: OfficialHtmlRecord[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && records.length < 500) {
    if (attribute(match[1], "type").toLowerCase() !== "application/ld+json") continue;
    const raw = match[2].trim().replace(/^<!--|-->$/g, "");
    if (!raw || raw.length > 512_000) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const entities: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    let inspected = 0;
    while (entities.length > 0 && inspected < 2_000 && records.length < 500) {
      const entity = entities.pop();
      inspected += 1;
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) continue;
      const object = entity as Record<string, unknown>;
      const facts = directEntityFacts(object);
      if (facts.length > 0) records.push({ kind: "json-ld", facts });
      for (const [key, nested] of Object.entries(object)) {
        if (key === "@graph" || key === "itemListElement" || key === "hasPart") {
          if (Array.isArray(nested)) entities.push(...nested);
          else entities.push(nested);
        }
      }
    }
  }
  return records;
}

function metaFacts(html: string) {
  const facts: string[] = [];
  const pattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && facts.length < 1_000) {
    const tag = match[0];
    const name = (attribute(tag, "property") || attribute(tag, "name") || attribute(tag, "itemprop"))
      .toLowerCase();
    const content = attribute(tag, "content");
    if (content && content.length <= 4_000 && relevantMetadataNames.has(name)) facts.push(content);
  }
  return facts;
}

function uniqueFacts(values: string[]) {
  return values
    .map((value) => value.normalize("NFKC").trim())
    .filter((value, index, facts) => value && facts.indexOf(value) === index)
    .slice(0, 12_000);
}

function localProductRecords(html: string) {
  const safe = navigationHtml(html);
  type Block = { tag: string; start: number; end: number; openingTag: string };
  const blocks: Block[] = [];
  const stacks = new Map<string, Array<Omit<Block, "end">>>();
  const tagPattern = /<\/?\s*(article|li|tr|div|section)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(safe)) && blocks.length < 10_000) {
    const tag = match[1].toLowerCase();
    const raw = match[0];
    const closing = /^<\s*\//.test(raw);
    if (!closing && !/\/\s*>$/.test(raw)) {
      const stack = stacks.get(tag) ?? [];
      stack.push({ tag, start: match.index, openingTag: raw });
      stacks.set(tag, stack);
      continue;
    }
    if (!closing) continue;
    const opening = stacks.get(tag)?.pop();
    if (opening) blocks.push({ ...opening, end: tagPattern.lastIndex });
  }

  const isProductBlock = (block: Block) => {
    if (block.tag === "article" || block.tag === "li" || block.tag === "tr") return true;
    const itemType = attribute(block.openingTag, "itemtype");
    if (/(?:^|[/#])(?:Product|MusicAlbum|MusicRecording)(?:$|[/#])/i.test(itemType)) return true;
    const identifier = `${attribute(block.openingTag, "class")} ${attribute(block.openingTag, "id")}`;
    return /(?:^|\s)(?:product-item|release-item|album-item|single-item|goods-item|music-item)(?:\s|$)/i
      .test(identifier);
  };

  const productBlocks = blocks.filter(isProductBlock);
  // A page with more structural records than this cannot be associated safely
  // within the crawler's bounded-work guarantees. Fail closed for that page.
  if (blocks.length >= 10_000 || productBlocks.length > 2_000) return [];
  const candidates = productBlocks
    .filter((block) => !productBlocks.some((nested) =>
      nested !== block &&
      nested.start > block.start &&
      nested.end < block.end))
    .sort((left, right) => left.start - right.start)
    .slice(0, 2_000);

  const records: OfficialHtmlRecord[] = [];
  for (const candidate of candidates) {
    const block = safe.slice(candidate.start, candidate.end);
    if (block.length > 256_000) continue;
    const facts = uniqueFacts([
      ...metaFacts(block),
      ...visibleLines(block),
    ]);
    if (facts.length > 0) records.push({ kind: "product-block", facts });
  }

  return records.filter((record, index, values) => {
    const key = JSON.stringify(record.facts);
    return values.findIndex((candidate) => JSON.stringify(candidate.facts) === key) === index;
  });
}

function pageTitle(html: string) {
  const value = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const title = value ? stripTags(value) : "";
  return title ? title.slice(0, 500) : null;
}

function links(html: string, maximum: number) {
  const values: OfficialHtmlLink[] = [];
  let total = 0;
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    total += 1;
    if (values.length >= maximum) continue;
    const href = attribute(match[1], "href");
    if (!href || href.length > 2_048) continue;
    values.push({
      href,
      anchorText: stripTags(match[2]).slice(0, 500),
      rel: attribute(match[1], "rel").toLowerCase(),
    });
  }

  const linkPattern = /<link\b[^>]*>/gi;
  while ((match = linkPattern.exec(html))) {
    const rel = attribute(match[0], "rel").toLowerCase();
    if (!rel.split(/\s+/).includes("next")) continue;
    total += 1;
    if (values.length >= maximum) continue;
    const href = attribute(match[0], "href");
    if (!href || href.length > 2_048) continue;
    values.push({ href, anchorText: "next", rel });
  }
  return { values, truncated: total > maximum };
}

export function parseOfficialMusicHtml(html: string, maxLinksPerPage: number): OfficialHtmlFacts {
  const extractedLinks = links(navigationHtml(html), maxLinksPerPage);
  const title = pageTitle(html);
  const structuredRecords = jsonLdRecords(html);
  const metadataFacts = uniqueFacts([
    ...(title ? [title] : []),
    ...metaFacts(html),
  ]);
  const metadataRecord = metadataFacts.length > 0
    ? [{ kind: "page-metadata" as const, facts: metadataFacts }]
    : [];
  const records = [...structuredRecords, ...metadataRecord, ...localProductRecords(html)]
    .filter((record, index, values) => {
      const key = `${record.kind}:${JSON.stringify(record.facts)}`;
      return values.findIndex((candidate) =>
        `${candidate.kind}:${JSON.stringify(candidate.facts)}` === key) === index;
    });
  const facts = uniqueFacts([
    ...structuredRecords.flatMap((record) => record.facts),
    ...metadataFacts,
    ...visibleLines(html),
  ]);
  return {
    facts,
    records,
    links: extractedLinks.values,
    linksTruncated: extractedLinks.truncated,
    pageTitle: title,
  };
}
