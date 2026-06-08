# CD-BOX Progress

## 2026-06-08

### Phase 3.7

- Added "Pasted source structuring" mode to `/ai-search` for relay environments where `web_search` is unavailable.
- Added API route `POST /api/ai-search/structure-notes`.
- Added structuring service, parser, and types:
  - `src/lib/ai/release-structure.ts`
  - `src/lib/ai/release-structure-parser.ts`
  - `src/lib/ai/release-structure-types.ts`
- Reused the existing candidate preview, quality gates, duplicate protection, and import workflow.
- Added tests in `tests/release-structure-parser.test.ts`.
- Enforced that sources can only come from explicit URLs in pasted text or user-provided source URL.
- Enforced that cover image URLs are not invented and are only preserved when explicitly provided.

### Phase 3.6

- Made OpenAI-compatible relay configuration explicit.
- `OPENAI_BASE_URL` is now required for AI client creation; CD-BOX no longer falls back to the official OpenAI base URL.
- Added provider capability helpers in `src/lib/ai/provider-capabilities.ts`.
- Added `npm run probe:ai` through `scripts/probe-ai-provider.mjs`.
- Probe checks required config, text smoke, JSON output, Responses API, `web_search`, Chat Completions fallback, and image model configuration without generating images.
- `/ai-search` now displays AI relay capability status and disables release search when `web_search` is not configured as available.
- Release research refuses to run when Responses API or `web_search` capability is unavailable. It does not fallback to ordinary chat completions for fake search results.
- `scripts/smoke-real-ai-search.mjs` now runs capability checks before real Miho Nakayama search and stops when `webSearchSupported=false`.
- Added `tests/ai-provider-config.test.ts` covering missing base URL, key redaction, web search gating, Responses API gating, and chat fallback boundaries.

Local probe result:

- `OPENAI_API_KEY`: missing
- `OPENAI_BASE_URL`: missing
- `OPENAI_TEXT_MODEL`: missing
- Real AI search was not executed.

### Phase 3

- Added GPT-5.5 release research workflow for `/ai-search`.
- Implemented OpenAI Responses API web search through `src/lib/ai/client.ts` with `tools: [{ type: "web_search" }]` and forced `tool_choice: "required"` for user-started searches.
- Added release research services and types:
  - `src/lib/ai/release-research.ts`
  - `src/lib/ai/release-research-parser.ts`
  - `src/lib/ai/release-research-types.ts`
- Added API routes:
  - `POST /api/ai-search/release-research`
  - `GET /api/ai-search/tasks/[id]`
  - `POST /api/ai-search/tasks/[id]/import`
- Expanded `AiSearchTask` with `rawResult`, `parsedResult`, and `errorMessage`.
- Added candidate preview, category/confidence filters, selection, exclusion marking, pending-review marking, expandable sources and warnings, and candidate import.
- Added parser tests for normal JSON, markdown code blocks, wrapped JSON, missing catalog numbers, empty sources, and reissue exclusion defaults.

### Phase 3.5

- Added AI release research quality gates to prevent weak candidates from polluting the formal collection library.
- Added `src/lib/ai/release-research-quality.ts` and `tests/release-research-quality.test.ts`.
- Added `npm run smoke:real-ai-search` for manual real OpenAI smoke testing.
- Hardened candidate import so duplicate `title + catalogNumber` rows for the same artist are skipped instead of overwriting existing data.
- Forced low-quality imports into pending review when confidence is not HIGH, catalog number is missing, sources are missing, or warnings include `PENDING_REVIEW`.
- Added quality overview metrics to `/ai-search`: total candidates, safe imports, pending review, missing catalog, missing source, and default excluded.
- Changed default selection to only HIGH confidence candidates that are not excluded, have a catalog number, and have at least one source.
- Added import confirmation with counts for selected, skipped, and pending review rows.

Quality rules:

- Missing catalog number caps confidence at MEDIUM and marks pending review.
- Missing sources forces LOW confidence and marks pending review.
- Wikipedia-only sources cap confidence at MEDIUM and add an `only wiki source` warning.
- LP, Vinyl, record, cassette, tape, DVD, and Blu-ray formats are excluded by default under ORIGINAL_CD scope.
- Reissues are excluded by default when `excludeReissues` is true.

Real search smoke:

- Not executed in this environment because `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_TEXT_MODEL` are not set in the shell.
- `npm run smoke:real-ai-search` exits with a clear missing-key error and can be rerun after configuring environment variables.

### Phase 2.5

- Ran a smoke parse against the real local workbook.
- Confirmed only the A/B/C release sheets are parsed and instruction sheets are skipped.
- Enhanced header compatibility for real workbook headers including compact original CD date/catalog/source URL headers.
- Normalized Excel `Date` cells by local year/month/day to avoid date drift from timezone conversion.
- Added real-template header fixture coverage in `tests/import-real-template.test.ts`.
- Added `npm run smoke:real-import` for local smoke testing with a non-committed real workbook.

Smoke result:

- A sheet rows: 22
- B sheet rows: 39
- C sheet rows: 20
- Importable rows: 81
- Error rows: 0
- Source URL recognized: 81
- Cover image recognized: 0 because the real workbook does not include a cover image column

### Phase 2

- Added Excel import parsing with `xlsx` in `src/lib/import/excel-parser.ts`.
- Added import types and database write service in `src/lib/import/import-types.ts` and `src/lib/import/import-service.ts`.
- Added API routes: `POST /api/import/preview` and `POST /api/import/confirm`.
- Reworked `/import` into a drag-and-drop upload, preview, duplicate strategy, and confirm workflow.
- Added `/releases/[id]` to show release details and `ReleaseSource` URLs outside the main collection table.
- Added support for source URL to `ReleaseSource.url` and cover image to `Release.coverImageUrl`.
- Added `EXCLUDED`, `BEST`, and `COLLECTION` enum values for import compatibility.
- Added `sample-data/cd-box-import-sample.xlsx` plus parser test coverage through `npm run test:import`.

### Phase 1

- Initialized the Next.js App Router WebUI foundation.
- Added TypeScript, Tailwind CSS, shadcn/ui components, Prisma, PostgreSQL schema, NextAuth route wiring, and OpenAI SDK wrapper.
- Added Prisma models for `User`, `Account`, `Session`, `Artist`, `UserArtistFollow`, `Release`, `ReleaseSource`, `UserReleaseStatus`, `ImportBatch`, `AiSearchTask`, and `UiAsset`.
- Created MVP pages: `/`, `/dashboard`, `/artists/new`, `/artists/[id]`, `/import`, `/ai-search`, and `/settings`.
- Implemented the artist release table with `coverImageUrl` as the final column.
- Preserved source URL handling as the separate `ReleaseSource` model and detail-page source list.

## Next

- Add authentication provider credentials and database migration in the target deployment environment.
- Add async/background execution for long-running AI search tasks.
- Add row-level edit controls before candidate import.
