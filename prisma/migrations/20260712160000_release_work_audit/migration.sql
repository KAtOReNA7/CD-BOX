-- Add a durable work/edition split without changing or deleting legacy Release
-- columns. Release.workId intentionally remains nullable until the conservative
-- application backfill has assigned every existing row.

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('YEAR', 'MONTH', 'DAY');

-- CreateEnum
CREATE TYPE "ReleaseWorkStatus" AS ENUM ('DISCOVERED', 'CORROBORATED', 'VERIFIED', 'CONFLICTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResearchEntityKind" AS ENUM ('WORK', 'EDITION');

-- CreateEnum
CREATE TYPE "ResearchDisposition" AS ENUM ('DISCOVERED', 'ACTIVE', 'DEFERRED', 'ACCEPTED', 'REJECTED', 'MERGED');

-- CreateEnum
CREATE TYPE "ResearchDecisionOutcome" AS ENUM ('PASS', 'DEFER', 'REJECT', 'MERGE', 'RETRY', 'ERROR');

-- CreateEnum
CREATE TYPE "CoverStatus" AS ENUM ('MISSING', 'QUEUED', 'CHECKING', 'RETRY_WAIT', 'VALID', 'INVALID', 'EXHAUSTED');

-- AlterTable
ALTER TABLE "AiSearchTask"
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "importedAt" TIMESTAMP(3),
ADD COLUMN "pipelineVersion" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "request" JSONB,
ADD COLUMN "resultSchemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "stage" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Release"
ADD COLUMN "barcode" TEXT,
ADD COLUMN "coverAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "coverCheckedAt" TIMESTAMP(3),
ADD COLUMN "coverImageSourceUrl" TEXT,
ADD COLUMN "coverLastErrorCode" TEXT,
ADD COLUMN "coverLastErrorMessage" TEXT,
ADD COLUMN "coverNextRetryAt" TIMESTAMP(3),
ADD COLUMN "coverProvider" TEXT,
ADD COLUMN "coverStatus" "CoverStatus" NOT NULL DEFAULT 'MISSING',
ADD COLUMN "discogsReleaseId" INTEGER,
ADD COLUMN "editionDatePrecision" "DatePrecision",
ADD COLUMN "editionReleaseDate" TIMESTAMP(3),
ADD COLUMN "musicBrainzReleaseId" TEXT,
ADD COLUMN "workId" TEXT;

-- Preserve the old date value as the edition date during the compatibility
-- window. The old field stays untouched for existing API callers.
UPDATE "Release"
SET
  "editionReleaseDate" = "originalReleaseDate",
  "editionDatePrecision" = 'DAY'
WHERE "originalReleaseDate" IS NOT NULL;

-- Existing VERIFIED rows already satisfy the previous evidence/cover check, so
-- they can safely enter the explicit VALID cover state. A non-verified stored
-- URL is queued for revalidation rather than being trusted automatically.
UPDATE "Release"
SET "coverStatus" = 'VALID'
WHERE "verificationStatus" = 'VERIFIED';

UPDATE "Release"
SET "coverStatus" = 'QUEUED'
WHERE
  "verificationStatus" <> 'VERIFIED'
  AND "coverImageUrl" IS NOT NULL
  AND length(btrim("coverImageUrl")) > 0;

-- CreateTable
CREATE TABLE "ReleaseWork" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleOriginal" TEXT,
    "artistCredit" TEXT,
    "category" "ReleaseCategory" NOT NULL,
    "originalReleaseDate" TIMESTAMP(3),
    "originalDatePrecision" "DatePrecision",
    "musicBrainzReleaseGroupId" TEXT,
    "verificationStatus" "ReleaseWorkStatus" NOT NULL DEFAULT 'DISCOVERED',
    "verificationEvidence" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseWorkSource" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "observed" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseWorkSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCandidate" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "entityKind" "ResearchEntityKind" NOT NULL,
    "parentCandidateId" TEXT,
    "workId" TEXT,
    "releaseId" TEXT,
    "sourceProvider" TEXT,
    "sourceRecordId" TEXT,
    "title" TEXT NOT NULL,
    "category" "ReleaseCategory",
    "artistCredit" TEXT,
    "releaseDate" TIMESTAMP(3),
    "datePrecision" "DatePrecision",
    "catalogNumber" TEXT,
    "barcode" TEXT,
    "payload" JSONB,
    "disposition" "ResearchDisposition" NOT NULL DEFAULT 'DISCOVERED',
    "lastStage" TEXT,
    "finalReasonCode" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "coverImageUrl" TEXT,
    "coverImageSourceUrl" TEXT,
    "coverStatus" "CoverStatus" NOT NULL DEFAULT 'MISSING',
    "coverProvider" TEXT,
    "coverCheckedAt" TIMESTAMP(3),
    "coverAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "coverNextRetryAt" TIMESTAMP(3),
    "coverLastErrorCode" TEXT,
    "coverLastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchDecision" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "stage" TEXT NOT NULL,
    "outcome" "ResearchDecisionOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "sourceProvider" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchStageSummary" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "inputCount" INTEGER NOT NULL DEFAULT 0,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "deferredCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "mergedCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "reasonCounts" JSONB,
    "detailsComplete" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchStageSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseWork_musicBrainzReleaseGroupId_key" ON "ReleaseWork"("musicBrainzReleaseGroupId");

-- CreateIndex
CREATE INDEX "ReleaseWork_artistId_category_originalReleaseDate_idx" ON "ReleaseWork"("artistId", "category", "originalReleaseDate");

-- CreateIndex
CREATE INDEX "ReleaseWork_artistId_verificationStatus_idx" ON "ReleaseWork"("artistId", "verificationStatus");

-- CreateIndex
CREATE INDEX "ReleaseWorkSource_workId_role_idx" ON "ReleaseWorkSource"("workId", "role");

-- CreateIndex
CREATE INDEX "ReleaseWorkSource_provider_externalId_idx" ON "ReleaseWorkSource"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_taskId_disposition_lastStage_idx" ON "ResearchCandidate"("taskId", "disposition", "lastStage");

-- CreateIndex
CREATE INDEX "ResearchCandidate_parentCandidateId_idx" ON "ResearchCandidate"("parentCandidateId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_workId_idx" ON "ResearchCandidate"("workId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_releaseId_idx" ON "ResearchCandidate"("releaseId");

-- CreateIndex
CREATE INDEX "ResearchCandidate_coverStatus_coverNextRetryAt_idx" ON "ResearchCandidate"("coverStatus", "coverNextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCandidate_taskId_candidateKey_key" ON "ResearchCandidate"("taskId", "candidateKey");

-- CreateIndex
CREATE INDEX "ResearchDecision_candidateId_stage_idx" ON "ResearchDecision"("candidateId", "stage");

-- CreateIndex
CREATE INDEX "ResearchDecision_stage_outcome_reasonCode_idx" ON "ResearchDecision"("stage", "outcome", "reasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDecision_candidateId_sequence_key" ON "ResearchDecision"("candidateId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchStageSummary_taskId_stage_key" ON "ResearchStageSummary"("taskId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchStageSummary_taskId_sequence_key" ON "ResearchStageSummary"("taskId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Release_musicBrainzReleaseId_key" ON "Release"("musicBrainzReleaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Release_discogsReleaseId_key" ON "Release"("discogsReleaseId");

-- CreateIndex
CREATE INDEX "Release_artistId_originalCatalogNo_idx" ON "Release"("artistId", "originalCatalogNo");

-- CreateIndex
CREATE INDEX "Release_workId_editionReleaseDate_idx" ON "Release"("workId", "editionReleaseDate");

-- CreateIndex
CREATE INDEX "Release_coverStatus_coverNextRetryAt_idx" ON "Release"("coverStatus", "coverNextRetryAt");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_workId_fkey" FOREIGN KEY ("workId") REFERENCES "ReleaseWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseWork" ADD CONSTRAINT "ReleaseWork_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseWorkSource" ADD CONSTRAINT "ReleaseWorkSource_workId_fkey" FOREIGN KEY ("workId") REFERENCES "ReleaseWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiSearchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_parentCandidateId_fkey" FOREIGN KEY ("parentCandidateId") REFERENCES "ResearchCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_workId_fkey" FOREIGN KEY ("workId") REFERENCES "ReleaseWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCandidate" ADD CONSTRAINT "ResearchCandidate_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchDecision" ADD CONSTRAINT "ResearchDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ResearchCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchStageSummary" ADD CONSTRAINT "ResearchStageSummary_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiSearchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraints. They are added NOT VALID first so PostgreSQL can add them
-- without a long table lock, then validated against the small local dataset.
ALTER TABLE "AiSearchTask"
ADD CONSTRAINT "AiSearchTask_progress_check"
CHECK ("progress" BETWEEN 0 AND 100) NOT VALID;

ALTER TABLE "AiSearchTask"
ADD CONSTRAINT "AiSearchTask_resultSchemaVersion_check"
CHECK ("resultSchemaVersion" >= 1) NOT VALID;

ALTER TABLE "Release"
ADD CONSTRAINT "Release_coverAttemptCount_check"
CHECK ("coverAttemptCount" >= 0) NOT VALID;

ALTER TABLE "Release"
ADD CONSTRAINT "Release_edition_date_precision_check"
CHECK (
  ("editionReleaseDate" IS NULL AND "editionDatePrecision" IS NULL)
  OR ("editionReleaseDate" IS NOT NULL AND "editionDatePrecision" IS NOT NULL)
) NOT VALID;

ALTER TABLE "ReleaseWork"
ADD CONSTRAINT "ReleaseWork_original_date_precision_check"
CHECK (
  ("originalReleaseDate" IS NULL AND "originalDatePrecision" IS NULL)
  OR ("originalReleaseDate" IS NOT NULL AND "originalDatePrecision" IS NOT NULL)
) NOT VALID;

ALTER TABLE "ResearchCandidate"
ADD CONSTRAINT "ResearchCandidate_date_precision_check"
CHECK (
  ("releaseDate" IS NULL AND "datePrecision" IS NULL)
  OR ("releaseDate" IS NOT NULL AND "datePrecision" IS NOT NULL)
) NOT VALID;

ALTER TABLE "ResearchCandidate"
ADD CONSTRAINT "ResearchCandidate_coverAttemptCount_check"
CHECK ("coverAttemptCount" >= 0) NOT VALID;

ALTER TABLE "ResearchCandidate"
ADD CONSTRAINT "ResearchCandidate_not_own_parent_check"
CHECK ("parentCandidateId" IS NULL OR "parentCandidateId" <> "id") NOT VALID;

ALTER TABLE "ResearchDecision"
ADD CONSTRAINT "ResearchDecision_sequence_attempt_check"
CHECK ("sequence" >= 0 AND "attempt" >= 1) NOT VALID;

ALTER TABLE "ResearchStageSummary"
ADD CONSTRAINT "ResearchStageSummary_counts_check"
CHECK (
  "sequence" >= 0
  AND "inputCount" >= 0
  AND "passedCount" >= 0
  AND "deferredCount" >= 0
  AND "rejectedCount" >= 0
  AND "mergedCount" >= 0
  AND "retryCount" >= 0
) NOT VALID;

ALTER TABLE "AiSearchTask" VALIDATE CONSTRAINT "AiSearchTask_progress_check";
ALTER TABLE "AiSearchTask" VALIDATE CONSTRAINT "AiSearchTask_resultSchemaVersion_check";
ALTER TABLE "Release" VALIDATE CONSTRAINT "Release_coverAttemptCount_check";
ALTER TABLE "Release" VALIDATE CONSTRAINT "Release_edition_date_precision_check";
ALTER TABLE "ReleaseWork" VALIDATE CONSTRAINT "ReleaseWork_original_date_precision_check";
ALTER TABLE "ResearchCandidate" VALIDATE CONSTRAINT "ResearchCandidate_date_precision_check";
ALTER TABLE "ResearchCandidate" VALIDATE CONSTRAINT "ResearchCandidate_coverAttemptCount_check";
ALTER TABLE "ResearchCandidate" VALIDATE CONSTRAINT "ResearchCandidate_not_own_parent_check";
ALTER TABLE "ResearchDecision" VALIDATE CONSTRAINT "ResearchDecision_sequence_attempt_check";
ALTER TABLE "ResearchStageSummary" VALIDATE CONSTRAINT "ResearchStageSummary_counts_check";

-- Extend the existing hard final gate: VERIFIED now also means the cover has
-- passed the explicit durable cover state machine.
ALTER TABLE "Release"
DROP CONSTRAINT "Release_verified_evidence_cover_check";

ALTER TABLE "Release"
ADD CONSTRAINT "Release_verified_evidence_cover_check"
CHECK (
  "verificationStatus" <> 'VERIFIED'
  OR (
    "verificationEvidence" IS NOT NULL
    AND "verifiedAt" IS NOT NULL
    AND "coverImageUrl" IS NOT NULL
    AND length(btrim("coverImageUrl")) > 0
    AND "coverStatus" = 'VALID'
  )
);
