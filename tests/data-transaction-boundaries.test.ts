import assert from "node:assert/strict";
import fs from "node:fs";

const importService = fs.readFileSync("src/lib/import/import-service.ts", "utf8");
const researchService = fs.readFileSync("src/lib/ai/release-research.ts", "utf8");
const releaseRoute = fs.readFileSync("src/app/api/releases/[id]/route.ts", "utf8");
const releaseService = fs.readFileSync("src/lib/releases/release-service.ts", "utf8");
const artistService = fs.readFileSync("src/lib/services/artists.ts", "utf8");
const migration = fs.readFileSync("prisma/migrations/20260711010000_init/migration.sql", "utf8");

const confirmTransaction = importService.slice(importService.indexOf("return prisma.$transaction"));
assert.match(confirmTransaction, /return prisma\.\$transaction\(async \(tx\) =>/);
assert.doesNotMatch(confirmTransaction, /await prisma\.(?:artist|release|releaseSource|userReleaseStatus|importBatch)\./);
assert.match(confirmTransaction, /await tx\.importBatch\.create/);
assert.match(confirmTransaction, /await tx\.release\.create/);
assert.match(confirmTransaction, /await upsertReleaseStatus\([^;]+, tx\)/);
assert.match(confirmTransaction, /await addReleaseSource\([^;]+, tx\)/);
assert.match(confirmTransaction, /await tx\.importBatch\.update/);

const candidateTransaction = researchService.slice(
  researchService.indexOf("return prisma.$transaction", researchService.indexOf("importReleaseResearchCandidates")),
);
assert.match(candidateTransaction, /return prisma\.\$transaction\(async \(tx\) =>/);
assert.doesNotMatch(candidateTransaction, /await prisma\.(?:artist|release|releaseSource|userReleaseStatus)\./);
assert.match(candidateTransaction, /await tx\.release\.create/);
assert.match(candidateTransaction, /await tx\.userReleaseStatus\.create/);
assert.match(candidateTransaction, /await tx\.releaseSource\.createMany/);
assert.match(candidateTransaction, /await tx\.aiSearchTask\.update/);

const updateRelease = releaseService.slice(
  releaseService.indexOf("export async function updateRelease"),
  releaseService.indexOf("export async function updateUserReleaseStatus"),
);
assert.match(releaseRoute, /updateRelease\(id, auth\.owner\.id, parseReleasePatchInput\(body\)\)/);
assert.match(updateRelease, /userStatus: \{ where: \{ userId \} \}/);
assert.match(updateRelease, /prisma\.\$transaction\(async \(tx\) =>/);
assert.match(updateRelease, /description: COVER_IMAGE_SOURCE_DESCRIPTION/);
assert.match(updateRelease, /await tx\.releaseSource\.deleteMany/);
assert.match(updateRelease, /release: serializeRelease\(release, userId\)/);

assert.match(artistService, /isolationLevel: "Serializable"/);
assert.match(artistService, /maxWait: 10_000/);
assert.match(artistService, /timeout: 30_000/);
assert.match(artistService, /error\.code === "P2034"/);
assert.match(artistService, /error\.code === "P2028"/);

assert.match(migration, /CREATE TYPE "CollectionStatus" AS ENUM \('WANTED', 'OWNED', 'NOT_OWNED', 'EXCLUDED', 'PENDING_REVIEW'\)/);
assert.doesNotMatch(migration, /'WANT'|'SKIP'|'UNKNOWN'|'ORDERED'/);
assert.match(migration, /CONSTRAINT "UserReleaseStatus_priority_check" CHECK \("priority" BETWEEN 1 AND 5\)/);

console.log("Data transaction boundary test passed.");
