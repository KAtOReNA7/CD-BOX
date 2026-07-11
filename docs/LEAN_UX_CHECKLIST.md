# Lean UX Checklist

Current goal: keep the single-owner CD-BOX production MVP centered on the core collector loop. The original Phase 4 preference for pasted-source-first AI has been superseded by the online-search-first launch requirement.

Core loop:

1. Choose an artist.
2. Build or import a release list.
3. Mark owned, not owned, wanted, pending review, or excluded.
4. See completion and gaps.
5. Fill missing metadata, sources, and cover URLs.
6. Export a backup.

Checks:

- [x] The signed-in owner can reach import from the main navigation and start an Excel import within 3 steps.
- [x] GitHub is the only sign-in provider and the configured owner login is allowlisted.
- [x] No user-management workflow is exposed; artists and releases use one shared catalog.
- [x] Artist pages show completion rate and gap count above the table.
- [x] Artist pages include a one-click gap view.
- [x] Table rows allow quick owned/wanted/pending/excluded marking.
- [x] Missing cover rows are available from the default filter area.
- [x] Excel export is available from the artist page.
- [x] The default table has no more than 9 business columns.
- [x] Online search is the primary AI workflow when `web_search` is configured.
- [x] Missing `web_search` capability blocks online research instead of silently falling back.
- [x] Advanced filters, category completion, and advanced bulk operations are collapsed by default.
- [x] No image-generation or generated cover-art workflow is enabled for the production MVP.
- [x] Verify real Responses API `web_search` against the production relay.
- [ ] Complete deployed end-to-end acceptance on Vercel and Neon.
