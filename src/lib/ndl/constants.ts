export const NDL_SEARCH_ORIGIN = "https://ndlsearch.ndl.go.jp";
export const NDL_SEARCH_API_URL = `${NDL_SEARCH_ORIGIN}/api/opensearch`;

export const NDL_SEARCH_ATTRIBUTION = {
  provider: "National Diet Library, Japan",
  displayNotice: "This application uses the NDL Search API.",
  dataNotice: "Bibliographic metadata provided by the National Diet Library Search API.",
  providerUrl: `${NDL_SEARCH_ORIGIN}/`,
  apiTermsUrl: `${NDL_SEARCH_ORIGIN}/help/api`,
  licenseName: "Creative Commons Attribution 4.0 International",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;

export const NDL_EVIDENCE_ROLE = "national-bibliography" as const;
