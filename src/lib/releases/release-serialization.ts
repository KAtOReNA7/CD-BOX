import type { Prisma, Release, ReleaseSource, UserReleaseStatus } from "@prisma/client";
import {
  canonicalCollectionStatus,
  clampCollectionPriority,
  type ReleaseListItem,
} from "@/lib/releases/release-types";

type ReleaseSerializationFields = Pick<
  Release,
  | "id"
  | "artistId"
  | "category"
  | "title"
  | "originalReleaseDate"
  | "format"
  | "originalCatalogNo"
  | "label"
  | "originalPrice"
  | "editionType"
  | "isReissue"
  | "isRemaster"
  | "isExcludedByDefault"
  | "confidence"
  | "warnings"
  | "notes"
  | "coverImageUrl"
  | "importBatchId"
  | "createdAt"
  | "updatedAt"
>;

type ReleaseVerificationFields = Pick<Release, "verificationStatus" | "verificationEvidence" | "verifiedAt">;

/** Keep list serialization compatible while persistence gains work/edition and
 * cover-retry fields that the list response does not expose yet. */
export type SerializableRelease = ReleaseSerializationFields &
  Partial<ReleaseVerificationFields> & {
  sources: ReleaseSource[];
  userStatus?: UserReleaseStatus[];
};

function warningsToStrings(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * User collection state is private even though release metadata is shared.
 * A caller must explicitly name a user before any status can be serialized.
 */
export function serializeRelease(release: SerializableRelease, userId?: string | null): ReleaseListItem {
  const status = userId ? release.userStatus?.find((item) => item.userId === userId) : undefined;
  const canonicalStatus = status ? canonicalCollectionStatus(status.status) : null;

  return {
    id: release.id,
    artistId: release.artistId,
    category: release.category,
    title: release.title,
    originalReleaseDate: release.originalReleaseDate?.toISOString().slice(0, 10) ?? null,
    format: release.format,
    originalCatalogNo: release.originalCatalogNo,
    label: release.label,
    originalPrice: release.originalPrice,
    editionType: release.editionType,
    isReissue: release.isReissue,
    isRemaster: release.isRemaster,
    isExcludedByDefault: release.isExcludedByDefault,
    confidence: release.confidence,
    warnings: warningsToStrings(release.warnings),
    notes: release.notes,
    coverImageUrl: release.coverImageUrl,
    verificationStatus: release.verificationStatus ?? "UNVERIFIED",
    verificationEvidence: release.verificationEvidence ?? null,
    verifiedAt: release.verifiedAt?.toISOString() ?? null,
    sources: release.sources.map((source) => ({
      id: source.id,
      url: source.url,
      label: source.label,
      description: source.description,
    })),
    userStatus: status && canonicalStatus
      ? {
          id: status.id,
          status: canonicalStatus,
          priority: clampCollectionPriority(status.priority),
          ownedCondition: status.ownedCondition,
          ownedNotes: status.ownedNotes,
          notes: status.notes,
        }
      : null,
  };
}
