import assert from "node:assert/strict";
import fs from "node:fs";

const importService = fs.readFileSync("src/lib/import/import-service.ts", "utf8");
const researchService = fs.readFileSync("src/lib/ai/release-research.ts", "utf8");
const scheduledCoverRetry = fs.readFileSync("src/lib/ai/scheduled-cover-retry.ts", "utf8");
const rematerializer = fs.readFileSync("scripts/rematerialize-discography-tasks.ts", "utf8");
const releaseRoute = fs.readFileSync("src/app/api/releases/[id]/route.ts", "utf8");
const releaseService = fs.readFileSync("src/lib/releases/release-service.ts", "utf8");
const artistService = fs.readFileSync("src/lib/services/artists.ts", "utf8");
const dashboardPage = fs.readFileSync("src/app/dashboard/page.tsx", "utf8");
const migration = fs.readFileSync("prisma/migrations/20260711010000_init/migration.sql", "utf8");
const verificationIntegrityMigration = fs.readFileSync(
  "prisma/migrations/20260712100000_release_verification_integrity/migration.sql",
  "utf8",
);

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
assert.match(candidateTransaction, /await tx\.userReleaseStatus\.upsert/);
assert.match(candidateTransaction, /await tx\.releaseSource\.createMany/);
assert.match(candidateTransaction, /await tx\.aiSearchTask\.updateMany/);
assert.match(candidateTransaction, /artistId: null/);
assert.match(candidateTransaction, /acquireResearchLedgerTaskLock\(tx, taskId\)/);
assert.ok(
  candidateTransaction.indexOf("acquireResearchLedgerTaskLock") <
    candidateTransaction.indexOf("const lockedTask"),
  "import must acquire the task ledger lock before re-reading its task snapshot",
);
assert.ok(
  candidateTransaction.indexOf("const lockedTask") <
    candidateTransaction.indexOf("resolveArtist"),
  "import must validate the locked task snapshot before creating or resolving an artist",
);
assert.match(candidateTransaction, /pg_advisory_xact_lock\(hashtextextended/);
assert.match(candidateTransaction, /artist-identities:/);
assert.ok(
  candidateTransaction.indexOf("pg_advisory_xact_lock") < candidateTransaction.indexOf("resolveArtist"),
  "the normalized artist identity must be locked before find-or-create",
);
assert.match(candidateTransaction, /FOR UPDATE/);
assert.match(candidateTransaction, /sourceRoleKey/);
assert.match(candidateTransaction, /COVER_IMAGE_SOURCE_DESCRIPTION/);
assert.match(candidateTransaction, /await tx\.userReleaseStatus\.upsert\([\s\S]+?update: \{\}/);
assert.doesNotMatch(candidateTransaction, /update: \{\s*priority: 2,\s*notes: null/);
assert.match(researchService, /所选艺人与该核验任务的艺人身份不一致/);
assert.match(researchService, /\[artist\.name, artist\.sortName\]\.some/);
assert.match(researchService, /localizedArtistNameUpdate/);

const coverClaim = scheduledCoverRetry.slice(
  scheduledCoverRetry.indexOf("async function claimDueCandidates"),
  scheduledCoverRetry.indexOf("async function retryTaskCovers"),
);
assert.match(coverClaim, /prisma\.\$transaction\(async \(transaction\) =>/);
assert.match(coverClaim, /acquireResearchLedgerTaskLock\(transaction, taskId\)/);
assert.ok(
  coverClaim.indexOf("acquireResearchLedgerTaskLock") <
    coverClaim.indexOf("transaction.aiSearchTask.findUnique"),
  "cover claim must lock before re-reading the task and candidate rows",
);
assert.ok(
  coverClaim.indexOf("transaction.aiSearchTask.findUnique") <
    coverClaim.indexOf("transaction.researchCandidate.updateMany"),
  "cover claim must select from the locked fresh task state before claiming rows",
);
assert.match(coverClaim, /isLockedCoverRetryCandidateDue\(candidate, now\)/);
const coverRetry = scheduledCoverRetry.slice(
  scheduledCoverRetry.indexOf("async function retryTaskCovers"),
  scheduledCoverRetry.indexOf("export async function retryScheduledCovers"),
);
assert.match(coverRetry, /const task = claim\.task/);
const coverCompletionTransaction = coverRetry.slice(
  coverRetry.indexOf("await prisma.$transaction(async (transaction) =>"),
  coverRetry.indexOf("}, { maxWait: 10_000, timeout: 120_000 })"),
);
assert.match(
  coverCompletionTransaction,
  /acquireResearchLedgerTaskLock\(transaction, task\.id\)/,
);
assert.ok(
  coverCompletionTransaction.indexOf("acquireResearchLedgerTaskLock") <
    coverCompletionTransaction.indexOf("transaction.researchCandidate.count"),
  "completion must lock before checking whether the old worker still owns every claim",
);
assert.ok(
  coverCompletionTransaction.indexOf("transaction.researchCandidate.count") <
    coverCompletionTransaction.indexOf("persistResearchLedgerInTransaction"),
  "a lease re-claimed by a newer worker must be detected before any old result is persisted",
);
assert.match(coverCompletionTransaction, /coverLastErrorCode: claim\.claimToken/);

const rematerializationTransaction = rematerializer.slice(
  rematerializer.indexOf("const event = await database.$transaction"),
  rematerializer.indexOf("events.push(event)"),
);
assert.match(
  rematerializationTransaction,
  /acquireResearchLedgerTaskLock\(transaction, taskId\)/,
);
assert.ok(
  rematerializationTransaction.indexOf("acquireResearchLedgerTaskLock") <
    rematerializationTransaction.indexOf("transaction.aiSearchTask.findUnique"),
  "offline rematerialization must lock before re-reading and validating the task",
);

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
assert.match(updateRelease, /existing\.verificationStatus !== "VERIFIED"/);

assert.match(artistService, /isolationLevel: "Serializable"/);
assert.match(artistService, /maxWait: 10_000/);
assert.match(artistService, /timeout: 30_000/);
assert.match(artistService, /error\.code === "P2034"/);
assert.match(artistService, /error\.code === "P2028"/);
assert.match(artistService, /export async function getDashboardStats/);
assert.match(artistService, /verificationEvidence: \{ not: Prisma\.DbNull \}/);
assert.match(artistService, /prisma\.artist\.count\(\)/);
assert.match(artistService, /prisma\.release\.count\(\{ where: verifiedReleaseWhere \}\)/);
assert.match(artistService, /prisma\.userArtistFollow\.count\(\)/);
assert.match(dashboardPage, /Promise\.all\(\[listDashboardArtists\(\), getDashboardStats\(\)\]\)/);
assert.match(dashboardPage, /stats\.artistCount/);
assert.match(dashboardPage, /stats\.releaseCount/);
assert.match(dashboardPage, /stats\.followCount/);

assert.match(migration, /CREATE TYPE "CollectionStatus" AS ENUM \('WANTED', 'OWNED', 'NOT_OWNED', 'EXCLUDED', 'PENDING_REVIEW'\)/);
assert.doesNotMatch(migration, /'WANT'|'SKIP'|'UNKNOWN'|'ORDERED'/);
assert.match(migration, /CONSTRAINT "UserReleaseStatus_priority_check" CHECK \("priority" BETWEEN 1 AND 5\)/);
assert.match(verificationIntegrityMigration, /"verificationStatus" <> 'VERIFIED'/);
assert.match(verificationIntegrityMigration, /"verificationEvidence" IS NOT NULL/);
assert.match(verificationIntegrityMigration, /"verifiedAt" IS NOT NULL/);
assert.match(verificationIntegrityMigration, /length\(btrim\("coverImageUrl"\)\) > 0/);

console.log("Data transaction boundary test passed.");
