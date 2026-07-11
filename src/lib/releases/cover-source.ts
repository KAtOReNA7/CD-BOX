export const COVER_IMAGE_SOURCE_DESCRIPTION = "cover-image-source";

export function isCoverSourceDescription(value: string | null | undefined) {
  return value === COVER_IMAGE_SOURCE_DESCRIPTION;
}

export function isAppleMusicSourceUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "music.apple.com" ||
      hostname.endsWith(".music.apple.com") ||
      hostname === "itunes.apple.com" ||
      hostname.endsWith(".itunes.apple.com")
    );
  } catch {
    return false;
  }
}

export function findAppleCoverSource<
  T extends { url: string; label: string | null; description: string | null },
>(sources: readonly T[]) {
  const source = findCoverSource(sources);
  return source && isAppleMusicSourceUrl(source.url) ? source : undefined;
}

export function findCoverSource<
  T extends { url: string; label: string | null; description: string | null },
>(sources: readonly T[]) {
  return sources.find(
    (source) =>
      isCoverSourceDescription(source.description),
  );
}

export function releaseEvidenceSources<T extends { description: string | null }>(
  sources: readonly T[],
) {
  return sources.filter((source) => !isCoverSourceDescription(source.description));
}

export function buildImportedReleaseSourceRows(
  sources: readonly { url: string; title: string; sourceType: string }[],
  coverImageSourceUrl: string | null,
) {
  const releaseSources = new Map(
    sources.map((source) => [
      source.url,
      {
        url: source.url,
        label: source.title,
        description: source.sourceType,
      },
    ]),
  );
  const rows = [...releaseSources.values()];

  if (coverImageSourceUrl) {
    rows.push({
      url: coverImageSourceUrl,
      label: isAppleMusicSourceUrl(coverImageSourceUrl)
        ? "Apple Music"
        : "Cover image source",
      description: COVER_IMAGE_SOURCE_DESCRIPTION,
    });
  }

  return rows;
}
