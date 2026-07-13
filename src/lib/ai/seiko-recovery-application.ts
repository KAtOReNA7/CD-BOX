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
  SEIKO_MATSUDA_RECOVERY_SPECS,
  type SeikoMatsudaRecoveryCover,
  type SeikoMatsudaRecoveryEntity,
  type SeikoMatsudaRecoveryResult,
  type SeikoMatsudaRecoveryWorkKey,
} from "@/lib/official-music/seiko-matsuda-recovery";

const MANIFEST_PROVIDER = "curated-official-manifest:seiko-matsuda";
const OFFICIAL_PROVIDER = "seiko-matsuda-official";

function normalizedCatalog(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleUpperCase("en")
    .replace(/[^\p{L}\p{N}]/gu, "");
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

function manifestWorkByKey(
  manifest: CuratedArtistDiscography,
  key: string,
) {
  const [category, rawOrdinal, ...extra] = key.split(":");
  const ordinal = Number(rawOrdinal);
  if (extra.length > 0 || !Number.isSafeInteger(ordinal) || ordinal <= 0) return null;
  const matches = manifest.works.filter((work) =>
    work.category === category && work.ordinal === ordinal);
  return matches.length === 1 ? matches[0]! : null;
}

function exactManifestEntity(
  manifest: CuratedArtistDiscography,
  entity: SeikoMatsudaRecoveryEntity,
) {
  if (manifest.slug !== "seiko-matsuda" || manifest.canonicalName !== "松田聖子" ||
    manifest.country !== "JP") return null;
  const spec = SEIKO_MATSUDA_RECOVERY_SPECS[entity.manifestEntryKey];
  const work = manifestWorkByKey(manifest, entity.manifestEntryKey);
  if (!work ||
    work.title !== spec.canonicalTitle ||
    work.category !== spec.manifestCategory ||
    work.originalReleaseDate !== spec.releaseDate ||
    entity.sourceUrl !== spec.sourceUrl ||
    entity.provider !== OFFICIAL_PROVIDER ||
    entity.observedArtist !== "松田聖子" ||
    entity.canonicalTitle !== spec.canonicalTitle ||
    entity.observedTitle !== spec.pageTitle ||
    entity.manifestCategory !== spec.manifestCategory ||
    entity.observedReleaseDate !== spec.releaseDate ||
    entity.observedCatalogDisplay !== spec.catalogDisplay ||
    entity.selectionPolicy !== spec.selectionPolicy ||
    entity.observedCatalogNumbers.length !== spec.catalogNumbers.length ||
    entity.observedCatalogNumbers.some((catalog, index) => catalog !== spec.catalogNumbers[index]) ||
    entity.carrier.provider !== OFFICIAL_PROVIDER ||
    entity.carrier.sourceUrl !== spec.sourceUrl ||
    entity.carrier.role !== "AUTHORITATIVE" ||
    entity.carrier.strength !== "STRONG" ||
    entity.carrier.facts.manifestEntryKey !== entity.manifestEntryKey ||
    entity.carrier.facts.verified !== "true" ||
    entity.carrier.facts.unique !== "true" ||
    entity.carrier.facts.dynamicOfficialCarrier !== "true" ||
    entity.carrier.facts.provenanceSourceUrl !== spec.sourceUrl ||
    entity.carrier.facts.fixedPageId !== String(spec.detailId) ||
    entity.carrier.facts.artist !== "松田聖子" ||
    entity.carrier.facts.canonicalTitle !== spec.canonicalTitle ||
    entity.carrier.facts.date !== spec.releaseDate ||
    entity.carrier.facts.format !== "CD" ||
    entity.carrier.facts.country !== "JP" ||
    entity.carrier.facts.selectionPolicy !== spec.selectionPolicy ||
    entity.carrier.facts.coverUrl !== `${"https://www.seikomatsuda.co.jp"}${spec.coverPath}` ||
    entity.cover.provider !== OFFICIAL_PROVIDER ||
    entity.cover.scope !== "WORK" ||
    entity.cover.matchLevel !== "WORK_EXACT" ||
    entity.cover.sourceUrl !== spec.sourceUrl ||
    entity.cover.url !== `${"https://www.seikomatsuda.co.jp"}${spec.coverPath}` ||
    entity.cover.observedAlt !== spec.pageTitle ||
    entity.cover.auditedAsset.sha256 !== spec.auditedAsset.sha256) return null;
  return work;
}

function workObservation(
  candidate: ComprehensiveDiscographyCandidate,
  entity: SeikoMatsudaRecoveryEntity,
) {
  return {
    id: `${OFFICIAL_PROVIDER}:recovery-work:${entity.manifestEntryKey}:${candidate.candidate.id}`,
    provider: OFFICIAL_PROVIDER,
    role: "AUTHORITATIVE" as const,
    strength: "STRONG" as const,
    stage: "AUTHORITATIVE" as const,
    verdict: "PASS" as const,
    reasonCode: "SEIKO_OFFICIAL_RECOVERY_WORK_VERIFIED",
    reason: "The fixed Seiko official entity page exactly identifies this canonical work and its artwork.",
    sourceUrl: entity.sourceUrl,
    matchedFields: ["artist", "title", "category", "date", "catalogNumber", "format"],
    facts: {
      ...entity.carrier.facts,
      manifestEntryKey: entity.manifestEntryKey,
      canonicalArtist: "松田聖子",
      canonicalTitle: entity.canonicalTitle,
      uniqueOfficialEntity: "true",
      selectionPolicy: entity.selectionPolicy,
    },
  };
}

function carrierMatchesManifest(
  candidate: ComprehensiveDiscographyCandidate,
  work: CuratedDiscographyWork,
  entity: SeikoMatsudaRecoveryEntity,
) {
  const media = work.mediaScope;
  const specCatalogs = new Set(entity.observedCatalogNumbers.map(normalizedCatalog));
  return Boolean(
    media &&
    media.physicalCdRepresentationKind === "SAME_WORK_EDITION" &&
    media.physicalCdReleaseDate === entity.observedReleaseDate &&
    specCatalogs.has(normalizedCatalog(media.physicalCdCatalogNumber)) &&
    candidate.editionId === `${MANIFEST_PROVIDER}:representation:${entity.manifestEntryKey}` &&
    candidate.candidate.releaseDate === media.physicalCdReleaseDate &&
    normalizedCatalog(candidate.candidate.catalogNumber) ===
      normalizedCatalog(media.physicalCdCatalogNumber) &&
    /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? ""),
  );
}

function carrierObservation(
  candidate: ComprehensiveDiscographyCandidate,
  work: CuratedDiscographyWork,
  entity: SeikoMatsudaRecoveryEntity,
) {
  const catalogNumber = work.mediaScope!.physicalCdCatalogNumber!;
  return {
    id: `${OFFICIAL_PROVIDER}:recovery-carrier:${entity.manifestEntryKey}:${candidate.candidate.id}`,
    provider: OFFICIAL_PROVIDER,
    role: "CORROBORATING" as const,
    strength: "STRONG" as const,
    stage: "CORROBORATION" as const,
    verdict: "PASS" as const,
    reasonCode: "SEIKO_OFFICIAL_RECOVERY_CD_CARRIER_MATCH",
    reason: "One fixed Seiko official entity exactly matches the declared same-work physical-CD carrier.",
    sourceUrl: entity.sourceUrl,
    matchedFields: [
      "artist",
      "title",
      "date",
      "catalogNumber",
      "country",
      "format",
      "uniqueCarrier",
    ],
    facts: {
      artist: "松田聖子",
      canonicalArtist: "松田聖子",
      carrierTitle: entity.observedTitle,
      canonicalTitle: work.title,
      date: entity.observedReleaseDate,
      catalogNumber,
      catalogNumbers: entity.observedCatalogNumbers.join(","),
      country: "JP",
      format: "CD",
      status: "Official",
      manifestEntryKey: entity.manifestEntryKey,
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
      selectionPolicy: entity.selectionPolicy,
      fixedPageId: entity.carrier.facts.fixedPageId,
      auditedCoverSha256: entity.cover.auditedAsset.sha256,
    },
  };
}

export type SeikoRecoveryApplication = {
  candidates: ComprehensiveDiscographyCandidate[];
  coversByWorkId: ReadonlyMap<string, SeikoMatsudaRecoveryCover>;
  matchedWorks: number;
  matchedCarriers: number;
};

export function applySeikoMatsudaRecoveryEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  recovery: SeikoMatsudaRecoveryResult | null;
}): SeikoRecoveryApplication {
  if (input.manifest?.slug !== "seiko-matsuda" || !input.recovery) {
    return {
      candidates: [...input.candidates],
      coversByWorkId: new Map(),
      matchedWorks: 0,
      matchedCarriers: 0,
    };
  }
  const exact = new Map<SeikoMatsudaRecoveryWorkKey, {
    entity: SeikoMatsudaRecoveryEntity;
    work: CuratedDiscographyWork;
  }>();
  const duplicateKeys = new Set<SeikoMatsudaRecoveryWorkKey>();
  for (const entity of input.recovery.verified) {
    const work = exactManifestEntity(input.manifest, entity);
    if (work && !exact.has(entity.manifestEntryKey) &&
      !duplicateKeys.has(entity.manifestEntryKey)) {
      exact.set(entity.manifestEntryKey, { entity, work });
    } else if (work) {
      exact.delete(entity.manifestEntryKey);
      duplicateKeys.add(entity.manifestEntryKey);
    }
  }

  const keyWorkIds = new Map<string, Set<string>>();
  const workIdKeys = new Map<string, Set<string>>();
  for (const candidate of input.candidates) {
    const key = manifestEntryKey(candidate);
    if (!key || !exact.has(key as SeikoMatsudaRecoveryWorkKey)) continue;
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
  const candidates = input.candidates.map((candidate) => {
    const key = manifestEntryKey(candidate);
    const match = key ? exact.get(key as SeikoMatsudaRecoveryWorkKey) : null;
    if (!key || !match) return candidate;
    const exactArtistCredits = new Set([
      input.manifest!.canonicalName,
      ...input.manifest!.aliases,
      ...(match.work.artistCredits ?? []),
    ].map(normalizedCuratedWorkTitle).filter(Boolean));
    if (keyWorkIds.get(key)?.size !== 1 ||
      workIdKeys.get(candidate.workId)?.size !== 1 ||
      normalizedCuratedWorkTitle(candidate.candidate.title) !==
        normalizedCuratedWorkTitle(match.work.title) ||
      !exactArtistCredits.has(normalizedCuratedWorkTitle(candidate.candidate.artistCredit))) {
      return candidate;
    }
    matchedKeys.add(key);
    acceptedWorkIdsByKey.set(key, candidate.workId);
    const source = candidate.candidate.sources.some((item) => item.url === match.entity.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "松田聖子 official entity",
          url: match.entity.sourceUrl,
          sourceType: "official" as const,
        }];
    let next = addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources: source },
    }, workObservation(candidate, match.entity));
    if (carrierMatchesManifest(next, match.work, match.entity)) {
      next = addComprehensiveObservation(next, carrierObservation(next, match.work, match.entity));
      matchedCarriers += 1;
    }
    return next;
  });

  const covers = new Map<string, SeikoMatsudaRecoveryCover>();
  for (const [key, match] of exact) {
    const workId = acceptedWorkIdsByKey.get(key);
    if (!workId) continue;
    covers.set(workId, match.entity.cover);
  }
  return {
    candidates,
    coversByWorkId: covers,
    matchedWorks: matchedKeys.size,
    matchedCarriers,
  };
}
