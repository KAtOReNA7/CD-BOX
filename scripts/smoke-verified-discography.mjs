import { researchPublicMetadataReleases } from "../src/lib/ai/public-metadata-research.ts";
import { verifyDiscographyResult } from "../src/lib/ai/verified-discography.ts";

const artistName = process.argv.find((value) => value.startsWith("--artist="))?.slice(9) || "中山美穂";
const useAi = process.argv.includes("--ai");
const input = {
  artistName,
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
};

const publicResearch = await researchPublicMetadataReleases(input, undefined, {
  onEvidenceProgress: ({ phase, processed, total }) => {
    if (processed === total || processed % 10 === 0) {
      process.stdout.write(`[musicbrainz] ${phase} ${processed}/${total}\n`);
    }
  },
});

const verified = await verifyDiscographyResult(
  input,
  publicResearch.result,
  publicResearch.evidence,
  undefined,
  {
    ...(useAi
      ? {}
      : {
          auditEvidence: async (items) => items.map((item) => ({
            id: item.candidate.id,
            decision: "ACCEPT",
            reasonCode: "EVIDENCE_CONSISTENT",
            reason: "Smoke test accepted deterministic strong evidence.",
          })),
        }),
    onProgress: ({ processed, total, stage }) => {
      if (processed === total || processed % 10 === 0) {
        process.stdout.write(`[verify] ${processed}/${total} ${stage}\n`);
      }
    },
  },
);

process.stdout.write(`${JSON.stringify({
  artist: verified.artist.name,
  aiAudit: useAi,
  summary: verified.verificationSummary,
  releases: verified.releases.map((release) => ({
    title: release.title,
    date: release.originalReleaseDate ?? release.releaseDate,
    catalogNumber: release.catalogNumber,
    coverProvider: release.verification?.coverProvider,
    sourceCount: release.sources.length,
  })),
}, null, 2)}\n`);
