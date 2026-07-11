export const DISCOGS_API_ORIGIN = "https://api.discogs.com";
export const DISCOGS_WEB_ORIGIN = "https://www.discogs.com";

export const DEFAULT_DISCOGS_USER_AGENT =
  "CD-BOX/1.0 (+https://github.com/KAtOReNA7/CD-BOX)";

export const DISCOGS_ATTRIBUTION = Object.freeze({
  dataNotice: "Data provided by Discogs.",
  nonAffiliationNotice:
    "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.",
  apiDocumentationUrl: "https://www.discogs.com/developers",
  termsUrl:
    "https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use",
});

const ALLOWED_DISCOGS_IMAGE_HOSTS = new Set([
  "api.discogs.com",
  "www.discogs.com",
  "i.discogs.com",
]);

export function isAllowedDiscogsImageUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ALLOWED_DISCOGS_IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function discogsReleaseApiUrl(releaseId: number) {
  return `${DISCOGS_API_ORIGIN}/releases/${releaseId}`;
}

export function discogsReleaseSourceUrl(releaseId: number) {
  return `${DISCOGS_WEB_ORIGIN}/release/${releaseId}`;
}
