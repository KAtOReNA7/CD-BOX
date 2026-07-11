-- Existing rows remain available for automated backfill but are not claimed as
-- verified until the cross-source evidence and cover checks have completed.
CREATE TYPE "ReleaseVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

ALTER TABLE "Release"
ADD COLUMN "verificationStatus" "ReleaseVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "verificationEvidence" JSONB,
ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE INDEX "Release_artistId_verificationStatus_idx"
ON "Release"("artistId", "verificationStatus");
