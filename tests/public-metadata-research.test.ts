import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicPublicMetadataResult,
  categoryFromPublicEvidence,
  classifyPublicMetadataOrganizerError,
  researchPublicMetadataReleases,
} from "@/lib/ai/public-metadata-research";
import { getConfiguredProviderCapabilities } from "@/lib/ai/provider-capabilities";
import { resolveReleaseResearchStrategy } from "@/lib/ai/release-research";
import type { ReleaseResearchRequest } from "@/lib/ai/release-research-types";
import type {
  ArtistReleaseEvidenceBundle,
  ArtistReleaseEvidenceItem,
  MusicReleaseEvidence,
} from "@/lib/music-metadata";

const artistId = "a1234567-89ab-4cde-8f01-23456789abcd";
const releaseId = "b1234567-89ab-4cde-8f01-23456789abcd";
const releaseUrl = `https://musicbrainz.org/release/${releaseId}`;
const coverSourceUrl = `https://coverartarchive.org/release/${releaseId}`;
const coverUrl = `${coverSourceUrl}/front.jpg`;

const input: ReleaseResearchRequest = {
  artistName: "Miho Nakayama",
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
};

function releaseEvidence(overrides: Partial<MusicReleaseEvidence> = {}): MusicReleaseEvidence {
  return {
    entityType: "release",
    sourceId: releaseId,
    releaseGroupId: null,
    title: "C",
    artistCredit: "中山美穂",
    artistNames: ["中山美穂"],
    artistAliases: [],
    date: "1985-08-21",
    type: "Album",
    secondaryTypes: [],
    country: "JP",
    label: "King Records",
    catalogNumber: "K32X-30",
    format: "CD",
    labels: [{ name: "King Records", catalogNumber: "K32X-30" }],
    formats: ["CD"],
    barcode: "4988003000000",
    status: "Official",
    sourceUrl: releaseUrl,
    coverUrl,
    coverSourceUrl,
    sources: [
      { provider: "musicbrainz", title: "MusicBrainz release", url: releaseUrl },
      { provider: "cover-art-archive", title: "Cover Art Archive", url: coverSourceUrl },
      { provider: "musicbrainz", title: "Untrusted injected source", url: "https://evil.example/release" },
    ],
    ...overrides,
  };
}

function item(overrides: Partial<MusicReleaseEvidence> = {}): ArtistReleaseEvidenceItem {
  return { evidence: releaseEvidence(overrides), warnings: [] };
}

function evidenceBundle(releases: ArtistReleaseEvidenceItem[] = [item()]): ArtistReleaseEvidenceBundle {
  return {
    query: { artistName: input.artistName, targetCountry: "JP", target: input.target },
    artist: {
      sourceId: artistId,
      name: "Miho Nakayama",
      sortName: "Nakayama, Miho",
      aliases: [
        { name: "中山美穂", sortName: null, locale: "ja", type: null, primary: true },
        { name: "なかやま みほ", sortName: null, locale: "ja", type: null, primary: false },
      ],
      country: "JP",
      type: "Person",
      disambiguation: null,
      score: 100,
      sourceUrl: `https://musicbrainz.org/artist/${artistId}`,
      sources: [{
        provider: "musicbrainz",
        title: "MusicBrainz artist",
        url: `https://musicbrainz.org/artist/${artistId}`,
      }],
    },
    releases,
    sourceWhitelist: [
      `https://musicbrainz.org/artist/${artistId}`,
      releaseUrl,
      coverSourceUrl,
      "https://evil.example/release",
    ],
    warnings: [{
      code: "reissue-status-unavailable",
      message: "MusicBrainz does not explicitly identify reissues.",
    }],
    stats: {
      artistResultsInspected: 1,
      releasesFetched: releases.length,
      releasesAccepted: releases.length,
      coverLookups: releases.length,
    },
  };
}

function modelPayload(result: ReturnType<typeof buildDeterministicPublicMetadataResult>) {
  return JSON.parse(JSON.stringify(result)) as {
    artist: typeof result.artist;
    releases: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
}

test("deterministic public metadata mapping remains source-faithful", () => {
  const result = buildDeterministicPublicMetadataResult(input, evidenceBundle());
  assert.equal(result.artist.name, "中山美穂");
  assert.equal(result.artist.nameKana, "なかやま みほ");
  assert.equal(result.artist.nameRomaji, "Miho Nakayama");
  assert.equal(result.releases.length, 1);
  assert.equal(result.releases[0].category, "ORIGINAL_ALBUM");
  assert.equal(result.releases[0].releaseDate, "1985-08-21");
  assert.equal(result.releases[0].originalReleaseDate, null);
  assert.equal(result.releases[0].isReissue, null);
  assert.equal(result.releases[0].isRemaster, null);
  assert.equal(result.releases[0].catalogNumber, "K32X-30");
  assert.equal(result.releases[0].coverImageUrl, coverUrl);
  assert.deepEqual(
    result.releases[0].sources.map((source) => source.url),
    [releaseUrl, coverSourceUrl],
  );
  assert.equal(result.releases[0].confidence, "MEDIUM");
  assert.ok(result.releases[0].warnings.some((warning) => warning.includes("PENDING_REVIEW")));
  assert.ok(result.globalWarnings.some((warning) => warning.includes("公共资料源")));
});

test("category mapping uses explicit source types and never guesses best-of from a title", () => {
  assert.equal(categoryFromPublicEvidence(item({ title: "Best Selection", secondaryTypes: [] })), "ORIGINAL_ALBUM");
  assert.equal(categoryFromPublicEvidence(item({ secondaryTypes: ["Compilation"] })), "COLLECTION");
  assert.equal(categoryFromPublicEvidence(item({ type: "Single" })), "SINGLE");
  assert.equal(categoryFromPublicEvidence(item({ type: null, secondaryTypes: ["Live"] })), "LIVE");
});

test("a compliant organizer response is used only after evidence constraints", async () => {
  const bundle = evidenceBundle();
  const deterministic = buildDeterministicPublicMetadataResult(input, bundle);
  const result = await researchPublicMetadataReleases(input, "sk-unit-test", {
    researchEvidence: async () => bundle,
    organizeEvidence: async () => ({ output_text: JSON.stringify(modelPayload(deterministic)) }),
  });

  assert.equal(result.organizer.status, "used");
  assert.equal(result.result.releases[0].catalogNumber, "K32X-30");
  assert.ok(result.result.globalWarnings.some((warning) => warning.includes("重新约束")));
});

test("invented model facts reject the whole organizer output", async () => {
  const bundle = evidenceBundle();
  const deterministic = buildDeterministicPublicMetadataResult(input, bundle);
  const payload = modelPayload(deterministic);
  payload.releases[0].catalogNumber = "FAKE-999";

  const result = await researchPublicMetadataReleases(input, "sk-unit-test", {
    researchEvidence: async () => bundle,
    organizeEvidence: async () => ({ output_text: JSON.stringify(payload) }),
  });

  assert.equal(result.organizer.status, "rejected");
  assert.equal(result.result.releases[0].catalogNumber, "K32X-30");
  assert.equal(result.result.releases[0].originalReleaseDate, null);
  assert.ok(result.result.globalWarnings.some((warning) => warning.includes("已拒绝")));
});

test("AI authentication failure still returns deterministic public candidates with an explicit warning", async () => {
  const result = await researchPublicMetadataReleases(input, "sk-unit-test", {
    researchEvidence: async () => evidenceBundle(),
    organizeEvidence: async () => {
      throw new Error("403 invalid API key sk-unit-test");
    },
  });

  assert.equal(result.organizer.status, "failed");
  assert.equal(result.result.releases.length, 1);
  assert.match(result.organizer.error ?? "", /sk-u\.\.\.test/);
  assert.doesNotMatch(result.organizer.error ?? "", /sk-unit-test/);
  assert.ok(result.result.globalWarnings.some((warning) => warning.includes("authentication")));
});

test("empty evidence skips the model instead of reporting an AI-generated success", async () => {
  let organizerCalls = 0;
  const result = await researchPublicMetadataReleases(input, "sk-unit-test", {
    researchEvidence: async () => evidenceBundle([]),
    organizeEvidence: async () => {
      organizerCalls += 1;
      return { output_text: "{}" };
    },
  });

  assert.equal(organizerCalls, 0);
  assert.equal(result.organizer.status, "skipped");
  assert.equal(result.result.releases.length, 0);
});

test("public metadata skips the optional organizer by default", async () => {
  const previous = process.env.AI_ORGANIZE_PUBLIC_METADATA;
  delete process.env.AI_ORGANIZE_PUBLIC_METADATA;
  try {
    const result = await researchPublicMetadataReleases(input, undefined, {
      researchEvidence: async () => evidenceBundle(),
    });
    assert.equal(result.organizer.status, "skipped");
    assert.equal(result.result.releases.length, 1);
    assert.ok(result.result.globalWarnings.some((warning) => warning.includes("未调用 GPT")));
  } finally {
    if (previous === undefined) delete process.env.AI_ORGANIZE_PUBLIC_METADATA;
    else process.env.AI_ORGANIZE_PUBLIC_METADATA = previous;
  }
});

test("organizer error classification keeps auth, quota, and model failures visible", () => {
  assert.equal(classifyPublicMetadataOrganizerError(new Error("401 unauthorized")), "authentication");
  assert.equal(classifyPublicMetadataOrganizerError(new Error("429 insufficient quota")), "quota");
  assert.equal(classifyPublicMetadataOrganizerError(new Error("403 credit card required")), "quota");
  assert.equal(classifyPublicMetadataOrganizerError(new Error("model not found")), "model");
});

test("research strategy uses native search only when supported or unknown", () => {
  const base = {
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test",
    OPENAI_BASE_URL: "https://relay.example.com/v1",
    OPENAI_TEXT_MODEL: "gpt-5.6-terra",
    AI_ENABLE_WEB_SEARCH: "true",
  } satisfies NodeJS.ProcessEnv;
  const unsupported = resolveReleaseResearchStrategy(getConfiguredProviderCapabilities({
    ...base,
    AI_RESPONSES_SUPPORTED: "false",
    AI_CHAT_COMPLETIONS_SUPPORTED: "true",
    AI_WEB_SEARCH_SUPPORTED: "false",
  }));
  assert.deepEqual(unsupported, { primary: "public-metadata", nativeCapability: "unsupported" });

  const supported = resolveReleaseResearchStrategy(getConfiguredProviderCapabilities({
    ...base,
    AI_RESPONSES_SUPPORTED: "true",
    AI_WEB_SEARCH_SUPPORTED: "true",
  }));
  assert.deepEqual(supported, { primary: "native-web-search", nativeCapability: "supported" });

  const unknown = resolveReleaseResearchStrategy(getConfiguredProviderCapabilities(base));
  assert.deepEqual(unknown, { primary: "native-web-search", nativeCapability: "unknown" });
});
