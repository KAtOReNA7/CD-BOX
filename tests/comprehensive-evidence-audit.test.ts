import assert from "node:assert/strict";
import test from "node:test";
import {
  SEIKO_WHOS_IDENTITY_SUBSTITUTE,
  auditComprehensiveEvidenceWithAi,
  classifyComprehensiveEvidence,
  hasCuratedOfficialInventoryIdentitySubstitute,
  hasSeikoWhosThatBoyIdentitySubstitute,
  validateComprehensiveAiDecisions,
  type ComprehensiveEvidenceCandidate,
  type ComprehensiveEvidenceObservation,
} from "@/lib/ai/comprehensive-evidence-audit";

const musicBrainzReleaseUrl =
  "https://musicbrainz.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function observation(
  id: string,
  overrides: Partial<ComprehensiveEvidenceObservation> = {},
): ComprehensiveEvidenceObservation {
  return {
    id,
    provider: "musicbrainz",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "MUSICBRAINZ",
    verdict: "PASS",
    reasonCode: "SOURCE_MATCH",
    reason: "The source supplied the edition.",
    sourceUrl: id === "mb" ? musicBrainzReleaseUrl : `https://example.com/${id}`,
    matchedFields: ["title", "artist", "catalogNumber", "date", "format"],
    facts: {
      title: "CATCH THE NITE",
      artist: "Miho Nakayama",
      catalogNumber: "K32X-240",
      date: "1988-02-10",
      format: "CD",
    },
    ...overrides,
  };
}

function evidenceCandidate(
  overrides: Partial<ComprehensiveEvidenceCandidate> = {},
): ComprehensiveEvidenceCandidate {
  return {
    candidateId: "candidate-1",
    workId: "work-1",
    editionId: "edition-1",
    title: "CATCH THE NITE",
    artistCredit: "Miho Nakayama",
    observations: [
      observation("mb"),
      observation("official", {
        provider: "king-records",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        sourceUrl: "https://www.kingrecords.co.jp/example",
      }),
    ],
    conflicts: [],
    ...overrides,
  };
}

test("MusicBrainz plus one strong authority is eligible for AI without NDL or Discogs", () => {
  assert.deepEqual(classifyComprehensiveEvidence(evidenceCandidate()), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
});

test("work-level or incomplete observations cannot stand in for a physical edition", () => {
  const variants: Array<[string, ComprehensiveEvidenceObservation]> = [
    ["release group", observation("mb-group", {
      sourceUrl: "https://musicbrainz.org/release-group/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    })],
    ["release without format attestation", observation("mb-no-format", {
      sourceUrl: musicBrainzReleaseUrl,
      matchedFields: ["artist", "title", "catalogNumber", "date"],
    })],
    ["non-entity URL", observation("mb-example", {
      sourceUrl: "https://example.com/musicbrainz-row",
    })],
  ];
  for (const [label, musicBrainz] of variants) {
    const value = evidenceCandidate({
      observations: [musicBrainz, evidenceCandidate().observations[1]!],
    });
    assert.equal(classifyComprehensiveEvidence(value).eligibleForAi, false, label);
  }

  const workOnlyDiscogs = evidenceCandidate({
    observations: [
      observation("ndl-authority", {
        provider: "ndl-search",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
      }),
      observation("discogs-work", {
        provider: "discogs",
        role: "CORROBORATING",
        strength: "SUPPORTING",
        stage: "CORROBORATION",
        sourceUrl: "https://www.discogs.com/release/123",
        reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
        matchedFields: ["artist", "title", "catalogNumber", "year", "format"],
      }),
    ],
  });
  assert.equal(classifyComprehensiveEvidence(workOnlyDiscogs).eligibleForAi, false);
});

test("NDL plus an independent catalog-bound Discogs edition is eligible without MusicBrainz", () => {
  const candidate = evidenceCandidate({
    observations: [
      observation("ndl", {
        provider: "ndl-search",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
        matchedFields: ["artist", "title", "catalogNumber", "date"],
      }),
      observation("discogs", {
        provider: "discogs",
        role: "CORROBORATING",
        strength: "SUPPORTING",
        stage: "CORROBORATION",
        sourceUrl: "https://www.discogs.com/release/123",
        matchedFields: ["artist", "title", "catalogNumber", "year", "country", "format"],
      }),
    ],
  });
  assert.deepEqual(classifyComprehensiveEvidence(candidate), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
});

test("generic catalog/year corroboration cannot substitute a different artist or title", () => {
  for (const field of ["artist", "title"] as const) {
    const discogs = observation(`discogs-wrong-${field}`, {
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      matchedFields: ["artist", "title", "catalogNumber", "year"],
      facts: {
        title: field === "title" ? "Different Work" : "CATCH THE NITE",
        artist: field === "artist" ? "Different Artist" : "Miho Nakayama",
        catalogNumber: "K32X-240",
        year: "1988",
      },
    });
    const candidate = evidenceCandidate({
      observations: [
        observation("ndl-identity", {
          provider: "ndl-search",
          role: "AUTHORITATIVE",
          strength: "STRONG",
          stage: "AUTHORITATIVE",
        }),
        discogs,
      ],
    });
    assert.equal(classifyComprehensiveEvidence(candidate).eligibleForAi, false, field);
  }
});

function curatedSubstitutionObservations(): ComprehensiveEvidenceObservation[] {
  return [
    observation("curated-authority", {
      provider: "curated-official-manifest:miho-test",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      matchedFields: ["artist", "title", "category"],
      facts: {
        artist: "Miho Nakayama",
        title: "CATCH THE NITE",
        category: "SINGLE",
        date: "1982-05-01",
        manifestEntryKey: "SINGLE:1",
      },
    }),
    observation("curated-scope", {
      provider: "curated-official-manifest:miho-test",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      reasonCode: "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED",
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        manifestEntryKey: "SINGLE:1",
        format: "CD",
        physicalCd: "ORIGINAL_RELEASE",
        physicalCdRepresentationKind: "WORK_ONLY",
      },
    }),
    observation("curated-discogs-work", {
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
      matchedFields: ["artist", "title", "category", "originalYear"],
      facts: {
        artist: "Miho Nakayama",
        canonicalArtist: "Miho Nakayama",
        canonicalTitle: "CATCH THE NITE",
        category: "SINGLE",
        originalYear: "1982",
        manifestEntryKey: "SINGLE:1",
        uniqueBinding: "true",
        inventoryComplete: "true",
      },
    }),
  ];
}

test("a Discogs original-work binding cannot replace physical-edition evidence", () => {
  const candidate = evidenceCandidate({ observations: curatedSubstitutionObservations() });
  assert.deepEqual(classifyComprehensiveEvidence(candidate), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_INDEPENDENT_CORROBORATION",
    eligibleForAi: false,
  });
});

function soundFujiWorkAuthority(): ComprehensiveEvidenceObservation {
  return observation("sound-fuji-work", {
    provider: "king-records-sound-fuji",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    reasonCode: "OFFICIAL_LABEL_WORK_MATCH",
    sourceUrl: "https://soundfuji.kingrecords.co.jp/release/1587/",
    matchedFields: ["artist", "title", "category"],
    facts: {
      artist: "Miho Nakayama",
      title: "CATCH THE NITE",
      category: "SINGLE",
      manifestEntryKey: "SINGLE:1",
    },
  });
}

test("a legacy work-only representation remains pending despite an exact official work page", () => {
  const observations = structuredClone(curatedSubstitutionObservations());
  observations[1]!.reasonCode = "OFFICIAL_CD_MANIFEST_WORK_SCOPE";
  observations[1]!.facts!.physicalCd = "LEGACY_CONFIRMED";
  observations.push(soundFujiWorkAuthority());
  assert.equal(classifyComprehensiveEvidence(evidenceCandidate({ observations })).eligibleForAi, false);

  for (const [label, mutate] of [
    ["wrong artist", (item: ComprehensiveEvidenceObservation) => {
      item.facts!.artist = "Different Artist";
    }],
    ["wrong title", (item: ComprehensiveEvidenceObservation) => {
      item.facts!.title = "Different Work";
    }],
    ["wrong manifest key", (item: ComprehensiveEvidenceObservation) => {
      item.facts!.manifestEntryKey = "SINGLE:2";
    }],
  ] as const) {
    const changed = structuredClone(observations);
    mutate(changed.at(-1)!);
    assert.equal(
      classifyComprehensiveEvidence(evidenceCandidate({ observations: changed })).eligibleForAi,
      false,
      label,
    );
  }
  assert.equal(classifyComprehensiveEvidence(evidenceCandidate({
    observations: [...observations, {
      ...structuredClone(soundFujiWorkAuthority()),
      id: "duplicate-sound-fuji-work",
    }],
  })).eligibleForAi, false, "ambiguous official work pages fail closed");
  assert.equal(classifyComprehensiveEvidence(evidenceCandidate({
    artistCredit: "Miho Nakayama & Different Artist",
    observations,
  })).eligibleForAi, false, "multi-artist candidate credit is not silently accepted");
});

test("a specifically claimed curated CD requires one exact carrier tuple", () => {
  const observations = structuredClone(curatedSubstitutionObservations());
  observations[1]!.facts = {
    ...observations[1]!.facts,
    physicalCdRepresentationKind: "SAME_WORK_EDITION",
    physicalCdReleaseDate: "1988-02-10",
    physicalCdCatalogNumber: "K32X-240",
  };
  const claimedEditionId =
    "curated-official-manifest:miho-test:representation:SINGLE:1";
  assert.equal(classifyComprehensiveEvidence(evidenceCandidate({
    editionId: claimedEditionId,
    observations,
  })).eligibleForAi, false);
  observations.push(observation("unrelated-musicbrainz-work-pass", {
    provider: "musicbrainz",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "MUSICBRAINZ",
    reasonCode: "MUSICBRAINZ_WORK_GROUP_CORROBORATION",
    matchedFields: ["artist", "title"],
  }));
  assert.deepEqual(classifyComprehensiveEvidence(evidenceCandidate({
    editionId: claimedEditionId,
    observations,
  })), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_DECLARED_CARRIER",
    eligibleForAi: false,
  }, "a work-level MusicBrainz PASS cannot bypass the claimed edition carrier");

  const carrier = observation("curated-carrier", {
    provider: "discogs",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    reasonCode: "CURATED_CANONICAL_WORK_CARRIER_MATCH",
    sourceUrl: "https://www.discogs.com/release/123",
    matchedFields: ["artist", "title", "catalogNumber", "year", "country", "format"],
    facts: {
      artist: "Miho Nakayama",
      canonicalTitle: "CATCH THE NITE",
      carrierTitle: "CATCH THE NITE",
      catalogNumber: "K32X-240",
      year: "1988",
      manifestEntryKey: "SINGLE:1",
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
    },
  });
  assert.equal(classifyComprehensiveEvidence(evidenceCandidate({
    editionId: claimedEditionId,
    observations: [...observations, carrier],
  })).eligibleForAi, true);
  for (const field of ["artist", "carrierTitle", "catalogNumber", "year"] as const) {
    const wrong = structuredClone(carrier);
    wrong.facts![field] = field === "year" ? "1989" : "wrong";
    assert.equal(classifyComprehensiveEvidence(evidenceCandidate({
      editionId: claimedEditionId,
      observations: [...observations, wrong],
    })).eligibleForAi, false, field);
  }
});

function momoeCosmosAuditObservations(): ComprehensiveEvidenceObservation[] {
  const provider = "curated-official-manifest:momoe-yamaguchi";
  const key = "ORIGINAL_ALBUM:14";
  return [
    observation("momoe-cosmos-manifest", {
      provider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      sourceUrl: "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/SRCL-2622",
      matchedFields: ["artist", "title", "category", "date"],
      facts: {
        artist: "山口百恵",
        artistCredits: "",
        title: "COSMOS（宇宙）",
        category: "ORIGINAL_ALBUM",
        date: "1978-05-01",
        manifestEntryKey: key,
      },
    }),
    observation("momoe-cosmos-scope", {
      provider,
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      reasonCode: "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
      sourceUrl: "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/SRCL-2622",
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        country: "JP",
        format: "CD",
        title: "COSMOS（宇宙）",
        date: "1978-05-01",
        manifestEntryKey: key,
        physicalCd: "LATER_OFFICIAL_EDITION",
        physicalCdCountry: "JP",
        physicalCdReleaseDate: "1993-06-21",
        physicalCdCatalogNumber: "SRCL-2622",
        physicalCdRepresentationKind: "SAME_WORK_EDITION",
      },
    }),
    observation("momoe-cosmos-original-work", {
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
      sourceUrl: "https://www.discogs.com/release/7814",
      matchedFields: ["artist", "title", "category", "originalYear"],
      facts: {
        artist: "Momoe Yamaguchi",
        boundArtistCredit: "山口百恵",
        canonicalArtist: "山口百恵",
        canonicalTitle: "COSMOS（宇宙）",
        category: "ORIGINAL_ALBUM",
        originalYear: "1978",
        manifestEntryKey: key,
        uniqueBinding: "true",
        inventoryComplete: "true",
      },
    }),
    observation("momoe-cosmos-sony-carrier", {
      provider: "sony-music-japan",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      reasonCode: "MOMOE_SONY_COSMOS_CD_CARRIER_MATCH",
      sourceUrl: "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/SRCL-2622",
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
        manifestEntryKey: key,
        canonicalArtist: "山口百恵",
        canonicalTitle: "COSMOS（宇宙）",
        artist: "山口百恵",
        carrierTitle: "COSMOS宇宙",
        date: "1993-06-21",
        catalogNumber: "SRCL-2622",
        country: "JP",
        format: "CD",
        physicalCdRepresentationKind: "SAME_WORK_EDITION",
        retrievalUrl:
          "https://www.sonymusic.co.jp/json/v2/artist/MomoeYamaguchi/discography/SRCL-2622/callback/cdbox_srcl2622",
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }),
  ];
}

function momoeCosmosAuditCandidate(
  observations = momoeCosmosAuditObservations(),
): ComprehensiveEvidenceCandidate {
  return evidenceCandidate({
    candidateId: "curated-momoe-yamaguchi-original_album-14",
    workId: "curated-official-manifest:momoe-yamaguchi:ORIGINAL_ALBUM:14",
    editionId:
      "curated-official-manifest:momoe-yamaguchi:representation:ORIGINAL_ALBUM:14",
    title: "COSMOS（宇宙）",
    artistCredit: "山口百恵",
    observations,
  });
}

test("one Sony product/JSONP tuple still needs an independent physical-edition source", () => {
  const exact = momoeCosmosAuditCandidate();
  assert.deepEqual(classifyComprehensiveEvidence(exact), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_INDEPENDENT_CORROBORATION",
    eligibleForAi: false,
  });

  const cases: Array<[string, (carrier: ComprehensiveEvidenceObservation) => void]> = [
    ["source URL", (carrier) => { carrier.sourceUrl = "https://example.com/SRCL-2622"; }],
    ["retrieval URL", (carrier) => { carrier.facts!.retrievalUrl = "https://example.com/data"; }],
    ["manifest key", (carrier) => { carrier.facts!.manifestEntryKey = "ORIGINAL_ALBUM:13"; }],
    ["artist", (carrier) => { carrier.facts!.artist = "Other Artist"; }],
    ["title", (carrier) => { carrier.facts!.carrierTitle = "Different Album"; }],
    ["date", (carrier) => { carrier.facts!.date = "1993-06-22"; }],
    ["catalog", (carrier) => { carrier.facts!.catalogNumber = "SRCL-2623"; }],
    ["country", (carrier) => { carrier.facts!.country = "US"; }],
    ["format", (carrier) => { carrier.facts!.format = "SACD"; }],
    ["uniqueness", (carrier) => { carrier.facts!.uniqueCarrierEntity = "false"; }],
  ];
  for (const [name, mutate] of cases) {
    const observations = structuredClone(momoeCosmosAuditObservations());
    mutate(observations[3]!);
    assert.equal(
      classifyComprehensiveEvidence(momoeCosmosAuditCandidate(observations)).eligibleForAi,
      false,
      name,
    );
  }

  const duplicate = structuredClone(momoeCosmosAuditObservations()[3]!);
  duplicate.id = "momoe-cosmos-sony-carrier-duplicate";
  assert.equal(classifyComprehensiveEvidence(momoeCosmosAuditCandidate([
    ...momoeCosmosAuditObservations(),
    duplicate,
  ])).eligibleForAi, false, "duplicate exact Sony carrier entities fail closed");
});

function curatedOfficialInventoryObservations(): ComprehensiveEvidenceObservation[] {
  const provider = "curated-official-manifest:akina-nakamori";
  const key = "SINGLE:44";
  const officialUrl = "https://www.universal-music.co.jp/nakamori-akina/products/umck-5060/";
  return [
    observation("akina-heat-manifest", {
      provider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      sourceUrl: "https://akinanakamoriofficial.com/profile/",
      matchedFields: ["artist", "title", "category"],
      facts: {
        artist: "中森明菜",
        artistCredits: "",
        title: "The Heat 〜musica fiesta〜",
        category: "SINGLE",
        date: "2002-05-02",
        ordinal: "44",
        manifestEntryKey: key,
        authorityAsOf: "2026-07-01",
        dateSupport: "MANIFEST_ONLY",
        musicBrainzObservedDate: null,
      },
    }),
    observation("akina-heat-scope", {
      provider,
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      reasonCode: "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED",
      sourceUrl: officialUrl,
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        country: "JP",
        format: "CD",
        title: "The Heat 〜musica fiesta〜",
        date: "2002-05-02",
        manifestEntryKey: key,
        originalFormats: "CD",
        physicalCd: "ORIGINAL_RELEASE",
        physicalCdReleaseDate: "2002-05-02",
        physicalCdCatalogNumber: "UMCK-5060",
        physicalCdRepresentationKind: "SAME_WORK_EDITION",
      },
    }),
    observation("akina-heat-discogs-work", {
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
      sourceUrl: "https://www.discogs.com/release/9888435",
      matchedFields: [
        "artist",
        "title",
        "category",
        "originalYear",
        "catalogNumber",
        "year",
      ],
      facts: {
        artist: "中森明菜",
        canonicalArtist: "中森明菜",
        title: "The Heat 〜Musica Fiesta〜",
        canonicalTitle: "The Heat 〜musica fiesta〜",
        category: "SINGLE",
        originalYear: "2002",
        year: "2002",
        catalogNumber: "UMCK 5060",
        formats: "CD, Single",
        releaseId: "9888435",
        masterId: null,
        matchKind: "NFKC_EXACT",
        manifestEntryKey: key,
        uniqueBinding: "true",
        inventoryComplete: "true",
      },
    }),
    observation("akina-heat-official", {
      provider: "official-catalog",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      reasonCode: "OFFICIAL_CATALOG_EDITION_MATCH",
      sourceUrl: officialUrl,
      matchedFields: ["title", "catalogNumber", "date"],
      facts: {
        title: "The Heat 〜musica fiesta〜",
        catalogNumber: "UMCK-5060",
        date: "2002-05-02",
      },
    }),
  ];
}

function curatedOfficialInventoryCandidate(
  observations = curatedOfficialInventoryObservations(),
): ComprehensiveEvidenceCandidate {
  return evidenceCandidate({
    candidateId: "curated-akina-nakamori-single-44",
    workId: "curated-official-manifest:akina-nakamori:SINGLE:44",
    editionId: "curated-official-manifest:akina-nakamori:representation:SINGLE:44",
    title: "The Heat 〜musica fiesta〜",
    artistCredit: "中森明菜",
    observations,
  });
}

test("an official page plus a Discogs work tuple still needs one physical-edition source", () => {
  const candidate = curatedOfficialInventoryCandidate();
  assert.equal(hasCuratedOfficialInventoryIdentitySubstitute(candidate), true);
  assert.deepEqual(classifyComprehensiveEvidence(candidate), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_INDEPENDENT_CORROBORATION",
    eligibleForAi: false,
  });
});

test("the canonical official/inventory substitute fails closed on every tuple or provenance mismatch", () => {
  const cases: Array<[string, (items: ComprehensiveEvidenceObservation[]) => void]> = [
    ["official source", (items) => { items[3]!.sourceUrl = "https://example.com/product"; }],
    ["official title", (items) => { items[3]!.facts!.title = "Different Work"; }],
    ["official date", (items) => { items[3]!.facts!.date = "2002-05-03"; }],
    ["official catalog", (items) => { items[3]!.facts!.catalogNumber = "UMCK-5061"; }],
    ["Discogs artist", (items) => { items[2]!.facts!.artist = "Different Artist"; }],
    ["Discogs title", (items) => { items[2]!.facts!.title = "Different Work"; }],
    ["Discogs year", (items) => { items[2]!.facts!.year = "2003"; }],
    ["Discogs catalog", (items) => { items[2]!.facts!.catalogNumber = "UMCK-5061"; }],
    ["Discogs format", (items) => { items[2]!.facts!.formats = "Vinyl, Single"; }],
    ["Discogs promo", (items) => { items[2]!.facts!.formats = "CD, Single, Promo"; }],
    ["Discogs provenance", (items) => { items[2]!.sourceUrl = "https://www.discogs.com/release/9888436"; }],
    ["inventory completeness", (items) => { items[2]!.facts!.inventoryComplete = "false"; }],
    ["scope date", (items) => { items[1]!.facts!.physicalCdReleaseDate = "2002-05-03"; }],
    ["scope catalog", (items) => { items[1]!.facts!.physicalCdCatalogNumber = "UMCK-5061"; }],
  ];
  for (const [label, mutate] of cases) {
    const observations = structuredClone(curatedOfficialInventoryObservations());
    mutate(observations);
    const candidate = curatedOfficialInventoryCandidate(observations);
    assert.equal(hasCuratedOfficialInventoryIdentitySubstitute(candidate), false, label);
    assert.equal(classifyComprehensiveEvidence(candidate).eligibleForAi, false, label);
  }

  const wrongEdition = curatedOfficialInventoryCandidate();
  wrongEdition.editionId = "discogs:9888435";
  assert.equal(hasCuratedOfficialInventoryIdentitySubstitute(wrongEdition), false);
  assert.equal(classifyComprehensiveEvidence(wrongEdition).eligibleForAi, false);
});

test("curated MusicBrainz substitution rejects wrong identity, missing scope/authority, and ambiguity", () => {
  const cases: Array<[string, ComprehensiveEvidenceObservation[]]> = [];
  const mutate = (
    label: string,
    update: (observations: ComprehensiveEvidenceObservation[]) => void,
  ) => {
    const observations = structuredClone(curatedSubstitutionObservations());
    update(observations);
    cases.push([label, observations]);
  };
  mutate("wrong artist", (items) => {
    items[2]!.facts!.canonicalArtist = "松田聖子";
  });
  mutate("wrong year", (items) => {
    items[2]!.facts!.originalYear = "1983";
  });
  mutate("wrong category", (items) => {
    items[2]!.facts!.category = "ORIGINAL_ALBUM";
  });
  mutate("ambiguous binding", (items) => {
    items.push({ ...structuredClone(items[2]!), id: "second-discogs-binding" });
  });
  mutate("legacy unproven CD scope", (items) => {
    items[1]!.reasonCode = "OFFICIAL_CD_MANIFEST_WORK_SCOPE";
    items[1]!.facts!.physicalCd = "LEGACY_CONFIRMED";
  });
  mutate("no scope", (items) => {
    items.splice(1, 1);
  });
  mutate("no authority", (items) => {
    items.splice(0, 1);
  });

  for (const [label, observations] of cases) {
    assert.equal(
      classifyComprehensiveEvidence(evidenceCandidate({ observations })).eligibleForAi,
      false,
      label,
    );
  }
});

function seikoWhosSubstitutionObservations(): ComprehensiveEvidenceObservation[] {
  const contract = SEIKO_WHOS_IDENTITY_SUBSTITUTE;
  return [
    observation("seiko-whos-manifest", {
      provider: contract.manifestProvider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: contract.manifestReasonCode,
      sourceUrl: "https://www.seikomatsuda.co.jp/discography/single",
      matchedFields: ["artist", "title", "category"],
      facts: {
        manifestEntryKey: contract.manifestEntryKey,
        ordinal: "29",
        artist: "松田聖子",
        artistCredits: "SEIKO",
        title: "Who's that boy",
        category: "SINGLE",
        date: "1990-10-01",
        authorityAsOf: "2016-09-21",
        authorityPages: [
          "https://www.seikomatsuda.co.jp/discography/single",
          "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
        ].join(","),
        dateSupport: "MANIFEST_ONLY",
        musicBrainzObservedDate: null,
      },
    }),
    observation("seiko-whos-scope", {
      provider: contract.manifestProvider,
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: "PASS",
      reasonCode: "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
      sourceUrl: "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        manifestEntryKey: contract.manifestEntryKey,
        country: "JP",
        format: "CD",
        physicalCd: "LATER_OFFICIAL_EDITION",
      },
    }),
    observation("seiko-whos-entity", {
      provider: contract.entityProvider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: contract.entityReasonCode,
      sourceUrl: "https://www.seikomatsuda.co.jp/discography/detail/69",
      matchedFields: [
        "artist",
        "artistCredit",
        "title",
        "category",
        "date",
        "catalogNumber",
      ],
      facts: {
        manifestEntryKey: contract.manifestEntryKey,
        verified: "true",
        unique: "true",
        provenanceSourceUrl: "https://www.seikomatsuda.co.jp/discography/detail/69",
        fixedPageId: "69",
        artist: "松田聖子",
        artistCredit: "SEIKO",
        title: "Who's that boy",
        category: "SINGLE",
        date: "1990-10-01",
        originalCatalogNumber: "73523",
      },
    }),
    observation("seiko-whos-sony-box", {
      provider: contract.sonyProvider,
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: contract.sonyReasonCode,
      sourceUrl: "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
      matchedFields: [
        "artist",
        "artistCredit",
        "title",
        "boxCompleteness",
        "date",
        "catalogRange",
        "carrier",
      ],
      facts: {
        manifestEntryKey: contract.manifestEntryKey,
        verified: "true",
        unique: "true",
        provenanceSourceUrl: "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
        artist: "松田聖子",
        artistCredit: "SEIKO",
        canonicalTitle: "Who's that boy",
        observedTitle: "WHO’S THAT BOY",
        date: "2010-05-26",
        catalogDisplay: "SRCL20061-133",
        catalogStart: "SRCL-20061",
        catalogEnd: "SRCL-20133",
        carrier: "BLU_SPEC_CD",
        completeSinglesCount: "73",
        cdDiscCount: "73",
      },
    }),
    observation("seiko-whos-ndl", {
      provider: contract.ndlProvider,
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: contract.ndlReasonCode,
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000010906601",
      matchedFields: [
        "artist",
        "artistCredit",
        "title",
        "catalogNumber",
        "date",
        "carrier",
      ],
      facts: {
        manifestEntryKey: contract.manifestEntryKey,
        verified: "true",
        unique: "true",
        provenanceSourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000010906601",
        fixedRecordId: "R100000002-I000010906601",
        canonicalArtist: "松田聖子",
        observedArtist: "Seiko",
        artistCredit: "SEIKO",
        title: "Who's that boy",
        catalogNumber: "SRCL-20090",
        date: "2010-05",
        carrier: "BLU_SPEC_CD",
      },
    }),
  ];
}

function seikoWhosCandidate(
  observations = seikoWhosSubstitutionObservations(),
): ComprehensiveEvidenceCandidate {
  return evidenceCandidate({
    candidateId: "seiko-whos-that-boy",
    workId: "curated-seiko-single-29",
    editionId: "curated-seiko-single-29:srcl-20090",
    title: "Who's that boy",
    artistCredit: "SEIKO",
    observations,
  });
}

test("Seiko Who's that boy exact four-source chain may replace MusicBrainz identity", () => {
  const candidate = seikoWhosCandidate();
  assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(candidate), true);
  assert.deepEqual(classifyComprehensiveEvidence(candidate), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
});

test("Seiko Who's fixed four-source contract cannot fall through to generic substitutes", () => {
  const base = seikoWhosSubstitutionObservations().filter((item) =>
    item.provider !== SEIKO_WHOS_IDENTITY_SUBSTITUTE.sonyProvider &&
    item.provider !== SEIKO_WHOS_IDENTITY_SUBSTITUTE.ndlProvider);
  const generic = observation("generic-discogs", {
    provider: "discogs",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    reasonCode: "DISCOGS_EXACT_EDITION_MATCH",
    matchedFields: ["artist", "title", "catalogNumber", "year"],
    facts: {
      artist: "Wrong Artist",
      title: "Wrong Title",
      catalogNumber: "73523",
      year: "1990",
    },
  });
  const candidate = seikoWhosCandidate([...base, generic]);
  assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(candidate), false);
  assert.equal(classifyComprehensiveEvidence(candidate).eligibleForAi, false);
});

test("Seiko Who's substitute requires exactly one of every trusted identity component", () => {
  const identityIds = [
    "seiko-whos-manifest",
    "seiko-whos-entity",
    "seiko-whos-sony-box",
    "seiko-whos-ndl",
  ];
  const cases: Array<[string, ComprehensiveEvidenceObservation[]]> = [];
  for (const id of identityIds) {
    const missing = structuredClone(seikoWhosSubstitutionObservations())
      .filter((item) => item.id !== id);
    cases.push([`missing ${id}`, missing]);

    const duplicate = structuredClone(seikoWhosSubstitutionObservations());
    duplicate.push({
      ...structuredClone(duplicate.find((item) => item.id === id)!),
      id: `${id}-duplicate`,
    });
    cases.push([`duplicate ${id}`, duplicate]);
  }
  for (const [label, observations] of cases) {
    const candidate = seikoWhosCandidate(observations);
    assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(candidate), false, label);
    assert.equal(classifyComprehensiveEvidence(candidate).eligibleForAi, false, label);
  }
});

test("Seiko Who's substitute rejects every critical fact or provenance conflict", () => {
  const cases: Array<[string, (items: ComprehensiveEvidenceObservation[]) => void]> = [
    ["manifest key", (items) => {
      items[0]!.facts!.manifestEntryKey = "SINGLE:30";
    }],
    ["manifest artist", (items) => {
      items[0]!.facts!.artist = "中森明菜";
    }],
    ["manifest artist credit", (items) => {
      items[0]!.facts!.artistCredits = "松田聖子";
    }],
    ["manifest title", (items) => {
      items[0]!.facts!.title = "Who's that girl";
    }],
    ["manifest date", (items) => {
      items[0]!.facts!.date = "1990-10-02";
    }],
    ["manifest pretends MB date support", (items) => {
      items[0]!.facts!.dateSupport = "MUSICBRAINZ_EXACT";
    }],
    ["entity verified", (items) => {
      items[2]!.facts!.verified = "false";
    }],
    ["entity unique", (items) => {
      items[2]!.facts!.unique = "false";
    }],
    ["entity provenance", (items) => {
      items[2]!.facts!.provenanceSourceUrl = "https://example.com/entity";
    }],
    ["entity artist", (items) => {
      items[2]!.facts!.artist = "Seiko";
    }],
    ["entity title", (items) => {
      items[2]!.facts!.title = "Who's that girl";
    }],
    ["entity original catalog", (items) => {
      items[2]!.facts!.originalCatalogNumber = "73524";
    }],
    ["entity date differs from manifest", (items) => {
      items[2]!.facts!.date = "1990-10-02";
    }],
    ["Sony verified", (items) => {
      items[3]!.facts!.verified = "false";
    }],
    ["Sony unique", (items) => {
      items[3]!.facts!.unique = "false";
    }],
    ["Sony observed title", (items) => {
      items[3]!.facts!.observedTitle = "WHO IS THAT BOY";
    }],
    ["Sony box date", (items) => {
      items[3]!.facts!.date = "2010-06-26";
    }],
    ["Sony catalog range", (items) => {
      items[3]!.facts!.catalogEnd = "SRCL-20089";
    }],
    ["Sony carrier", (items) => {
      items[3]!.facts!.carrier = "CD";
    }],
    ["Sony completeness", (items) => {
      items[3]!.facts!.completeSinglesCount = "72";
    }],
    ["NDL verified", (items) => {
      items[4]!.facts!.verified = "false";
    }],
    ["NDL unique", (items) => {
      items[4]!.facts!.unique = "false";
    }],
    ["NDL record provenance", (items) => {
      items[4]!.facts!.fixedRecordId = "R100000002-I000010906602";
    }],
    ["NDL artist", (items) => {
      items[4]!.facts!.observedArtist = "Various Artists";
    }],
    ["NDL title", (items) => {
      items[4]!.facts!.title = "Who's that girl";
    }],
    ["NDL catalog", (items) => {
      items[4]!.facts!.catalogNumber = "SRCL-20091";
    }],
    ["NDL month conflicts with Sony", (items) => {
      items[4]!.facts!.date = "2010-06";
    }],
    ["NDL carrier conflicts with Sony", (items) => {
      items[4]!.facts!.carrier = "CASSETTE";
    }],
    ["missing required NDL matched field", (items) => {
      items[4]!.matchedFields = items[4]!.matchedFields.filter((field) => field !== "carrier");
    }],
    ["wrong Sony source URL", (items) => {
      items[3]!.sourceUrl = "https://example.com/box";
    }],
    ["wrong NDL reason code", (items) => {
      items[4]!.reasonCode = "GENERIC_NDL_MATCH";
    }],
  ];
  for (const [label, mutate] of cases) {
    const observations = structuredClone(seikoWhosSubstitutionObservations());
    mutate(observations);
    const candidate = seikoWhosCandidate(observations);
    assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(candidate), false, label);
    assert.equal(classifyComprehensiveEvidence(candidate).eligibleForAi, false, label);
  }
});

test("Seiko Who's substitute is not a global title, artist, or manifest-key relaxation", () => {
  const title = seikoWhosCandidate();
  title.title = "Who's that girl";
  assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(title), false);
  assert.equal(classifyComprehensiveEvidence(title).eligibleForAi, false);

  const artist = seikoWhosCandidate();
  artist.artistCredit = "松田聖子";
  assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(artist), false);
  assert.equal(classifyComprehensiveEvidence(artist).eligibleForAi, false);

  const key = seikoWhosSubstitutionObservations();
  for (const item of key) {
    if (item.facts?.manifestEntryKey) item.facts.manifestEntryKey = "SINGLE:30";
  }
  const wrongKey = seikoWhosCandidate(key);
  assert.equal(hasSeikoWhosThatBoyIdentitySubstitute(wrongKey), false);
  assert.equal(classifyComprehensiveEvidence(wrongKey).eligibleForAi, false);
});

test("a non-MusicBrainz authority without a stable independent edition stays pending", () => {
  const candidate = evidenceCandidate({
    observations: [
      observation("ndl", {
        provider: "ndl-search",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        matchedFields: ["artist", "title", "catalogNumber", "date"],
      }),
      observation("discogs", {
        provider: "discogs",
        role: "CORROBORATING",
        strength: "SUPPORTING",
        stage: "CORROBORATION",
        matchedFields: ["title"],
      }),
    ],
  });
  assert.equal(classifyComprehensiveEvidence(candidate).verdict, "UNKNOWN");
  assert.equal(
    classifyComprehensiveEvidence(candidate).reasonCode,
    "MISSING_INDEPENDENT_CORROBORATION",
  );
});

test("matched-field labels cannot hide conflicting catalog or year facts", () => {
  const baseAuthority = observation("ndl", {
    provider: "ndl-search",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    matchedFields: ["artist", "title", "catalogNumber", "date"],
  });
  for (const facts of [
    { catalogNumber: "WRONG-1", year: "1988" },
    { catalogNumber: "K32X-240", year: "1999" },
  ]) {
    const candidate = evidenceCandidate({
      observations: [
        baseAuthority,
        observation("discogs", {
          provider: "discogs",
          role: "CORROBORATING",
          strength: "SUPPORTING",
          stage: "CORROBORATION",
          matchedFields: ["title", "catalogNumber", "year", "country", "format"],
          facts,
        }),
      ],
    });
    assert.equal(classifyComprehensiveEvidence(candidate).eligibleForAi, false);
  }
});

test("missing, ambiguous, or temporarily unavailable authority remains UNKNOWN", () => {
  const candidate = evidenceCandidate({
    observations: [
      observation("mb"),
      observation("ndl", {
        provider: "ndl-search",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        verdict: "UNKNOWN",
        reasonCode: "NDL_AMBIGUOUS",
        reason: "More than one bibliography row matched.",
        retryable: true,
      }),
    ],
  });
  assert.equal(classifyComprehensiveEvidence(candidate).verdict, "UNKNOWN");
  assert.equal(classifyComprehensiveEvidence(candidate).reasonCode, "MISSING_STRONG_AUTHORITY");
});

test("unknown country, format, or status stays pending instead of bypassing scope through authority", () => {
  const candidate = evidenceCandidate({
    observations: [
      observation("mb"),
      observation("scope", {
        provider: "musicbrainz",
        role: "DISCOVERY",
        stage: "SCOPE",
        verdict: "UNKNOWN",
        reasonCode: "MB_FORMAT_UNKNOWN",
      }),
      observation("official", {
        provider: "king-records",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
      }),
    ],
  });
  assert.deepEqual(classifyComprehensiveEvidence(candidate), {
    verdict: "UNKNOWN",
    reasonCode: "SCOPE_UNRESOLVED",
    eligibleForAi: false,
  });
});

test("an explicit MusicBrainz country and format PASS is not erased by weaker Discogs scope ambiguity", () => {
  const candidate = evidenceCandidate({
    observations: [
      observation("mb"),
      observation("mb-scope", {
        provider: "musicbrainz",
        role: "DISCOVERY",
        stage: "SCOPE",
        verdict: "PASS",
        reasonCode: "MB_SCOPE_MATCH",
        matchedFields: ["country", "format"],
      }),
      observation("official", {
        provider: "king-records",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
      }),
      observation("discogs-scope", {
        provider: "discogs",
        role: "DISCOVERY",
        stage: "SCOPE",
        verdict: "UNKNOWN",
        reasonCode: "DISCOGS_SCOPE_ROWS_CONFLICT",
        matchedFields: ["country", "format"],
      }),
    ],
  });
  assert.deepEqual(classifyComprehensiveEvidence(candidate), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
});

test("only an EXPLICIT conflict rejects before AI; AI_REVIEW stays eligible", () => {
  const reviewable = evidenceCandidate({
    conflicts: [{
      id: "title-script",
      certainty: "AI_REVIEW",
      reasonCode: "TITLE_CONFLICT",
      field: "title",
      sourceObservationIds: ["mb", "official"],
      message: "The supplied titles need cross-script comparison.",
    }],
  });
  assert.equal(classifyComprehensiveEvidence(reviewable).verdict, "PASS");

  const explicit = evidenceCandidate({
    conflicts: [{
      id: "barcode-conflict",
      certainty: "EXPLICIT",
      reasonCode: "BARCODE_CONFLICT",
      field: "barcode",
      sourceObservationIds: ["mb", "official"],
      message: "Two complete barcodes conflict.",
    }],
  });
  assert.equal(classifyComprehensiveEvidence(explicit).verdict, "REJECT");
});

test("evidence-ready candidates without semantic questions are accepted without calling AI", async () => {
  let calls = 0;
  const decisions = await auditComprehensiveEvidenceWithAi([evidenceCandidate()], undefined, {
    createResponse: async () => {
      calls += 1;
      throw new Error("AI must not run for deterministic evidence");
    },
  });
  assert.equal(calls, 0);
  assert.equal(decisions[0]?.decision, "ACCEPT");
  assert.match(decisions[0]?.reason ?? "", /Deterministic evidence gates passed/u);
});

test("an AI_REVIEW semantic question still calls AI and may remain UNKNOWN", async () => {
  let calls = 0;
  const candidate = evidenceCandidate({
    conflicts: [{
      id: "title-script",
      certainty: "AI_REVIEW",
      reasonCode: "TITLE_CONFLICT",
      field: "title",
      sourceObservationIds: ["mb", "official"],
      message: "The supplied titles need cross-script comparison.",
    }],
  });
  const decisions = await auditComprehensiveEvidenceWithAi([candidate], undefined, {
    createResponse: async () => {
      calls += 1;
      return {
        output_text: JSON.stringify({ decisions: [{
          candidateId: "candidate-1",
          decision: "UNKNOWN",
          reasonCode: "INSUFFICIENT_EVIDENCE",
          reason: "The supplied title relationship cannot be resolved safely.",
          conflictIds: [],
        }] }),
      } as never;
    },
  });
  assert.equal(calls, 1);
  assert.equal(decisions[0]?.decision, "UNKNOWN");
});

test("AI may reject only a supplied AI_REVIEW conflict", () => {
  const candidate = evidenceCandidate({
    conflicts: [{
      id: "title-script",
      certainty: "AI_REVIEW",
      reasonCode: "TITLE_CONFLICT",
      field: "title",
      sourceObservationIds: ["mb", "official"],
      message: "The supplied titles need semantic comparison.",
    }],
  });
  const valid = validateComprehensiveAiDecisions([{
    candidateId: "candidate-1",
    decision: "REJECT",
    reasonCode: "TITLE_CONFLICT",
    reason: "The supplied titles denote different works.",
    conflictIds: ["title-script"],
  }], [candidate]);
  assert.equal(valid[0]?.decision, "REJECT");

  assert.throws(() => validateComprehensiveAiDecisions([{
    candidateId: "candidate-1",
    decision: "REJECT",
    reasonCode: "TITLE_CONFLICT",
    reason: "An invented conflict.",
    conflictIds: ["not-supplied"],
  }], [candidate]), /invented or misclassified/);
});
