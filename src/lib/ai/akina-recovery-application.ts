import "server-only";

import {
  addComprehensiveObservation,
  type ComprehensiveDiscographyCandidate,
} from "@/lib/ai/comprehensive-discography";
import {
  normalizedCuratedWorkTitle,
  type CuratedArtistDiscography,
  type CuratedDiscographyWork,
} from "@/lib/official-music";
import {
  AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS,
  type AkinaNakamoriOfficialCarrierEvidence,
  type AkinaNakamoriOfficialCoverEvidence,
  type AkinaNakamoriOfficialRecoveryKey,
  type AkinaNakamoriOfficialRecoveryResult,
  type AkinaNakamoriOfficialWorkCoverEvidence,
} from "@/lib/official-music/akina-nakamori";

const MANIFEST_PROVIDER = "curated-official-manifest:akina-nakamori";

function normalizedCatalog(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleUpperCase("en")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function auditedCoverMatchesSpec(
  cover: AkinaNakamoriOfficialCoverEvidence,
  spec: typeof AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[AkinaNakamoriOfficialRecoveryKey],
) {
  return cover.auditedAsset.mime === spec.auditedAsset.mime &&
    cover.auditedAsset.width === spec.auditedAsset.width &&
    cover.auditedAsset.height === spec.auditedAsset.height &&
    cover.auditedAsset.sha256 === spec.auditedAsset.sha256 &&
    cover.auditedAsset.allowContentTypeMismatch ===
      spec.auditedAsset.allowContentTypeMismatch;
}

function manifestEntryKey(candidate: ComprehensiveDiscographyCandidate) {
  const keys = new Set(candidate.observations.filter((item) =>
    item.provider === MANIFEST_PROVIDER &&
    item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
    item.verdict === "PASS")
    .map((item) => item.facts?.manifestEntryKey)
    .filter((value): value is string => Boolean(value)));
  return keys.size === 1 ? [...keys][0]! : null;
}

function manifestWorkByKey(manifest: CuratedArtistDiscography, key: string) {
  const [category, rawOrdinal, ...extra] = key.split(":");
  const ordinal = Number(rawOrdinal);
  if (extra.length > 0 || !Number.isSafeInteger(ordinal) || ordinal <= 0) return null;
  const matches = manifest.works.filter((work) =>
    work.category === category && work.ordinal === ordinal);
  return matches.length === 1 ? matches[0]! : null;
}

function exactManifest(manifest: CuratedArtistDiscography) {
  return manifest.slug === "akina-nakamori" && manifest.canonicalName === "中森明菜" &&
    manifest.aliases.includes("Akina Nakamori") && manifest.country === "JP";
}

function exactCoverUrl(
  key: AkinaNakamoriOfficialRecoveryKey,
  value: string,
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    return false;
  }
  if (key === "SINGLE:55") {
    return url.hostname === "wmg.jp" &&
      url.pathname === "/packages/33269/images/tujyoban_jacket.jpg" && !url.search;
  }
  const catalog = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key].catalogNumber
    .toLocaleLowerCase("en");
  return url.hostname === "content-jp.umgi.net" &&
    url.pathname.toLocaleLowerCase("en").startsWith(
      `/products/${catalog.slice(0, 2)}/${catalog}_`,
    ) && /_extralarge\.jpe?g$/iu.test(url.pathname) &&
    (!url.search || /^\?\d{8,20}$/u.test(url.search));
}

function exactCarrier(
  manifest: CuratedArtistDiscography,
  carrier: AkinaNakamoriOfficialCarrierEvidence,
) {
  if (!exactManifest(manifest)) return null;
  const key = carrier.manifestEntryKey;
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
  const work = manifestWorkByKey(manifest, key);
  const media = work?.mediaScope;
  if (!work || !media ||
    work.category !== "SINGLE" ||
    work.title !== spec.canonicalTitle ||
    work.originalReleaseDate !== spec.releaseDate ||
    media.physicalCd !== "ORIGINAL_RELEASE" ||
    media.physicalCdRepresentationKind !== "SAME_WORK_EDITION" ||
    media.physicalCdReleaseDate !== spec.releaseDate ||
    normalizedCatalog(media.physicalCdCatalogNumber) !== normalizedCatalog(spec.catalogNumber) ||
    media.physicalCdAuthorityUrls.length !== 1 ||
    media.physicalCdAuthorityUrls[0] !== spec.sourceUrl ||
    carrier.provider !== spec.provider ||
    carrier.role !== "CORROBORATING" || carrier.strength !== "STRONG" ||
    carrier.scope !== "EDITION" || carrier.matchLevel !== "EDITION_EXACT" ||
    carrier.artist !== "中森明菜" || carrier.canonicalTitle !== spec.canonicalTitle ||
    carrier.observedTitle !== spec.observedTitle || carrier.category !== "SINGLE" ||
    carrier.country !== "JP" || carrier.format !== "CD" ||
    carrier.releaseDate !== spec.releaseDate ||
    normalizedCatalog(carrier.catalogNumber) !== normalizedCatalog(spec.catalogNumber) ||
    carrier.sourceUrl !== spec.sourceUrl ||
    carrier.cover.provider !== spec.provider || carrier.cover.scope !== "WORK" ||
    carrier.cover.matchLevel !== "WORK_EXACT" ||
    carrier.cover.sourceUrl !== spec.sourceUrl || !carrier.cover.requiresAssetValidation ||
    !exactCoverUrl(key, carrier.cover.url) ||
    !auditedCoverMatchesSpec(carrier.cover, spec)) return null;
  return work;
}

function exactWorkCover(
  manifest: CuratedArtistDiscography,
  evidence: AkinaNakamoriOfficialWorkCoverEvidence,
) {
  if (!exactManifest(manifest)) return null;
  const key = evidence.manifestEntryKey;
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
  const work = manifestWorkByKey(manifest, key);
  if (!work || work.title !== spec.canonicalTitle ||
    work.category !== "ORIGINAL_ALBUM" || work.originalReleaseDate !== "1993-09-22" ||
    evidence.artist !== "中森明菜" || evidence.canonicalTitle !== spec.canonicalTitle ||
    evidence.observedEditionTitle !== spec.observedTitle ||
    evidence.observedEditionDate !== spec.releaseDate ||
    normalizedCatalog(evidence.observedEditionCatalogNumber) !==
      normalizedCatalog(spec.catalogNumber) || evidence.sourceUrl !== spec.sourceUrl ||
    evidence.cover.provider !== spec.provider || evidence.cover.scope !== "WORK" ||
    evidence.cover.matchLevel !== "WORK_EXACT" ||
    evidence.cover.sourceUrl !== spec.sourceUrl || !evidence.cover.requiresAssetValidation ||
    !exactCoverUrl(key, evidence.cover.url) ||
    !auditedCoverMatchesSpec(evidence.cover, spec)) return null;
  return work;
}

type ExactRecovery = {
  key: AkinaNakamoriOfficialRecoveryKey;
  work: CuratedDiscographyWork;
  provider: "universal-music-japan" | "warner-music-japan";
  sourceUrl: string;
  canonicalTitle: string;
  observedTitle: string;
  observedDate: string;
  observedCatalog: string;
  cover: AkinaNakamoriOfficialCoverEvidence;
  carrier: AkinaNakamoriOfficialCarrierEvidence | null;
};

function exactRecoveries(
  manifest: CuratedArtistDiscography,
  recovery: AkinaNakamoriOfficialRecoveryResult,
) {
  const exact = new Map<AkinaNakamoriOfficialRecoveryKey, ExactRecovery>();
  for (const carrier of Object.values(recovery.carriers)) {
    if (!carrier) continue;
    const work = exactCarrier(manifest, carrier);
    if (!work) continue;
    exact.set(carrier.manifestEntryKey, {
      key: carrier.manifestEntryKey,
      work,
      provider: carrier.provider,
      sourceUrl: carrier.sourceUrl,
      canonicalTitle: carrier.canonicalTitle,
      observedTitle: carrier.observedTitle,
      observedDate: carrier.releaseDate,
      observedCatalog: carrier.catalogNumber,
      cover: carrier.cover,
      carrier,
    });
  }
  const album = recovery.workCovers["ORIGINAL_ALBUM:15"];
  const work = album ? exactWorkCover(manifest, album) : null;
  if (album && work) {
    exact.set(album.manifestEntryKey, {
      key: album.manifestEntryKey,
      work,
      provider: album.cover.provider,
      sourceUrl: album.sourceUrl,
      canonicalTitle: album.canonicalTitle,
      observedTitle: album.observedEditionTitle,
      observedDate: album.observedEditionDate,
      observedCatalog: album.observedEditionCatalogNumber,
      cover: album.cover,
      carrier: null,
    });
  }
  return exact;
}

function workObservation(
  candidate: ComprehensiveDiscographyCandidate,
  recovery: ExactRecovery,
) {
  return {
    id: `${recovery.provider}:akina-recovery-work:${recovery.key}:${candidate.candidate.id}`,
    provider: recovery.provider,
    role: "AUTHORITATIVE" as const,
    strength: "STRONG" as const,
    stage: "AUTHORITATIVE" as const,
    verdict: "PASS" as const,
    reasonCode: "AKINA_OFFICIAL_RECOVERY_WORK_VERIFIED",
    reason: "A fixed official label entity exactly identifies this Akina canonical work and artwork.",
    sourceUrl: recovery.sourceUrl,
    matchedFields: ["artist", "title", "category", "date", "catalogNumber", "format"],
    facts: {
      manifestEntryKey: recovery.key,
      artist: "中森明菜",
      canonicalArtist: "中森明菜",
      title: recovery.observedTitle,
      canonicalTitle: recovery.canonicalTitle,
      category: recovery.work.category,
      originalReleaseDate: recovery.work.originalReleaseDate,
      observedEditionDate: recovery.observedDate,
      observedEditionCatalogNumber: recovery.observedCatalog,
      uniqueOfficialEntity: "true",
    },
  };
}

function carrierObservation(
  candidate: ComprehensiveDiscographyCandidate,
  recovery: ExactRecovery & { carrier: AkinaNakamoriOfficialCarrierEvidence },
) {
  return {
    id: `${recovery.provider}:akina-recovery-carrier:${recovery.key}:${candidate.candidate.id}`,
    provider: recovery.provider,
    role: "CORROBORATING" as const,
    strength: "STRONG" as const,
    stage: "CORROBORATION" as const,
    verdict: "PASS" as const,
    reasonCode: "AKINA_OFFICIAL_RECOVERY_CD_CARRIER_MATCH",
    reason: "One fixed official-label product entity exactly matches the declared same-work Akina CD carrier.",
    sourceUrl: recovery.sourceUrl,
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: recovery.key,
      artist: recovery.carrier.artist,
      canonicalArtist: "中森明菜",
      carrierTitle: recovery.carrier.observedTitle,
      canonicalTitle: recovery.work.title,
      date: recovery.carrier.releaseDate,
      catalogNumber: recovery.carrier.catalogNumber,
      country: "JP",
      format: "CD",
      status: "Official",
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
    },
  };
}

export type AkinaRecoveryApplication = {
  candidates: ComprehensiveDiscographyCandidate[];
  coversByWorkId: ReadonlyMap<string, AkinaNakamoriOfficialCoverEvidence>;
  matchedWorks: number;
  matchedCarriers: number;
};

export function applyAkinaNakamoriOfficialRecovery(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  recovery: AkinaNakamoriOfficialRecoveryResult | null;
}): AkinaRecoveryApplication {
  if (!input.manifest || !input.recovery || !exactManifest(input.manifest)) {
    return { candidates: [...input.candidates], coversByWorkId: new Map(),
      matchedWorks: 0, matchedCarriers: 0 };
  }
  const exact = exactRecoveries(input.manifest, input.recovery);
  const keyWorkIds = new Map<string, Set<string>>();
  const workIdKeys = new Map<string, Set<string>>();
  for (const candidate of input.candidates) {
    const key = manifestEntryKey(candidate);
    if (!key || !exact.has(key as AkinaNakamoriOfficialRecoveryKey)) continue;
    const workIds = keyWorkIds.get(key) ?? new Set<string>();
    workIds.add(candidate.workId);
    keyWorkIds.set(key, workIds);
    const keys = workIdKeys.get(candidate.workId) ?? new Set<string>();
    keys.add(key);
    workIdKeys.set(candidate.workId, keys);
  }

  let matchedCarriers = 0;
  const matchedKeys = new Set<string>();
  const acceptedWorkIdsByKey = new Map<string, string>();
  const invalidRecoveryWorkIds = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const key = manifestEntryKey(candidate);
    const recovered = key ? exact.get(key as AkinaNakamoriOfficialRecoveryKey) : null;
    if (!key || !recovered) return candidate;
    if (keyWorkIds.get(key)?.size !== 1 ||
      workIdKeys.get(candidate.workId)?.size !== 1 ||
      normalizedCuratedWorkTitle(candidate.candidate.title) !==
        normalizedCuratedWorkTitle(recovered.work.title) ||
      !["中森明菜", "Akina Nakamori"].map(normalizedCuratedWorkTitle)
        .includes(normalizedCuratedWorkTitle(candidate.candidate.artistCredit))) {
      invalidRecoveryWorkIds.add(candidate.workId);
      return candidate;
    }
    matchedKeys.add(key);
    acceptedWorkIdsByKey.set(key, candidate.workId);
    const sources = candidate.candidate.sources.some((item) => item.url === recovered.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "中森明菜 official label entity",
          url: recovered.sourceUrl,
          sourceType: "official" as const,
        }];
    let next = addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, workObservation(candidate, recovered));
    if (recovered.carrier &&
      candidate.editionId === `${MANIFEST_PROVIDER}:representation:${key}` &&
      candidate.candidate.releaseDate === recovered.carrier.releaseDate &&
      normalizedCatalog(candidate.candidate.catalogNumber) ===
        normalizedCatalog(recovered.carrier.catalogNumber) &&
      /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? "")) {
      next = addComprehensiveObservation(next, carrierObservation(
        next,
        recovered as ExactRecovery & { carrier: AkinaNakamoriOfficialCarrierEvidence },
      ));
      matchedCarriers += 1;
    }
    return next;
  });

  const covers = new Map<string, AkinaNakamoriOfficialCoverEvidence>();
  for (const [key, recovered] of exact) {
    const workId = acceptedWorkIdsByKey.get(key);
    if (!workId || invalidRecoveryWorkIds.has(workId)) continue;
    covers.set(workId, recovered.cover);
  }
  return { candidates, coversByWorkId: covers, matchedWorks: matchedKeys.size, matchedCarriers };
}
