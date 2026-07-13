# Discography completeness benchmark

> 迁移期说明（2026-07-13）：本文和当前 manifest 定义的是旧 `ORIGINAL_CD` 范围的回归 oracle。它可以验证既有四艺人 final suite 的目录守恒和旧封面门禁，但不能替代 [PRODUCT_SPEC.md](PRODUCT_SPEC.md) 冻结的八艺人、全部官方发行、作品／嵌套版本及封面独立状态验收。当前差距见 [PROGRESS.md](PROGRESS.md)。

This benchmark answers two deliberately separate questions: **did CD-BOX retain every authoritative core work, and which retained works are safe to publish?** A work can be known and accounted for while it remains `pendingEvidence` or `pendingCover`; only a row with complete edition evidence and a validated cover can be `VERIFIED`. The default benchmark is deliberately independent of paid APIs and AI-model judgment.

The versioned acceptance manifest is stored at `src/data/authoritative-discography-manifests.json`. It is a regression oracle and bounded recovery seed, not self-sufficient production proof: a fixture row may restore a candidate that public discovery missed, but it cannot become `VERIFIED` merely by being copied from the fixture. Its cited authority must be represented in the evidence ledger and an independent physical-edition source must corroborate the selected CD carrier. The runner is `scripts/benchmark-discographies.ts`. The benchmark date is 2026-07-13.

## Counting policy

- The comparison grain is a **musical release work**. A regular CD, deluxe CD, remaster, reissue, regional pressing, and digital edition do not automatically become separate works.
- The default final scope is a Japanese physical CD catalog at work grain. Each in-scope work selects one earliest currently verified Japanese CD carrier; collaborations are included, while live/remix/best works remain outside the core unless the fixture explicitly declares otherwise.
- `originalReleaseDate` is the canonical work's first official release date. `editionReleaseDate` is the date of the selected Japanese CD edition. Many titles sharing a reissue or box-set date is not evidence that the works are false.
- `EXACT_EDITION` evidence uniquely binds artist, work, CD format, Japanese territory, catalog number, and edition date. `AVAILABLE_BY` proves only that a complete official CD representation existed by a stated date. It is an upper bound, not the first-CD date, and cannot override an earlier independently verified `EXACT_EDITION`.
- `exact` applies only to fixed or officially closed scopes. Both a shortfall and an overflow fail.
- `minimum` is retained for ordinary active-catalog diagnostics. A final-suite baseline must additionally declare a fresh `snapshotVerifiedAt`, a latest authority anchor, and `finalSnapshotKind: exact`. A row that is proved newer than the snapshot is retained as a post-snapshot audit candidate and triggers fixture refresh; it is not silently discarded or published merely because the old exact snapshot does not contain it. An unidentified overflow within the snapshot remains a failure.
- Product-page counts (for example, Oricon's 58 中山美穂 single products) are useful edition evidence but are not substituted for an official 39-single work count.
- A label's complete-single CD set can establish a later physical-CD representation only when it explicitly preserves the complete single and C/W boundary. A normal best album that happens to contain the A-side is track evidence, not a CD edition of that single work.
- Category membership follows an artist/label's explicit numbered canon when one exists. Content heuristics may reject unrelated best/live/remix/cover projects, but may not silently remove a label-classified exception and still claim the label's published ordinal count. 松田聖子 is the regression case: Sony includes `Eternal`, `Sweet Memories '93`, and `Eternal II` in its 32-title original-album catalog, while `SEIKO JAZZ` and `Guardian Angel` remain outside the 54-work numbered canon.
- Every authority-confirmed work enters the `canonicalWorks` ledger. Within that completeness ledger it is accounted as `pendingEvidence`, `pendingCover`, `VERIFIED`, or an explicit scope resolution with both stage and reason; non-canonical candidates use a separate explicit rejection record. A pending work remains part of canonical recall; only `VERIFIED` contributes to publishable coverage.
- Canonical work identity requires a versioned authority such as an artist/label catalog or national bibliography. Physical-edition publication requires an independent entity-level corroboration. One unavailable or empty provider is not negative proof and cannot silently remove a work.
- GPT is not a mandatory vote for deterministic catalog-number, media, territory, or date matches. It is reserved for cross-script title equivalence, alias ownership, or material conflicts and may only compare supplied evidence.
- A correct work without a validated cover remains `pendingCover`. Cover lookup uses cached, bounded retries. It must not be published as final, but cover absence must not reduce canonical metadata recall or cause an unbounded synchronous task.

## Real-world test set

| Artist | Why it is included | Versioned core baseline | Authority and scope |
| --- | --- | --- | --- |
| 中山美穂 | Japanese aliases, collaboration credit, same-day reissues | exact 39 singles + 22 original albums | [King Records: 39 single works](https://www.kingrecords.co.jp/cs/g/gKICS-93968/); [Sponichi/label briefing: 22 original albums and 506 tracks](https://www.sponichi.co.jp/entertainment/news/2020/11/19/kiji/20201119s00041000026000c.html) |
| 松田聖子 | Active, large multi-label and multi-territory catalog | final exact snapshot verified 2026-07-13: 77 singles + 54 label-numbered original albums | [Official current singles](https://www.seikomatsuda.co.jp/discography/single); [official current albums](https://www.seikomatsuda.co.jp/discography/album); [Universal current catalog](https://www.universal-music.co.jp/matsuda-seiko/discography/); [Sony Complete Bible](https://www.sonymusic.co.jp/artist/SeikoMatsuda/discography/buy/SRCL-3661); [2021 product](https://www.universal-music.co.jp/matsuda-seiko/products/upch-20591/) |
| 中森明菜 | Active, multi-label, current-freshness and carrier-scope check | 55 officially numbered single works / 54 confirmed-CD works as of 2026-07-01 + 25 original albums through 2017-11-08 | [Official profile: numbered singles No.1-No.54](https://akinanakamoriofficial.com/profile/); [Warner: ごめんと、すきと、 is the 55th single and a CD](https://wmg.jp/akina/discography/33083/); [Warner: complete-program Singles Box](https://wmg.jp/akina/discography/11915/); [Universal: Crazy Love is a digital single](https://www.universal-music.co.jp/nakamori-akina/products/upch-1990/); [Warner: first album through CRUISE are 14 studio albums](https://wmg.jp/akina/discography/11264/); [Universal: nine later original albums](https://www.universal-music.co.jp/nakamori-akina/products/upjy-9337/); [Tokuma: SPOON](https://www.tkma.co.jp/release_detail/id=5426) and [will](https://www.tkma.co.jp/release_detail/id=5427) |
| 小泉今日子 | Solo/collaboration credits and a later digital-only restart | minimum 50 physical/CD-scope singles through 2017 | [Victor: complete 50-single set through 2017](https://www.jvcmusic.co.jp/-/News/A000330/85.html); the 2026 digital-only バディ remains outside `ORIGINAL_CD` |
| 山口百恵 | Fixed retired catalog, box/disc-count trap | exact 32 singles + 22 original albums | [Sony: ordered program for all 32 singles](https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-30295); [Sony: all 22 original albums](https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-2270) |
| 松任谷由実 | Active, 荒井由実/松任谷由実/Yumi AraI aliases, multi-format edition | minimum 40 original albums as of 2025-11-18 | [Universal: 40th Original Album](https://www.universal-music.co.jp/matsutoya-yumi/news/2025-10-01/); [official product/date](https://www.universal-music.co.jp/matsutoya-yumi/products/upch-20710/) |
| テレサ・テン | Japanese, traditional/simplified Chinese, and romanized identities | exact 30 Japanese singles + 28-title original-album series | [Universal: every Japanese single, 30 discs](https://www.universal-music.co.jp/teresa-teng/products/upcy-9551/); [Universal: all 28 original-album titles](https://www.universal-music.co.jp/teresa-teng/products/d2ct-1067/) |
| The Beatles | English catalog and UK/US regional configurations | exact 13 UK studio albums | [official Beatles site: 13 U.K. studio albums](https://www.thebeatles.com/beatles-anthology-streaming-now); [official US store: US albums differ in tracks, mixes, titles, and art](https://usastore.thebeatles.com/products/the-beatles-the-u-s-albums-cd-box-set) |

The exact quotations, source authority class, date, scope note, aliases, required title anchors, known non-core items, and edition traps are stored in the JSON fixture rather than duplicated in code.

### 松田聖子 77-single carrier mapping

The artist site's 96 product rows through 2016 reduce to 77 works only after same-date limited, regular, DVD, and cassette product editions are consolidated by their complete titles. Double-A identities remain whole—such as `ガラスの林檎 / SWEET MEMORIES`, `時間の国のアリス / 夏服のイヴ`, `True Love Story / さよならのKISSを忘れない`, `特別な恋人/声だけ聞かせて`, and `永遠のもっと果てまで/惑星になりたい`—and neither side is stored as a substring alias. `WE ARE. / PawPaw` is parsed as the title `WE ARE.` with the alternate PawPaw artist credit, not as a double-A title. Collaboration and overseas titles remain in the official order rather than being removed by artist-credit heuristics.

All 77 works remain in `ORIGINAL_CD` scope. Fifty have an original-date CD representation. The 25 analogue EP works through `旅立ちはフリージア`, the 12-inch `DANCING SHOES (Club Mix)`, and the cassette-origin `Who's that boy` use Sony's 2010 complete 73-single Blu-spec CD box as `LATER_OFFICIAL_EDITION` evidence. Sony's earlier `Complete Bible` independently confirms the same complete-single/C-W boundary through `素敵にOnce Again`; ordinary hit compilations are deliberately not accepted for that purpose. Because no official work in this dated 77-title catalog lacks a physical-CD representation, `officialCatalogTotal` and the scoped `expected` both remain 77.

### 中森明菜 55-single carrier mapping

The canonical work count follows the artist's current No.1-No.54 profile and Warner's explicitly labelled 55th single, not the smaller historical marketing counts retained on older label pages. The profile currently renders historical dates one day before the Japanese street dates, so the fixture uses its ordinal/title sequence while taking dates from label products and exact bibliographic records.

`officialCatalogTotal` is 55 and the `ORIGINAL_CD`-scoped `expected` is 54. Thirty works have an original-date CD issue: No.24-No.42, No.44-No.50, and No.52-No.55. `TATTOO`, `I MISSED "THE SHOCK"`, and `LIAR` retain both `VINYL` and `CD` in `originalFormats` because their 8cm CDs share the original release date. No.23 `AL-MAUJ（アルマージ）` remains `LATER_OFFICIAL_EDITION`: the vinyl work dates to 1988-01-27, while exact NDL evidence places CD `10SL-100` on 1988-02-25.

Twenty-four works use later-CD evidence. Warner's 2014 `Singles Box 1982-1991` supplies complete single-program CD evidence for No.1-No.22. DISC7 is an explicit shared-carrier exception: it contains the complete A/B programs for both No.7 `北ウイング／涙の形のイヤリング` and the separately numbered No.11 `北ウイング／リ・フ・レ・イ・ン`; those remain distinct canonical workIds even though one disc covers both. DISC18 is a dedicated CD replica of the cassette-origin No.19 `ノンフィクション エクスタシー`, so that work is not cassette-only in the final CD scope. No.43 `It's brand new day` is also `LATER_OFFICIAL_EDITION`: the canonical work debuted by digital distribution on 2001-05-31, followed by exact CD `NNCC-10001` on 2001-07-10.

Source-faithful spellings are bound to individual works rather than promoted to global artist aliases. The manifest records `Akina` only for No.12 `ミ・アモーレ` ([Discogs L-1668](https://www.discogs.com/release/3537736)) and No.35 `Tokyo Rose` ([Discogs MVDD-10017](https://www.discogs.com/release/5903387)); `明菜` / `Akina` plus the exact short title `Desire` only for No.16 ([Discogs L-1750](https://www.discogs.com/release/9502813)); and `Nakamori Akina` only for No.33 `月華` ([Discogs MVDD-10009](https://www.discogs.com/release/9842875)) and No.37 `APPETITE` ([Discogs MVDD-10027](https://www.discogs.com/release/9842936)). No.13 adds the complete Romanized A-side identity `Akaitori Nigeta` observed in the physical A/B title ([Discogs L-3601](https://www.discogs.com/release/7930588)). No.23 adds the exact Arabic MusicBrainz work-group title `آلموج`, whose [release group](https://musicbrainz.org/release-group/6c3cccc2-750d-4a2e-8445-a66f203070ef) independently carries the same 1988-01-27 date. These declarations let exact matchers recognize source rows without permitting a fuzzy, reversed-name, or stage-name match for any other work.

Known audit exceptions remain explicit. MusicBrainz dates No.44 `The Heat 〜musica fiesta〜` to 2002-05-27, conflicting with Universal's authoritative 2002-05-02 product date, so MusicBrainz is not silently accepted for that work. No.55 `ごめんと、すきと、` remains a 2026-07-01 CD backed by Warner even while the newly released `WPCL-13771` has not yet appeared in the complete Discogs Japan inventory.

No.51 `Crazy Love` is the sole `DIGITAL_ONLY` exclusion. Universal explicitly calls it a digital single. Its later presence as a track on the CD compilation `オールタイム・ベスト ‐オリジナル‐` does not create a CD edition of the canonical single work. The same rule applies generally: a compilation track appearance is insufficient unless an authority preserves the complete single/C/W program boundary.

## Offline run (default acceptance path)

The normal development gate reads versioned, desensitized captured application output. It makes no network request and calls no AI model. It must aggregate every mismatch in one report rather than stop at the first artist or first loss class:

```powershell
npx tsx scripts/benchmark-discographies.ts --input=var/discography-output.json
```

For a bare release array, identify the fixture explicitly:

```powershell
Get-Content var/miho-output.json -Raw |
  npx tsx scripts/benchmark-discographies.ts --input=- --artist=miho-nakayama
```

Supported input shapes are:

```json
{
  "artist": { "name": "中山美穂" },
  "releases": [
    {
      "title": "「C」",
      "category": "SINGLE",
      "workId": "stable-work-id",
      "originalReleaseDate": "1985-06-21",
      "coverImageUrl": "https://example.invalid/cover.jpg",
      "sources": [{ "url": "https://example.invalid/evidence" }]
    }
  ],
  "rejections": [
    {
      "title": "candidate title",
      "category": "SINGLE",
      "status": "REJECTED",
      "stage": "cross-source-audit",
      "reasonCode": "DATE_CONFLICT"
    }
  ]
}
```

It also accepts `{ "artists": [...] }`, a mapping keyed by artist, or a release array with `--artist`. Captured output must conserve the candidate ledger: a canonical work that is not in the final `releases` array must appear in `pendingEvidence`, `pendingCover`, or an explicit rejection/out-of-scope record.

## Public-source preflight (networked, no AI)

Only after offline replay is green may the public-source preflight refresh MusicBrainz, NDL, Discogs and approved cover-provider evidence. It runs serially, honors provider limits, reuses persisted responses and cover hashes, and checkpoints each artist and stage. A temporary HTTP/source outage is `inconclusive`; it cannot turn an authoritative work into a rejection.

```powershell
node --env-file=.env.local --import tsx --conditions=react-server scripts/preflight-authoritative-discographies.ts
```

The broader MusicBrainz live mode remains an optional source-gap diagnostic, not fixture truth and not final acceptance:

```powershell
npx tsx scripts/benchmark-discographies.ts --live --artist=miho-nakayama
npx tsx scripts/benchmark-discographies.ts --live --all --max-pages=3
```

Controls:

- AI is never called.
- MusicBrainz is limited to 100 release groups per request and at least 1,100 ms between requests.
- The default hard cap is three pages per artist; `--max-pages` is constrained to 1-10.
- NDL and Discogs use their configured serial rate limits, cached responses, bounded retry, and `Retry-After`.
- A capped or incomplete response is `INCONCLUSIVE_PARTIAL_SOURCE`, never proof of catalog absence.
- Prefer one-artist diagnostics during development. A full public preflight is required only after source adapters or evidence semantics change.

## Real end-to-end acceptance (one final AI suite)

The provider-backed suite is not a debugging loop. Run it only after offline replay, public-source preflight, `npm run check`, `npm run build`, migration status, local server, and worker verification are all green. `--final-suite` selects the complete versioned suite, refuses stale/incomplete fixtures before starting a provider-backed task, and emits `finalAcceptance: true` only after every required artist passes:

```powershell
node --env-file=.env.local --import tsx --conditions=react-server scripts/run-real-discography-tests.ts --final-suite
```

The complete suite may be started from scratch at most once for a release candidate. Tasks run serially and checkpoint after each artist. A failure must preserve completed artist results and emit all locally detectable violations; after an offline fix and all earlier gates pass again, only unresolved checkpoints may resume. Already successful artists must not be re-downloaded or re-sent to GPT when their inputs and evidence hashes are unchanged.

Each artist line includes its final-suite mode but is never itself marked final; only the trailing complete-suite record can be final. The runner accepts only the versioned fixture or a byte-identical copy. It verifies candidate-ledger count conservation, explicit reasons for every non-final candidate, canonical/ORIGINAL_CD accounting, physical-CD identity fields, work-bound authority plus independent edition corroboration, and provider-bound cover attestations. Cover validation reuses a matching cached content hash; a missing or changed cache entry is downloaded and decoded again. A cover URL or content SHA-256 reused across different works is rejected.

The request defaults are `ORIGINAL_CD`, reissues excluded, collaborations included, and `includeLiveRemixBest=false`; the wider live/remix/best option is forbidden in the final suite. Akina's report deliberately shows both values: canonical single canon `55`, ORIGINAL_CD final `54`, and one explicit `DIGITAL_ONLY` audit for `Crazy Love`. This is complete accounting, not a missing item.

## Output and pass criteria

Every artist report contains:

- `baselines`: authoritative canonical total, accounted total, publishable total, exact/minimum expected counts, and deltas;
- `missing`: named required anchors plus unnamed count shortfalls;
- `extra`: duplicate works, known non-core misclassifications, and unidentified exact-count overflow;
- `pendingEvidence`: authoritative core works still lacking independent Japanese physical-CD edition proof or resolution of a material conflict;
- `pendingCover`: edition-verified core works still lacking a validated cover asset from an approved provider;
- `unexplainedRejections`: rejected rows missing either the stage or reason;
- `postSnapshotCandidates`: works proved newer than an active artist's dated exact snapshot and retained for fixture refresh;
- `metrics`: anchor recall, accounted canonical recall, publishable evidence/cover coverage, duplicate rate, and explained-rejection coverage.

The gates distinguish completeness from publication safety:

| Metric | Required |
| --- | ---: |
| Required-anchor recall | 100% |
| Canonical baseline accounted across VERIFIED/pending/explicit exclusion | 100% |
| Evidence coverage of rows marked VERIFIED | 100% |
| Cover coverage of rows marked VERIFIED | 100% |
| Duplicate work rate after edition grouping | 0% |
| Rejections with both stage and reason | 100% |

For a fixed `exact` baseline, all versioned in-scope works must be `VERIFIED` for final release acceptance; pending rows still prove that recall was conserved but keep the final suite from passing. A dated active snapshot additionally permits separately reported, provably post-snapshot candidates to remain pending until fixture review. For a `minimum` baseline, the accounted canonical count must meet or exceed the dated bound. Explicit work IDs take precedence over normalized titles when counting; repeated rows for one work ID and one normalized title split across multiple work IDs are both duplicate conflicts. Dated anchors require the original date as well as the title/category. Additional collections/live/remix releases outside the declared core categories are not automatically errors; they become errors only when misclassified into the core or double-counted as editions.

The accounting invariant is:

```text
canonical works = VERIFIED + pendingEvidence + pendingCover + explicit in-scope resolution/exclusion
```

No filter, provider outage, GPT failure, or cover failure may reduce the left-hand side without a corresponding audited record on the right-hand side.

## Tests

The repository test verifies fixture structure/provenance, required artists, exact-versus-minimum semantics, Japanese Unicode normalization, complete-catalog success, and separate reporting of every loss class:

```powershell
npx tsx --conditions=react-server --test tests/discography-benchmark.test.ts
npm test
npm run typecheck
```

The fixture remains a stable acceptance oracle, not runtime catalog input. Refresh active-artist snapshots only with a dated official source and a reviewed fixture diff; do not let a transient live scrape rewrite it automatically, and do not discard a newer authoritative candidate merely because the current fixture predates it.
