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
  MIHO_NAKAYAMA_KING_CARRIER_URL,
  MIHO_NAKAYAMA_MANIFEST_CARRIER_WORKS,
  MIHO_NAKAYAMA_MELLOW_CD_URL,
  type MihoNakayamaKingCarrierFacts,
  type MihoNakayamaKingCarrierResult,
  type MihoNakayamaMellowCdEditionFacts,
  type MihoNakayamaMellowCdResult,
} from "@/lib/official-music/miho-nakayama-carrier";

const MANIFEST_PROVIDER = "curated-official-manifest:miho-nakayama";
const KING_PROVIDER = "king-records-japan";
const BOX_KEYS = new Map([
  ["生意気", "SINGLE:2"],
  ["BE-BOP-HIGHSCHOOL", "SINGLE:3"],
  ["ツイてるねノッてるね", "SINGLE:7"],
  ["VIRGIN EYES", "SINGLE:16"],
] as const);
const MELLOW_KEY = "ORIGINAL_ALBUM:14";
const MELLOW_TRACKS = [
  "Mellow",
  "あるきなさい",
  "ゆっくりMy Love",
  "Platinum Cat",
  "Silent",
  "忘れなくてもいいじゃない",
  "灼熱の心",
  "はなしをきいて",
  "Kiss Kiss Kiss",
  "Treasure",
  "Mellow(CM Version)",
] as const;

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

function manifestWorkByKey(manifest: CuratedArtistDiscography, key: string) {
  const [category, rawOrdinal, ...extra] = key.split(":");
  const ordinal = Number(rawOrdinal);
  if (extra.length > 0 || !Number.isSafeInteger(ordinal) || ordinal <= 0) return null;
  const matches = manifest.works.filter((work) =>
    work.category === category && work.ordinal === ordinal);
  return matches.length === 1 ? matches[0]! : null;
}

function exactManifest(manifest: CuratedArtistDiscography) {
  return manifest.slug === "miho-nakayama" && manifest.canonicalName === "中山美穂" &&
    manifest.aliases.includes("Miho Nakayama") && manifest.country === "JP";
}

function exactBoxCarrier(
  manifest: CuratedArtistDiscography,
  result: MihoNakayamaKingCarrierResult | null,
) {
  if (!result || result.status !== "VERIFIED" || !result.complete || !result.unique ||
    result.warnings.length !== 0) return null;
  const carrier = result.carrier;
  const expectedWorks = MIHO_NAKAYAMA_MANIFEST_CARRIER_WORKS;
  if (carrier.provider !== KING_PROVIDER ||
    carrier.sourceType !== "official-record-label-product-page" ||
    carrier.evidenceRole !== "PHYSICAL_CD_CARRIER" ||
    carrier.scope !== "CONTAINER_EDITION" || carrier.matchLevel !== "EDITION_EXACT" ||
    !carrier.unique || carrier.artist !== "中山美穂" ||
    carrier.title !== "All Time Best【初回限定盤】" ||
    carrier.releaseDate !== "2020-12-23" || carrier.catalogNumber !== "KICS-93968～70" ||
    carrier.country !== "JP" || carrier.format !== "CD" ||
    carrier.cdDiscCount !== 3 || carrier.trackCount !== 40 || carrier.tracks.length !== 40 ||
    carrier.sourceUrl !== MIHO_NAKAYAMA_KING_CARRIER_URL ||
    carrier.retrievalUrl !== MIHO_NAKAYAMA_KING_CARRIER_URL ||
    carrier.workCover !== null || carrier.coverInheritanceAllowed ||
    carrier.manifestCarrierWorks.length !== expectedWorks.length) return null;
  const trackTitles = carrier.tracks.map((track) => track.title);
  if (new Set(trackTitles).size !== trackTitles.length) return null;
  for (const [discIndex, count] of [14, 13, 13].entries()) {
    const disc = discIndex + 1;
    const tracks = carrier.tracks.filter((track) => track.disc === disc);
    if (tracks.length !== count || tracks.some((track, index) => track.position !== index + 1)) {
      return null;
    }
  }
  for (const [index, expected] of expectedWorks.entries()) {
    const observed = carrier.manifestCarrierWorks[index];
    const acceptedTitles = new Set<string>(expected.acceptedOfficialTitles);
    if (!observed || observed.manifestTitle !== expected.manifestTitle ||
      observed.disc !== expected.disc || observed.position !== expected.position ||
      !acceptedTitles.has(observed.observedTrackTitle) ||
      !carrier.tracks.some((track) => track.disc === observed.disc &&
        track.position === observed.position && track.title === observed.observedTrackTitle)) return null;
  }
  const works = new Map<string, CuratedDiscographyWork>();
  for (const [title, key] of BOX_KEYS) {
    const work = manifestWorkByKey(manifest, key);
    const media = work?.mediaScope;
    if (!work || work.title !== title || work.category !== "SINGLE" || !media ||
      media.physicalCd !== "LATER_OFFICIAL_EDITION" ||
      media.physicalCdRepresentationKind !== "CONTAINER_INCLUSION" ||
      media.physicalCdContainerTitle !== "All Time Best" ||
      media.physicalCdReleaseDate !== carrier.releaseDate ||
      media.physicalCdCatalogNumber !== carrier.catalogNumber ||
      media.physicalCdAuthorityUrls.length !== 1 ||
      media.physicalCdAuthorityUrls[0] !== carrier.sourceUrl) return null;
    works.set(key, work);
  }
  return { carrier, works };
}

function exactMellowEdition(
  manifest: CuratedArtistDiscography,
  result: MihoNakayamaMellowCdResult | null,
) {
  if (!result || result.status !== "VERIFIED" || !result.complete || !result.unique ||
    result.warnings.length !== 0) return null;
  const edition = result.edition;
  const work = manifestWorkByKey(manifest, MELLOW_KEY);
  const media = work?.mediaScope;
  if (!work || !media || work.title !== "Mellow" || work.category !== "ORIGINAL_ALBUM" ||
    work.originalReleaseDate !== "1992-06-10" ||
    media.physicalCd !== "LATER_OFFICIAL_EDITION" ||
    media.physicalCdRepresentationKind !== "SAME_WORK_EDITION" ||
    media.physicalCdReleaseDate !== "2015-10-14" ||
    media.physicalCdCatalogNumber !== "KICS-3274" ||
    media.physicalCdAuthorityUrls.length !== 1 ||
    media.physicalCdAuthorityUrls[0] !== MIHO_NAKAYAMA_MELLOW_CD_URL ||
    edition.provider !== KING_PROVIDER ||
    edition.sourceType !== "official-record-label-product-page" ||
    edition.evidenceRole !== "PHYSICAL_CD_EDITION" ||
    edition.scope !== "SAME_WORK_EDITION" || edition.matchLevel !== "EDITION_EXACT" ||
    edition.representationKind !== "SAME_WORK_EDITION" || !edition.unique ||
    edition.artist !== "中山美穂" || edition.workTitle !== "Mellow" ||
    edition.editionTitle !== "Mellow" || edition.originalReleaseDate !== "1992-06-10" ||
    edition.editionReleaseDate !== "2015-10-14" || edition.catalogNumber !== "KICS-3274" ||
    edition.country !== "JP" || edition.format !== "CD" || !edition.isReissue ||
    edition.cdDiscCount !== 1 || edition.trackCount !== 11 || edition.tracks.length !== 11 ||
    edition.tracks.some((track, index) =>
      track.position !== index + 1 || track.title !== MELLOW_TRACKS[index]) ||
    edition.sourceUrl !== MIHO_NAKAYAMA_MELLOW_CD_URL ||
    edition.retrievalUrl !== MIHO_NAKAYAMA_MELLOW_CD_URL ||
    edition.workCover !== null || edition.coverInheritanceAllowed) return null;
  return { edition, work };
}

function exactCandidate(
  candidate: ComprehensiveDiscographyCandidate,
  key: string,
  work: CuratedDiscographyWork,
) {
  const media = work.mediaScope!;
  return candidate.editionId === `${MANIFEST_PROVIDER}:representation:${key}` &&
    normalizedCuratedWorkTitle(candidate.candidate.title) ===
      normalizedCuratedWorkTitle(work.title) &&
    ["中山美穂", "Miho Nakayama"].map(normalizedCuratedWorkTitle)
      .includes(normalizedCuratedWorkTitle(candidate.candidate.artistCredit)) &&
    candidate.candidate.releaseDate === media.physicalCdReleaseDate &&
    normalizedCatalog(candidate.candidate.catalogNumber) ===
      normalizedCatalog(media.physicalCdCatalogNumber) &&
    /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? "");
}

function boxObservation(
  candidate: ComprehensiveDiscographyCandidate,
  key: string,
  work: CuratedDiscographyWork,
  carrier: MihoNakayamaKingCarrierFacts,
) {
  const membership = carrier.manifestCarrierWorks.find((item) => item.manifestTitle === work.title)!;
  return {
    id: `${KING_PROVIDER}:miho-box-carrier:${key}:${candidate.candidate.id}`,
    provider: KING_PROVIDER,
    role: "CORROBORATING" as const,
    strength: "STRONG" as const,
    stage: "CORROBORATION" as const,
    verdict: "PASS" as const,
    reasonCode: "MIHO_KING_ALL_TIME_BEST_CD_CARRIER_MATCH",
    reason: "The fixed King Records entity proves this exact canonical single is included in the declared three-CD carrier.",
    sourceUrl: carrier.sourceUrl,
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format",
      "trackMembership", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: key,
      artist: carrier.artist,
      canonicalArtist: "中山美穂",
      carrierTitle: "All Time Best",
      observedCarrierTitle: carrier.title,
      canonicalTitle: work.title,
      date: carrier.releaseDate,
      catalogNumber: carrier.catalogNumber,
      country: carrier.country,
      format: carrier.format,
      cdDiscCount: String(carrier.cdDiscCount),
      trackCount: String(carrier.trackCount),
      memberTrackTitle: membership.observedTrackTitle,
      memberDisc: String(membership.disc),
      memberPosition: String(membership.position),
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
      coverInheritanceAllowed: "false",
    },
  };
}

function mellowObservation(
  candidate: ComprehensiveDiscographyCandidate,
  work: CuratedDiscographyWork,
  edition: MihoNakayamaMellowCdEditionFacts,
) {
  return {
    id: `${KING_PROVIDER}:miho-mellow-carrier:${candidate.candidate.id}`,
    provider: KING_PROVIDER,
    role: "CORROBORATING" as const,
    strength: "STRONG" as const,
    stage: "CORROBORATION" as const,
    verdict: "PASS" as const,
    reasonCode: "MIHO_KING_MELLOW_CD_CARRIER_MATCH",
    reason: "The fixed King Records product entity exactly matches the declared Mellow same-work CD edition.",
    sourceUrl: edition.sourceUrl,
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format",
      "trackList", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: MELLOW_KEY,
      artist: edition.artist,
      canonicalArtist: "中山美穂",
      carrierTitle: edition.editionTitle,
      canonicalTitle: work.title,
      originalReleaseDate: edition.originalReleaseDate,
      date: edition.editionReleaseDate,
      catalogNumber: edition.catalogNumber,
      country: edition.country,
      format: edition.format,
      cdDiscCount: String(edition.cdDiscCount),
      trackCount: String(edition.trackCount),
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
      coverInheritanceAllowed: "false",
    },
  };
}

export function applyMihoNakayamaKingCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  box: MihoNakayamaKingCarrierResult | null;
  mellow: MihoNakayamaMellowCdResult | null;
}) {
  if (!input.manifest || !exactManifest(input.manifest)) {
    return { candidates: [...input.candidates], matchedCarriers: 0 };
  }
  const box = exactBoxCarrier(input.manifest, input.box);
  const mellow = exactMellowEdition(input.manifest, input.mellow);
  let matchedCarriers = 0;
  const candidates = input.candidates.map((candidate) => {
    const key = manifestEntryKey(candidate);
    const boxWork = key ? box?.works.get(key) : null;
    const mellowWork = key === MELLOW_KEY ? mellow?.work : null;
    const selected = boxWork
      ? { work: boxWork, sourceUrl: box!.carrier.sourceUrl }
      : mellowWork ? { work: mellowWork, sourceUrl: mellow!.edition.sourceUrl } : null;
    if (!key || !selected || !exactCandidate(candidate, key, selected.work)) return candidate;
    const sources = candidate.candidate.sources.some((source) => source.url === selected.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "King Records physical CD carrier",
          url: selected.sourceUrl,
          sourceType: "official" as const,
        }];
    const next = addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, boxWork
      ? boxObservation(candidate, key, boxWork, box!.carrier)
      : mellowObservation(candidate, mellow!.work, mellow!.edition));
    matchedCarriers += 1;
    return next;
  });
  return { candidates, matchedCarriers };
}
