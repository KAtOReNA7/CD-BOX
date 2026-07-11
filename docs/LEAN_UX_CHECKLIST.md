# Lean UX Checklist

Current goal: keep the local single-owner CD-BOX centered on the core collector loop, with fail-closed, authoritative online verification as the primary AI workflow. Vercel is not part of the runtime or release path.

Core loop:

1. Choose an artist.
2. Build or import an automatically verified, cover-complete release list.
3. Mark owned, not owned, wanted, pending review, or excluded.
4. See completion and gaps.
5. Keep unverified or coverless rows quarantined until automatic verification succeeds.
6. Export a backup.

Checks:

- [x] The local owner can reach import from the main navigation and start an Excel import within 3 steps.
- [x] Local owner mode accepts only the configured numeric loopback origin.
- [x] No user-management workflow is exposed; artists and releases use one shared catalog.
- [x] Artist pages show completion rate and gap count above the table.
- [x] Artist pages include a one-click gap view.
- [x] Table rows allow quick owned/wanted/pending/excluded marking.
- [x] Normal artist pages hide unverified and coverless rows; those records cannot be selected or imported as final entries.
- [x] Excel export is available from the artist page.
- [x] The default table has no more than 9 business columns.
- [x] Evidence-backed online research is the primary AI workflow: MusicBrainz complete pagination/grouping → NDL national-bibliography hard gate → Discogs corroboration → GPT-5.6 evidence-only audit.
- [x] Missing native `web_search` capability uses the public-source verification pipeline instead of presenting ordinary chat as search.
- [x] GPT-5.6 may reject supplied evidence but cannot invent facts, change source fields, or override deterministic gates.
- [x] Cover completion uses only exact-release CAA or the exact Discogs release's `primary` image, then verifies real file signatures, MIME and dimensions.
- [x] Search progress names the real grouping, bibliography, corroboration, AI-audit, cover-validation, and save stages.
- [x] The global shell and research results retain NDL Search/CC BY 4.0 attribution plus Discogs data and non-affiliation notices.
- [x] NDL and Discogs clients use visible User-Agents, serialized request pacing, bounded retries, and fail closed on partial evidence.
- [x] Historical verification is preview-first with `npm run library:verify`; only `npm run library:verify:apply` writes approved updates.
- [x] Advanced filters, category completion, and advanced bulk operations are collapsed by default.
- [x] No image-generation or generated cover-art workflow is enabled for the production MVP.
- [x] Verify GPT-5.6 Chat/JSON capability and strict public-metadata fallback behavior.
- [ ] Complete local end-to-end acceptance on `127.0.0.1` and local PostgreSQL.
