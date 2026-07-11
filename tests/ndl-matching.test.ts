import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchNdlCandidate,
  matchNdlCandidateForAiAudit,
  parseNdlIssuedDate,
  type NdlCandidate,
  type NdlRecord,
  type NdlSearchResponse,
} from "@/lib/ndl";

const record: NdlRecord = {
  recordId: "R100000002-I000008888764",
  sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
  title: "中山美穂/サマー・ブリーズ",
  creators: [],
  publishers: ["キング"],
  issued: "1986-08",
  issuedRaw: "1986.8",
  issuedPrecision: "month",
  identifiers: ["K32X-100", "000008888764"],
  identifierDetails: [
    { value: "K32X-100", scheme: "dcndl:RIS502" },
    { value: "000008888764", scheme: "dcndl:NDLBibID" },
  ],
  catalogNumbers: ["K32X-100"],
};

const candidate: NdlCandidate = {
  artist: "中山美穂",
  title: "SUMMER BREEZE",
  titleAliases: ["サマー・ブリーズ"],
  catalogNumber: "K32X 100",
  date: "1986-08-05",
};

function result(records: NdlRecord[], complete = true): NdlSearchResponse {
  return {
    queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch?fixture=1",
    sourceTotal: complete ? records.length : records.length + 1,
    records,
    complete,
  };
}

test("accepts one exact catalog record only when artist, controlled title, and common date precision agree", () => {
  const decision = matchNdlCandidate(candidate, result([record]));
  assert.equal(decision.reason, null);
  assert.equal(decision.evidence?.sourceType, "national-bibliography");
  assert.equal(decision.evidence?.recordId, record.recordId);
  assert.equal(decision.evidence?.observedCatalogNumber, "K32X-100");
  assert.equal(decision.evidence?.observedIssued, "1986-08");
  assert.equal(decision.evidence?.authoritativeTitle, "サマー・ブリーズ");
  assert.equal(decision.evidence?.observedIssuedPrecision, "month");
  assert.deepEqual(decision.evidence?.matchedFields, ["artist", "catalogNumber", "title", "date"]);
  assert.equal(matchNdlCandidate({
    ...candidate,
    artist: "Miho Nakayama",
    artistAliases: ["中山美穂"],
  }, result([record])).reason, null);
});

test("does not strip an artist name that is a natural prefix of the work title", () => {
  const naturalPrefixRecord: NdlRecord = {
    ...record,
    title: "中山美穂物語",
    creators: ["中山美穂"],
  };
  const naturalPrefixCandidate: NdlCandidate = {
    ...candidate,
    title: "物語",
    titleAliases: [],
  };
  assert.equal(
    matchNdlCandidate(naturalPrefixCandidate, result([naturalPrefixRecord])).reason,
    "title-mismatch",
  );
  assert.equal(
    matchNdlCandidateForAiAudit(naturalPrefixCandidate, result([naturalPrefixRecord])).reason,
    "title-mismatch",
  );
});

test("fails closed for incomplete or ambiguous catalog results", () => {
  assert.equal(matchNdlCandidate(candidate, result([record], false)).reason, "incomplete-results");
  assert.equal(matchNdlCandidate(candidate, result([])).reason, "catalog-not-found");
  const duplicate = {
    ...record,
    recordId: "R100000002-I000008888765",
    sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888765",
  };
  assert.equal(matchNdlCandidate(candidate, result([record, duplicate])).reason, "ambiguous-catalog");
});

test("fails closed on artist, title, or shared date conflicts", () => {
  assert.equal(
    matchNdlCandidate({ ...candidate, artist: "松田聖子" }, result([record])).reason,
    "artist-mismatch",
  );
  assert.equal(
    matchNdlCandidate({ ...candidate, title: "別のアルバム", titleAliases: [] }, result([record])).reason,
    "title-mismatch",
  );
  assert.equal(
    matchNdlCandidate({ ...candidate, date: "1986-09-05" }, result([record])).reason,
    "date-conflict",
  );
});

test("binds a different-script title to one exact catalog record only for the AI audit", () => {
  const withoutJapaneseAlias = { ...candidate, titleAliases: [] };
  assert.equal(matchNdlCandidate(withoutJapaneseAlias, result([record])).reason, "title-mismatch");
  const decision = matchNdlCandidateForAiAudit(withoutJapaneseAlias, result([record]));
  assert.equal(decision.reason, null);
  assert.equal(decision.evidence?.titleComparison, "requires-ai");
  assert.deepEqual(decision.evidence?.matchedFields, ["artist", "catalogNumber", "date"]);
  assert.equal(
    matchNdlCandidateForAiAudit(
      { ...candidate, title: "別のアルバム", titleAliases: [] },
      result([record]),
    ).reason,
    "title-mismatch",
  );
});

test("parses only valid year, month, and day precision dates", () => {
  assert.deepEqual(parseNdlIssuedDate("1986"), { value: "1986", precision: "year" });
  assert.deepEqual(parseNdlIssuedDate("[1986.8]"), { value: "1986-08", precision: "month" });
  assert.deepEqual(parseNdlIssuedDate("1986/08/05"), { value: "1986-08-05", precision: "day" });
  assert.equal(parseNdlIssuedDate("1986-02-31"), null);
  assert.equal(parseNdlIssuedDate("circa 1986"), null);
});
