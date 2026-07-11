-- A release may only claim VERIFIED when its evidence, verification time, and
-- non-empty cover URL are stored together. Application-level checks remain
-- stricter (trusted sources, freshness, and live image revalidation).
ALTER TABLE "Release"
ADD CONSTRAINT "Release_verified_evidence_cover_check"
CHECK (
  "verificationStatus" <> 'VERIFIED'
  OR (
    "verificationEvidence" IS NOT NULL
    AND "verifiedAt" IS NOT NULL
    AND "coverImageUrl" IS NOT NULL
    AND length(btrim("coverImageUrl")) > 0
  )
);
