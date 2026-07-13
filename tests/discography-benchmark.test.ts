import assert from "node:assert/strict";
import test from "node:test";
import {
  assessArtistFinalAcceptanceEligibility,
  assessSourceOnlyRecall,
  evaluateArtistBenchmark,
  fetchMusicBrainzReleaseGroups,
  findArtistBenchmark,
  isTrustedBenchmarkCoverUrl,
  isTrustedBenchmarkEvidenceUrl,
  loadBenchmarkManifest,
  normalizeBenchmarkText,
  parseApplicationOutput,
  parseBenchmarkCliArgs,
  selectFinalAcceptanceSuiteFixtures,
  validateBenchmarkManifest,
  type ArtistBenchmark,
  type BenchmarkThresholds,
  type WorkAnchor,
} from "../scripts/benchmark-discographies";

const evidenceUrl = "https://musicbrainz.org/release-group/00000000-0000-4000-8000-000000000001";
const coverUrl = "https://coverartarchive.org/release/00000000-0000-4000-8000-000000000002/front-500";

function release(title: string, category: string, overrides: Record<string, unknown> = {}) {
  return {
    title,
    category,
    sources: [{ url: evidenceUrl }],
    coverImageUrl: coverUrl,
    ...overrides,
  };
}

function completeRows(fixture: ArtistBenchmark) {
  const rows: Array<Record<string, unknown>> = fixture.baselines.flatMap((baseline) =>
    (baseline.expectedWorks ?? [])
      .filter((work) => baseline.officialCatalogTotal === undefined ||
        work.mediaScope?.physicalCd === "ORIGINAL_RELEASE" ||
        work.mediaScope?.physicalCd === "LATER_OFFICIAL_EDITION")
      .map((work) => release(
      work.title,
      work.category,
      work.originalReleaseDate ? { originalReleaseDate: work.originalReleaseDate } : {},
    )));
  for (const anchor of fixture.requiredAnchors) {
    const variants = new Set([anchor.title, ...(anchor.aliases ?? [])].map(normalizeBenchmarkText));
    const existing = rows.find((row) =>
      row.category === anchor.category &&
      variants.has(normalizeBenchmarkText(String(row.title))));
    if (existing && anchor.originalReleaseDate) {
      existing.originalReleaseDate = anchor.originalReleaseDate;
    } else if (!existing) {
      rows.push(release(
        anchor.title,
        anchor.category,
        anchor.originalReleaseDate ? { originalReleaseDate: anchor.originalReleaseDate } : {},
      ));
    }
  }
  const countByCategory = new Map<string, number>();
  for (const row of rows) {
    const category = String(row.category);
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
  }
  for (const baseline of fixture.baselines) {
    const existing = countByCategory.get(baseline.category) ?? 0;
    for (let index = existing; index < baseline.expected; index += 1) {
      rows.push(release(`fixture-${fixture.slug}-${baseline.category}-${index + 1}`, baseline.category));
    }
  }
  return rows;
}

function fixtureWithCanonicalWorks(
  fixture: ArtistBenchmark,
  kind: "exact" | "minimum",
  expectedWorks: WorkAnchor[],
  asOf = "2020-12-31",
): ArtistBenchmark {
  const baseline = fixture.baselines[0]!;
  return {
    ...fixture,
    catalogStatus: kind === "exact" ? "fixed" : "active",
    requiredAnchors: [],
    negativeAnchors: [],
    scope: {
      ...fixture.scope,
      includedCategories: [baseline.category],
    },
    baselines: [{
      ...baseline,
      kind,
      expected: expectedWorks.length,
      expectedWorks,
      asOf,
    }],
  };
}

test("versioned benchmark fixture has the required diverse artists and authoritative provenance", async () => {
  const manifest = await loadBenchmarkManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.grain, "work");
  assert.equal(manifest.asOf, "2026-07-13");
  assert.equal(manifest.artists.length, 8);

  const requiredNames = ["中山美穂", "松田聖子", "中森明菜", "小泉今日子", "山口百恵", "松任谷由実"];
  for (const name of requiredNames) {
    assert.ok(findArtistBenchmark(manifest, name), `${name} must be present`);
  }
  assert.ok(findArtistBenchmark(manifest, "Teresa Teng"));
  assert.ok(findArtistBenchmark(manifest, "ビートルズ"));

  for (const fixture of manifest.artists) {
    assert.ok(fixture.baselines.length > 0);
    assert.ok(fixture.requiredAnchors.length >= 4);
    assert.match(fixture.artist.musicbrainzArtistId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    for (const baseline of fixture.baselines) {
      assert.ok(baseline.expected > 0);
      assert.match(baseline.asOf, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(baseline.scopeNote.length > 20);
      assert.ok(baseline.sources.every((source) => source.url.startsWith("https://")));
      assert.ok(baseline.sources.every((source) => source.authority.length > 0 && source.note.length > 0));
    }
  }
});

test("only complete and fresh fixtures qualify for the versioned final suite", async () => {
  const manifest = await loadBenchmarkManifest();
  assert.deepEqual(
    selectFinalAcceptanceSuiteFixtures(manifest).map((fixture) => fixture.slug),
    ["miho-nakayama", "seiko-matsuda", "akina-nakamori", "momoe-yamaguchi"],
  );
  assert.equal(manifest.finalAcceptanceSuite?.minimumOriginalCdWorks, 50);
  assert.deepEqual(
    selectFinalAcceptanceSuiteFixtures(manifest).map((fixture) => [
      fixture.slug,
      fixture.baselines.reduce((total, baseline) => total + baseline.expected, 0),
    ]),
    [
      ["miho-nakayama", 61],
      ["seiko-matsuda", 131],
      ["akina-nakamori", 79],
      ["momoe-yamaguchi", 54],
    ],
  );
  const seiko = findArtistBenchmark(manifest, "seiko-matsuda");
  const teresa = findArtistBenchmark(manifest, "teresa-teng");
  assert.ok(seiko && teresa);
  assert.equal(assessArtistFinalAcceptanceEligibility(manifest, seiko).eligible, true);
  assert.equal(assessArtistFinalAcceptanceEligibility(manifest, teresa).eligible, false);
  assert.ok(assessArtistFinalAcceptanceEligibility(manifest, teresa).reasons.some((reason) =>
    reason.includes("expectedWorks")));
  const miho = findArtistBenchmark(manifest, "miho-nakayama");
  assert.ok(miho);
  const expired = assessArtistFinalAcceptanceEligibility(
    manifest,
    miho,
    new Date("2027-01-01T00:00:00.000Z"),
  );
  assert.equal(expired.eligible, false);
  assert.ok(expired.reasons.some((reason) => reason.includes("manifest snapshot")));

  const undersized = structuredClone(miho);
  undersized.baselines = [
    { ...undersized.baselines[0]!, expected: 1, expectedWorks: undersized.baselines[0]!.expectedWorks!.slice(0, 1) },
  ];
  undersized.scope.includedCategories = [undersized.baselines[0]!.category];
  const undersizedEligibility = assessArtistFinalAcceptanceEligibility(manifest, undersized);
  assert.equal(undersizedEligibility.eligible, false);
  assert.ok(undersizedEligibility.reasons.some((reason) => reason.includes("at least 50")));

  const incompleteScope = structuredClone(miho);
  incompleteScope.scope.includedCategories.push("EP");
  const incompleteScopeEligibility = assessArtistFinalAcceptanceEligibility(manifest, incompleteScope);
  assert.equal(incompleteScopeEligibility.eligible, false);
  assert.ok(incompleteScopeEligibility.reasons.some((reason) => reason.includes("has no baseline")));

  const staleActiveSnapshot = structuredClone(seiko);
  staleActiveSnapshot.baselines[0]!.snapshotVerifiedAt = "2026-07-12";
  const staleActiveEligibility = assessArtistFinalAcceptanceEligibility(manifest, staleActiveSnapshot);
  assert.equal(staleActiveEligibility.eligible, false);
  assert.ok(staleActiveEligibility.reasons.some((reason) => reason.includes("must match")));
});

test("active final snapshots are exact even though diagnostics remain future-extensible", async () => {
  const manifest = await loadBenchmarkManifest();
  for (const slug of ["seiko-matsuda", "akina-nakamori"]) {
    const fixture = findArtistBenchmark(manifest, slug);
    assert.ok(fixture);
    const canonical = completeRows(fixture);
    const finalReport = evaluateArtistBenchmark(
      fixture,
      canonical,
      [],
      manifest.defaultMetrics,
      { finalAcceptance: true, manifestAsOf: manifest.asOf },
    );
    assert.equal(finalReport.passed, true, `${slug} current exact snapshot must pass`);

    const future = release(`unmanifested-${slug}`, fixture.baselines[0]!.category, {
      workId: `future-${slug}`,
      originalReleaseDate: "2026-07-14",
    });
    assert.equal(
      evaluateArtistBenchmark(
        fixture,
        [...canonical, future],
        [],
        manifest.defaultMetrics,
      ).passed,
      true,
      `${slug} diagnostic mode keeps active future-growth semantics`,
    );
    const closed = evaluateArtistBenchmark(
      fixture,
      [...canonical, future],
      [],
      manifest.defaultMetrics,
      { finalAcceptance: true, manifestAsOf: manifest.asOf },
    );
    assert.equal(closed.passed, false);
    assert.ok(closed.extra.some((item) => item.reasonCode === "UNMANIFESTED_FINAL_WORK"));
  }
});

test("fixed catalogs use exact counts while active catalogs use dated minimums", async () => {
  const manifest = await loadBenchmarkManifest();
  for (const fixture of manifest.artists) {
    const kinds = new Set(fixture.baselines.map((baseline) => baseline.kind));
    if (fixture.catalogStatus === "fixed") assert.deepEqual(kinds, new Set(["exact"]));
    else assert.deepEqual(kinds, new Set(["minimum"]));
  }

  assert.equal(findArtistBenchmark(manifest, "中山美穂")?.baselines.find((item) => item.category === "SINGLE")?.expected, 39);
  assert.equal(findArtistBenchmark(manifest, "山口百恵")?.baselines.find((item) => item.category === "ORIGINAL_ALBUM")?.expected, 22);
  const akina = findArtistBenchmark(manifest, "中森明菜");
  const akinaSingles = akina?.baselines.find((item) => item.category === "SINGLE");
  assert.equal(akinaSingles?.expected, 54);
  assert.equal(akinaSingles?.officialCatalogTotal, 55);
  assert.equal(akinaSingles?.finalSnapshotKind, "exact");
  assert.equal(akinaSingles?.snapshotVerifiedAt, "2026-07-13");
  assert.equal(akinaSingles?.expectedWorks?.length, 55);
  assert.equal(akinaSingles?.expectedWorks?.filter((work) =>
    work.mediaScope?.physicalCd === "ORIGINAL_RELEASE" ||
    work.mediaScope?.physicalCd === "LATER_OFFICIAL_EDITION").length, 54);
  assert.deepEqual(
    akinaSingles?.expectedWorks?.find((work) => work.title === "ノンフィクション エクスタシー")?.mediaScope,
    {
      originalFormats: ["CASSETTE"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      physicalCdAuthorityUrls: ["https://wmg.jp/akina/discography/11915/"],
      physicalCdReleaseDate: "2014-06-18",
      physicalCdCatalogNumber: "WPCL-11871/98",
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
      physicalCdContainerTitle: "Singles Box 1982-1991",
    },
  );
  assert.deepEqual(
    akinaSingles?.expectedWorks?.find((work) => work.title === "Crazy Love")?.mediaScope,
    {
      originalFormats: ["DIGITAL"],
      physicalCd: "NONE",
      physicalCdAuthorityUrls: [],
      physicalCdReleaseDate: null,
      physicalCdCatalogNumber: null,
      exclusionReason: "DIGITAL_ONLY",
    },
  );
  assert.equal(
    akinaSingles?.expectedWorks?.find((work) => work.title === "It's brand new day")?.mediaScope
      ?.physicalCd,
    "LATER_OFFICIAL_EDITION",
  );
  assert.equal(
    akinaSingles?.expectedWorks?.find((work) => work.title === "TATTOO")?.mediaScope
      ?.physicalCd,
    "ORIGINAL_RELEASE",
  );
  const akinaAlbums = akina?.baselines.find((item) =>
    item.category === "ORIGINAL_ALBUM");
  assert.equal(akinaAlbums?.expected, 25);
  assert.equal(akinaAlbums?.expectedWorks?.length, 25);
  const seikoAlbums = findArtistBenchmark(manifest, "松田聖子")?.baselines.find((item) =>
    item.category === "ORIGINAL_ALBUM");
  assert.equal(seikoAlbums?.expected, 54);
  assert.equal(seikoAlbums?.asOf, "2021-10-20");
  assert.equal(seikoAlbums?.expectedWorks?.length, 54);
  assert.equal(seikoAlbums?.expectedWorks?.every((work) => work.mediaScope !== undefined), true);
  assert.equal(findArtistBenchmark(manifest, "松任谷由実")?.baselines[0]?.expected, 40);

  const invalidKind = structuredClone(manifest);
  invalidKind.artists[0]!.baselines[0]!.kind = "minimum";
  assert.throws(
    () => validateBenchmarkManifest(invalidKind),
    /must use exact baselines for a fixed catalog/,
  );

  const invalidThreshold = structuredClone(manifest);
  invalidThreshold.artists[0]!.metrics = { minimumCoverCoverage: -0.1 };
  assert.throws(
    () => validateBenchmarkManifest(invalidThreshold),
    /minimumCoverCoverage must be 0\.\.1/,
  );

  const invalidSuiteMinimum = structuredClone(manifest);
  invalidSuiteMinimum.finalAcceptanceSuite!.minimumOriginalCdWorks = 0;
  assert.throws(
    () => validateBenchmarkManifest(invalidSuiteMinimum),
    /minimumOriginalCdWorks must be 1\.\.1000/,
  );
});

test("optional canonical manifests validate count, category, and normalized title uniqueness", async () => {
  const manifest = await loadBenchmarkManifest();
  const valid = structuredClone(manifest);
  const baseline = valid.artists[0]!.baselines[0]!;
  baseline.expected = 2;
  baseline.expectedWorks = [
    {
      title: "Canonical A",
      aliases: ["Canonical A alias"],
      category: baseline.category,
      originalReleaseDate: "1980-01-01",
      mediaScope: {
        originalFormats: ["CASSETTE"],
        physicalCd: "NONE",
        exclusionReason: "CASSETTE_ONLY",
      },
    },
    {
      title: "Canonical B",
      category: baseline.category,
      originalReleaseDate: "1980-02-01",
    },
  ];
  assert.doesNotThrow(() => validateBenchmarkManifest(valid));

  const carrierScopedOfficialCanon = structuredClone(valid);
  const carrierBaseline = carrierScopedOfficialCanon.artists[0]!.baselines[0]!;
  carrierBaseline.expected = 1;
  carrierBaseline.officialCatalogTotal = 2;
  carrierBaseline.expectedWorks![1]!.mediaScope = {
    originalFormats: ["CD"],
    physicalCd: "ORIGINAL_RELEASE",
    physicalCdAuthorityUrls: [],
    physicalCdReleaseDate: "1980-02-01",
    physicalCdCatalogNumber: "TEST-2",
  };
  assert.doesNotThrow(() => validateBenchmarkManifest(carrierScopedOfficialCanon));

  const wrongScopedCount = structuredClone(carrierScopedOfficialCanon);
  wrongScopedCount.artists[0]!.baselines[0]!.expected = 2;
  assert.throws(
    () => validateBenchmarkManifest(wrongScopedCount),
    /expected must equal the 1 ORIGINAL_CD-scope works/,
  );

  const missingScopedMedia = structuredClone(carrierScopedOfficialCanon);
  delete missingScopedMedia.artists[0]!.baselines[0]!.expectedWorks![1]!.mediaScope;
  assert.throws(
    () => validateBenchmarkManifest(missingScopedMedia),
    /officialCatalogTotal requires mediaScope on every expected work/,
  );

  const wrongCount = structuredClone(valid);
  wrongCount.artists[0]!.baselines[0]!.expectedWorks!.pop();
  assert.throws(
    () => validateBenchmarkManifest(wrongCount),
    /expectedWorks must contain exactly 2 works/,
  );

  const wrongCategory = structuredClone(valid);
  wrongCategory.artists[0]!.baselines[0]!.expectedWorks![0]!.category = "ORIGINAL_ALBUM";
  assert.throws(
    () => validateBenchmarkManifest(wrongCategory),
    /category must equal baseline category/,
  );

  const duplicateTitle = structuredClone(valid);
  duplicateTitle.artists[0]!.baselines[0]!.expectedWorks![0]!.title = "「C」";
  duplicateTitle.artists[0]!.baselines[0]!.expectedWorks![1]!.title = "C";
  assert.throws(
    () => validateBenchmarkManifest(duplicateTitle),
    /expectedWorks titles and aliases must be unique/,
  );

  const contradictoryMedia = structuredClone(valid);
  contradictoryMedia.artists[0]!.baselines[0]!.expectedWorks![0]!.mediaScope = {
    originalFormats: ["CASSETTE"],
    physicalCd: "ORIGINAL_RELEASE",
  };
  assert.throws(
    () => validateBenchmarkManifest(contradictoryMedia),
    /requires CD in originalFormats/,
  );

  const unprovenLaterCd = structuredClone(valid);
  unprovenLaterCd.artists[0]!.baselines[0]!.expectedWorks![0]!.mediaScope = {
    originalFormats: ["VINYL"],
    physicalCd: "LATER_OFFICIAL_EDITION",
  };
  assert.throws(
    () => validateBenchmarkManifest(unprovenLaterCd),
    /requires physicalCdAuthorityUrls/,
  );
});

test("a complete exact catalog with evidence and covers passes", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = findArtistBenchmark(manifest, "miho-nakayama");
  assert.ok(fixture);
  const report = evaluateArtistBenchmark(fixture, completeRows(fixture), [], manifest.defaultMetrics);

  assert.equal(report.passed, true);
  assert.equal(report.summary.uniqueCoreWorks, 61);
  assert.deepEqual(report.baselines.map(({ actual }) => actual), [39, 22]);
  assert.equal(report.metrics.anchorRecall, 1);
  assert.equal(report.metrics.coreRecall, 1);
  assert.equal(report.metrics.evidenceCoverage, 1);
  assert.equal(report.metrics.coverCoverage, 1);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.pendingEvidence, []);
  assert.deepEqual(report.pendingCover, []);
});

test("fixed canonical manifests reject substitutions even when the exact count still matches", async () => {
  const manifest = await loadBenchmarkManifest();
  const base = findArtistBenchmark(manifest, "miho-nakayama");
  assert.ok(base);
  const expectedWorks: WorkAnchor[] = [
    {
      title: "Canonical A",
      aliases: ["Ａ alias"],
      category: "SINGLE",
      originalReleaseDate: "1980-01-01",
    },
    {
      title: "Canonical B",
      category: "SINGLE",
      originalReleaseDate: "1980-02-01",
    },
  ];
  const fixture = fixtureWithCanonicalWorks(base, "exact", expectedWorks);
  const passing = evaluateArtistBenchmark(fixture, [
    release("Ａ alias", "SINGLE", { originalReleaseDate: "1980-01-01" }),
    release("Canonical B", "SINGLE", { originalReleaseDate: "1980-02-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(passing.passed, true);
  assert.ok(!passing.missing.some((item) => item.reasonCode === "CANONICAL_WORK_MISSING"));
  assert.ok(!passing.extra.some((item) => item.reasonCode === "NON_CANONICAL_WORK"));

  const substitution = evaluateArtistBenchmark(fixture, [
    release("Ａ alias", "SINGLE", { originalReleaseDate: "1980-01-01" }),
    release("Invented replacement", "SINGLE", { originalReleaseDate: "1980-02-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(substitution.baselines[0]?.met, true);
  assert.equal(substitution.passed, false);
  assert.ok(substitution.missing.some((item) =>
    item.reasonCode === "CANONICAL_WORK_MISSING" && item.title === "Canonical B"));
  assert.ok(substitution.extra.some((item) =>
    item.reasonCode === "NON_CANONICAL_WORK" && item.title === "Invented replacement"));

  const wrongDate = evaluateArtistBenchmark(fixture, [
    release("Canonical A", "SINGLE", { originalReleaseDate: "1980-01-02" }),
    release("Canonical B", "SINGLE", { originalReleaseDate: "1980-02-01" }),
  ], [], manifest.defaultMetrics);
  assert.ok(wrongDate.missing.some((item) =>
    item.reasonCode === "CANONICAL_WORK_MISSING" && item.title === "Canonical A"));
  assert.ok(wrongDate.extra.some((item) =>
    item.reasonCode === "CANONICAL_TITLE_DATE_CONFLICT" && item.title === "Canonical A"));

  const sourceAssessment = assessSourceOnlyRecall(substitution);
  assert.equal(sourceAssessment.passed, false);
  assert.equal(sourceAssessment.canonicalWorkGateMet, false);
  assert.deepEqual(sourceAssessment.missingAnchorTitles, ["Canonical B"]);
  assert.deepEqual(sourceAssessment.nonCanonicalTitles, ["Invented replacement"]);
});

test("active canonical manifests gate historical and undated rows but allow dated post-cutoff works", async () => {
  const manifest = await loadBenchmarkManifest();
  const base = findArtistBenchmark(manifest, "akina-nakamori");
  assert.ok(base);
  const expectedWorks: WorkAnchor[] = [
    {
      title: "Historical A",
      category: "SINGLE",
      originalReleaseDate: "2019-01-01",
    },
    {
      title: "Historical B",
      aliases: ["Historical Bee"],
      category: "SINGLE",
      originalReleaseDate: "2020-06-01",
    },
  ];
  const fixture = fixtureWithCanonicalWorks(base, "minimum", expectedWorks, "2020-12-31");
  const acceptedFuture = evaluateArtistBenchmark(fixture, [
    release("Historical A", "SINGLE", { originalReleaseDate: "2019-01-01" }),
    release("Historical Bee", "SINGLE", { originalReleaseDate: "2020-06-01" }),
    release("Legitimate future work", "SINGLE", { originalReleaseDate: "2021-01-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(acceptedFuture.passed, true);
  assert.equal(acceptedFuture.baselines[0]?.actual, 3);
  assert.ok(!acceptedFuture.extra.some((item) => item.reasonCode === "NON_CANONICAL_WORK"));
  const closedFinal = evaluateArtistBenchmark(
    fixture,
    [
      release("Historical A", "SINGLE", { originalReleaseDate: "2019-01-01" }),
      release("Historical Bee", "SINGLE", { originalReleaseDate: "2020-06-01" }),
      release("Legitimate future work", "SINGLE", { originalReleaseDate: "2021-01-01" }),
    ],
    [],
    manifest.defaultMetrics,
    { finalAcceptance: true, manifestAsOf: "2021-12-31" },
  );
  assert.equal(closedFinal.passed, false);
  assert.ok(closedFinal.extra.some((item) =>
    item.reasonCode === "UNMANIFESTED_FINAL_WORK" && item.title === "Legitimate future work"));

  const historicalImpostors = evaluateArtistBenchmark(fixture, [
    release("Historical A", "SINGLE", { originalReleaseDate: "2019-01-01" }),
    release("Historical B", "SINGLE", { originalReleaseDate: "2020-06-01" }),
    release("Historical impostor", "SINGLE", { originalReleaseDate: "2020-12-31" }),
    release("Undated impostor", "SINGLE"),
    release("Another future work", "SINGLE", { originalReleaseDate: "2022-01-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(historicalImpostors.baselines[0]?.met, true);
  assert.equal(historicalImpostors.passed, false);
  assert.deepEqual(historicalImpostors.extra
    .filter((item) => item.reasonCode === "NON_CANONICAL_WORK")
    .map((item) => item.title), ["Historical impostor", "Undated impostor"]);

  const maskedMissing = evaluateArtistBenchmark(fixture, [
    release("Historical A", "SINGLE", { originalReleaseDate: "2019-01-01" }),
    release("Future one", "SINGLE", { originalReleaseDate: "2021-01-01" }),
    release("Future two", "SINGLE", { originalReleaseDate: "2022-01-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(maskedMissing.baselines[0]?.met, true);
  assert.equal(maskedMissing.passed, false);
  assert.ok(maskedMissing.missing.some((item) =>
    item.reasonCode === "CANONICAL_WORK_MISSING" && item.title === "Historical B"));
});

test("all final categories and canonical aliases participate in the pass gate", async () => {
  const manifest = await loadBenchmarkManifest();
  const base = findArtistBenchmark(manifest, "akina-nakamori");
  assert.ok(base);
  const expectedWorks: WorkAnchor[] = [{
    title: "Canonical work",
    aliases: ["Canonical alias"],
    category: "SINGLE",
    originalReleaseDate: "2020-01-01",
  }];
  const fixture = fixtureWithCanonicalWorks(base, "minimum", expectedWorks, "2020-12-31");
  const rows = [
    release("Canonical work", "SINGLE", {
      workId: "canonical",
      originalReleaseDate: "2020-01-01",
    }),
    release("Canonical alias", "SINGLE", {
      workId: "alias-duplicate",
      originalReleaseDate: "2020-01-01",
    }),
    release("Invented compilation", "COLLECTION", { workId: "bad-extra" }),
  ];
  const report = evaluateArtistBenchmark(fixture, rows, [], manifest.defaultMetrics);
  assert.equal(report.passed, false);
  assert.ok(report.extra.some((item) => item.reasonCode === "DUPLICATE_CANONICAL_WORK"));
  assert.ok(report.extra.some((item) => item.reasonCode === "UNREQUESTED_FINAL_CATEGORY"));

  const dateConflict = evaluateArtistBenchmark(fixture, [
    rows[0]!,
    release("Canonical alias", "SINGLE", {
      workId: "wrong-date-alias",
      originalReleaseDate: "2021-01-01",
    }),
  ], [], manifest.defaultMetrics);
  assert.equal(dateConflict.passed, false);
  assert.ok(dateConflict.extra.some((item) => item.reasonCode === "CANONICAL_TITLE_DATE_CONFLICT"));
});

test("official numbered works outside ORIGINAL_CD are explained without reducing scoped recall", async () => {
  const manifest = await loadBenchmarkManifest();
  const base = findArtistBenchmark(manifest, "akina-nakamori");
  assert.ok(base);
  const works: WorkAnchor[] = [
    {
      title: "Physical single",
      category: "SINGLE",
      originalReleaseDate: "1986-01-01",
      mediaScope: {
        originalFormats: ["CD"],
        physicalCd: "ORIGINAL_RELEASE",
        physicalCdReleaseDate: "1986-01-01",
        physicalCdCatalogNumber: "TEST-CD-1",
      },
    },
    {
      title: "Cassette-only single",
      category: "SINGLE",
      originalReleaseDate: "1986-02-01",
      mediaScope: {
        originalFormats: ["CASSETTE"],
        physicalCd: "NONE",
        exclusionReason: "CASSETTE_ONLY",
      },
    },
  ];
  const fixture = fixtureWithCanonicalWorks(base, "minimum", works, "2020-12-31");
  fixture.baselines[0]!.officialCatalogTotal = 2;
  fixture.baselines[0]!.expected = 1;

  const scopedOnly = evaluateArtistBenchmark(fixture, [
    release("Physical single", "SINGLE", { originalReleaseDate: "1986-01-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(scopedOnly.passed, true);
  assert.deepEqual(scopedOnly.missing, []);

  const leakedCassette = evaluateArtistBenchmark(fixture, [
    release("Physical single", "SINGLE", { originalReleaseDate: "1986-01-01" }),
    release("Cassette-only single", "SINGLE", { originalReleaseDate: "1986-02-01" }),
  ], [], manifest.defaultMetrics);
  assert.equal(leakedCassette.passed, false);
  assert.ok(leakedCassette.extra.some((item) =>
    item.reasonCode === "OUT_OF_SCOPE_OFFICIAL_WORK" &&
      item.title === "Cassette-only single" &&
      item.note.includes("cassette-only")));
  assert.ok(!leakedCassette.missing.some((item) => item.title === "Cassette-only single"));
});

test("the report separates count loss, duplicate editions, known non-core rows, evidence, cover, and unexplained rejection", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = findArtistBenchmark(manifest, "中山美穂");
  assert.ok(fixture);
  const rows = [
    release("「C」", "SINGLE"),
    release("C", "SINGLE", { releaseDate: "1992-07-22" }),
    release("EXOTIQUE", "ORIGINAL_ALBUM", { sources: [], coverImageUrl: null }),
    release("All Time Best", "ORIGINAL_ALBUM"),
  ];
  const rejections = [
    release("世界中の誰よりきっと", "SINGLE", {
      status: "REJECTED",
      reasonCode: "SOURCE_NOT_FOUND",
    }),
  ];
  const report = evaluateArtistBenchmark(fixture, rows, rejections, manifest.defaultMetrics);

  assert.equal(report.passed, false);
  assert.ok(report.missing.some((item) => item.reasonCode === "COUNT_SHORTFALL" && item.category === "SINGLE"));
  assert.ok(report.missing.some((item) => item.reasonCode === "ANCHOR_MISSING" && item.title === "世界中の誰よりきっと"));
  assert.ok(report.extra.some((item) => item.reasonCode === "DUPLICATE_WORK"));
  assert.ok(report.extra.some((item) => item.reasonCode === "KNOWN_NON_CORE" && item.title === "All Time Best"));
  assert.deepEqual(report.pendingEvidence.map((item) => item.title), ["EXOTIQUE"]);
  assert.deepEqual(report.pendingCover.map((item) => item.title), ["EXOTIQUE"]);
  assert.deepEqual(report.unexplainedRejections.map((item) => item.title), ["世界中の誰よりきっと"]);
  assert.equal(report.metrics.explainedRejectionCoverage, 0);
});

test("exact overflows fail, but an active minimum may be exceeded by legitimate later work", async () => {
  const manifest = await loadBenchmarkManifest();
  const miho = findArtistBenchmark(manifest, "中山美穂");
  const akina = findArtistBenchmark(manifest, "中森明菜");
  assert.ok(miho);
  assert.ok(akina);

  const exactRows = [...completeRows(miho), release("not-an-authoritative-40th-single", "SINGLE")];
  const exactReport = evaluateArtistBenchmark(miho, exactRows, [], manifest.defaultMetrics);
  assert.equal(exactReport.passed, false);
  assert.ok(exactReport.extra.some((item) => item.reasonCode === "EXACT_COUNT_OVERFLOW" && item.count === 1));

  const minimumRows = [
    ...completeRows(akina),
    release("future-valid-single", "SINGLE", { originalReleaseDate: "2027-01-01" }),
  ];
  const minimumReport = evaluateArtistBenchmark(akina, minimumRows, [], manifest.defaultMetrics);
  assert.equal(minimumReport.passed, true);
  assert.equal(minimumReport.baselines[0]?.actual, 55);
  assert.ok(!minimumReport.extra.some((item) => item.reasonCode === "EXACT_COUNT_OVERFLOW"));
});

test("input parsing supports one artist, a multi-artist envelope, and mapped datasets", () => {
  assert.deepEqual(parseApplicationOutput([release("C", "SINGLE")], "miho-nakayama")[0]?.artist, "miho-nakayama");

  const envelope = parseApplicationOutput({
    artists: [
      { artist: { name: "中山美穂" }, releases: [release("C", "SINGLE")], rejections: [] },
      { artistName: "中森明菜", releases: [release("DESIRE -情熱-", "SINGLE")] },
    ],
  });
  assert.deepEqual(envelope.map((dataset) => dataset.artist), ["中山美穂", "中森明菜"]);

  const mapped = parseApplicationOutput({
    "the-beatles": { releases: [release("Abbey Road", "ORIGINAL_ALBUM")] },
  });
  assert.equal(mapped[0]?.artist, "the-beatles");

  const comprehensive = parseApplicationOutput({
    artist: { name: "中山美穂" },
    releases: [release("C", "SINGLE")],
    verificationCandidates: [{
      title: "wrong",
      category: "SINGLE",
      resolution: "REJECTED",
      ledger: [{ stage: "AUTHORITATIVE", reasonCode: "DATE_CONFLICT" }],
    }],
  });
  assert.equal(comprehensive[0]?.rejections.length, 1);
  assert.equal((comprehensive[0]?.rejections[0] as { reasonCode?: string }).reasonCode, "DATE_CONFLICT");

  const explicitIdentity = parseApplicationOutput({
    artist: { name: "WRONG ARTIST" },
    releases: [release("C", "SINGLE")],
  }, "miho-nakayama");
  assert.equal(explicitIdentity[0]?.artist, "WRONG ARTIST");
});

test("normalization is Unicode-safe and CLI live cost caps are bounded", () => {
  assert.equal(normalizeBenchmarkText("Ｓｇｔ． Pepper’s  Lonely-Hearts!"), normalizeBenchmarkText("sgt peppers lonely hearts"));
  assert.equal(normalizeBenchmarkText("中山 美穂"), normalizeBenchmarkText("中山美穂"));
  assert.throws(() => parseApplicationOutput([]), /requires --artist/);
  assert.equal(parseBenchmarkCliArgs(["--live", "--artist=中山美穂", "--max-pages=2"]).maxPages, 2);
  assert.throws(() => parseBenchmarkCliArgs(["--max-pages=11"]), /1 to 10/);
});

test("thresholds require all final core works to retain evidence, covers, and explainable attrition", async () => {
  const manifest = await loadBenchmarkManifest();
  const thresholds: BenchmarkThresholds = manifest.defaultMetrics;
  assert.deepEqual(thresholds, {
    minimumAnchorRecall: 1,
    minimumCoreRecall: 1,
    minimumEvidenceCoverage: 1,
    minimumCoverCoverage: 1,
    maximumDuplicateRate: 0,
    minimumExplainedRejectionCoverage: 1,
  });
});

test("authoritative anchors override misleading MusicBrainz EP/live types without inventing titles", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = findArtistBenchmark(manifest, "松任谷由実");
  assert.ok(fixture);
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({
      "release-group-count": 3,
      "release-groups": [
        {
          id: "00000000-0000-4000-8000-000000000101",
          title: "水の中のAsiaへ",
          "primary-type": "EP",
          "secondary-types": [],
          "first-release-date": "1981-05-21",
        },
        {
          id: "00000000-0000-4000-8000-000000000102",
          title: "Road Show",
          "primary-type": "Album",
          "secondary-types": ["Live"],
          "first-release-date": "2011-04-06",
        },
        {
          id: "00000000-0000-4000-8000-000000000103",
          title: "Wormhole",
          "primary-type": "Album",
          "secondary-types": [],
          "first-release-date": "2025-11-18",
        },
      ],
      "release-group-offset": 0,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const live = await fetchMusicBrainzReleaseGroups(fixture, {
    fetchImpl,
    maxPages: 1,
  });
  assert.equal(calls, 1);
  assert.ok(live.releases.every((item) => (
    item as { category?: string }
  ).category === "ORIGINAL_ALBUM"));

  const report = evaluateArtistBenchmark(fixture, live.releases, [], {
    ...manifest.defaultMetrics,
    minimumCoverCoverage: 0,
  });
  const missingTitles = report.missing
    .filter((item) => item.reasonCode === "ANCHOR_MISSING")
    .map((item) => item.title);
  assert.ok(!missingTitles.includes("水の中のASIAへ"));
  assert.ok(!missingTitles.includes("Road Show"));
  assert.ok(!missingTitles.includes("Wormhole / Yumi AraI"));
});

test("source-title aliases map Momoe's full debut titles without weakening category matching", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = findArtistBenchmark(manifest, "山口百恵");
  assert.ok(fixture);
  const report = evaluateArtistBenchmark(fixture, [
    release("人にめざめる１４才 としごろ", "SINGLE", { originalReleaseDate: "1973-05-21" }),
    release("山口百恵ファースト・アルバム／としごろ", "ORIGINAL_ALBUM"),
  ], [], manifest.defaultMetrics);
  assert.equal(
    report.missing.filter((item) => item.reasonCode === "ANCHOR_MISSING" && item.title === "としごろ").length,
    0,
  );
});

test("explicit work ids drive work counts and conflicting titles cannot inflate a pass", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = findArtistBenchmark(manifest, "miho-nakayama");
  assert.ok(fixture);
  const synthetic = {
    ...fixture,
    requiredAnchors: [],
    negativeAnchors: [],
    scope: { ...fixture.scope, includedCategories: ["SINGLE"] },
    baselines: [{ ...fixture.baselines[0]!, expected: 1 }],
  };
  const report = evaluateArtistBenchmark(synthetic, [
    release("Title A", "SINGLE", { workId: "same-work" }),
    release("Title B", "SINGLE", { workId: "same-work" }),
  ], [], manifest.defaultMetrics);

  assert.equal(report.baselines[0]?.actual, 1);
  assert.equal(report.passed, false);
  assert.equal(report.extra.filter((item) => item.reasonCode === "DUPLICATE_WORK").length, 1);
  assert.ok(report.metrics.duplicateRate > 0);
});

test("wrong dates and arbitrary evidence or cover URLs cannot forge an exact catalog pass", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = findArtistBenchmark(manifest, "miho-nakayama");
  assert.ok(fixture);
  const rows: Array<Record<string, unknown>> = [];
  const counts = new Map<string, number>();
  for (const anchor of fixture.requiredAnchors) {
    rows.push(release(anchor.title, anchor.category, {
      originalReleaseDate: "2099-12-31",
      sources: [{ url: "https://example.com/not-authority" }],
      coverImageUrl: "https://example.com/not-an-image",
    }));
    counts.set(anchor.category, (counts.get(anchor.category) ?? 0) + 1);
  }
  for (const baseline of fixture.baselines) {
    for (let index = counts.get(baseline.category) ?? 0; index < baseline.expected; index += 1) {
      rows.push(release(`FAKE-${baseline.category}-${index}`, baseline.category, {
        originalReleaseDate: "2099-12-31",
        sources: [{ url: "https://example.com/not-authority" }],
        coverImageUrl: "https://example.com/not-an-image",
      }));
    }
  }

  const report = evaluateArtistBenchmark(fixture, rows, [], manifest.defaultMetrics);
  assert.equal(report.passed, false);
  assert.equal(isTrustedBenchmarkEvidenceUrl(fixture, "https://example.com/not-authority"), false);
  assert.equal(isTrustedBenchmarkEvidenceUrl(fixture, "https://go.jp/not-ndl"), false);
  assert.equal(isTrustedBenchmarkCoverUrl("https://example.com/not-an-image"), false);
  assert.equal(isTrustedBenchmarkCoverUrl(coverUrl, "cover-art-archive"), true);
  assert.equal(isTrustedBenchmarkCoverUrl(coverUrl, "apple-music"), false);
  assert.ok(report.missing.some((item) => item.reasonCode === "ANCHOR_MISSING"));
  assert.equal(report.pendingEvidence.length, 61);
  assert.equal(report.pendingCover.length, 61);
});

test("source-only recall ignores cover and overflow but never hides a source shortfall", async () => {
  const manifest = await loadBenchmarkManifest();
  const miho = findArtistBenchmark(manifest, "中山美穂");
  const momoe = findArtistBenchmark(manifest, "山口百恵");
  assert.ok(miho);
  assert.ok(momoe);
  const legacyMiho: ArtistBenchmark = {
    ...miho,
    baselines: miho.baselines.map((baseline) => {
      const legacyBaseline = { ...baseline };
      delete legacyBaseline.expectedWorks;
      return legacyBaseline;
    }),
  };

  const sourceRows = [
    ...completeRows(legacyMiho).map((item) => ({ ...item, coverImageUrl: null })),
    release("MusicBrainz split reissue group", "SINGLE", { coverImageUrl: null }),
  ];
  const strictReport = evaluateArtistBenchmark(legacyMiho, sourceRows, [], manifest.defaultMetrics);
  assert.equal(strictReport.passed, false);
  assert.ok(strictReport.pendingCover.length > 0);
  assert.ok(strictReport.extra.some((item) => item.reasonCode === "EXACT_COUNT_OVERFLOW"));

  const sourcePass = assessSourceOnlyRecall(strictReport, false);
  assert.equal(sourcePass.passed, true);
  assert.equal(sourcePass.status, "PASS_WITH_PARTIAL_SOURCE");
  assert.equal(sourcePass.conclusive, true);
  assert.deepEqual(sourcePass.countShortfalls, []);

  const incompleteReport = evaluateArtistBenchmark(momoe, [
    release("人にめざめる１４才 としごろ", "SINGLE", { coverImageUrl: null }),
    release("山口百恵ファースト・アルバム／としごろ", "ORIGINAL_ALBUM", { coverImageUrl: null }),
  ], [], manifest.defaultMetrics);
  const sourceGap = assessSourceOnlyRecall(incompleteReport);
  assert.equal(sourceGap.passed, false);
  assert.equal(sourceGap.status, "SOURCE_GAP");
  assert.equal(sourceGap.conclusive, true);
  assert.ok(sourceGap.countShortfalls.some((item) => item.category === "SINGLE"));

  const partial = assessSourceOnlyRecall(incompleteReport, false);
  assert.equal(partial.passed, false);
  assert.equal(partial.status, "INCONCLUSIVE_PARTIAL_SOURCE");
  assert.equal(partial.conclusive, false);
});
