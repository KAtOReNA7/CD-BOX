# CD-BOX Progress

## 2026-07-11 — Production MVP Integration (In Progress)

### Decisions Locked

- CD-BOX is a single-owner application. GitHub is the only authentication provider, `AUTH_GITHUB_ALLOWED_ID=26319181` is the stable owner allowlist, and the login is display-only.
- The product has one shared artist/release catalog and no registration, invitations, roles, teams, or user-management UI.
- User-linked follow and collection-status records remain internal persistence details for the authenticated owner; they do not make the product a multi-user workspace.
- Real online release research is required for the first production release. Responses API plus an actual `web_search` tool call must pass; pasted-source structuring alone is insufficient.
- The production stack is Vercel in `hkg1`, Neon PostgreSQL, GitHub OAuth, and Vercel AI Gateway with OIDC authentication.

### Implemented on the Current Working Branch

- Replaced the previous multi-provider authentication assumptions with GitHub-only owner authentication and stable numeric-ID allowlist checks in the sign-in, JWT, session, and server-side owner boundary.
- Added authentication guards to owner pages and API routes, owner identity display, and logout handling.
- Implemented `/artists/new` with validated creation and owner-follow behavior.
- Added initial Prisma migration files and production migration scripts to the current working tree.
- Standardized collection states as `OWNED`, `NOT_OWNED`, `WANTED`, `EXCLUDED`, and `PENDING_REVIEW`, with priority constrained to 1–5.
- Made online search the first AI workflow when relay capability is configured and added editable candidate fields before import.
- Hardened relay URL validation, provider probing, response-source inspection, security headers, dependency versions, Node/npm pins, and CI checks.
- Added a production deployment runbook for Vercel, Neon, GitHub OAuth, encrypted environment variables, migration, and release verification.
- Deployed the application to `https://cd-box.vercel.app`, applied the committed Neon migration, created the production GitHub OAuth application, and verified owner login.
- Replaced username-only authorization with stable GitHub numeric-ID checks across sign-in, JWT, session, and every server-side owner boundary.
- Added owner-only production provider diagnostics and streaming Responses API collection so slow providers can return incremental events without a gateway timeout.
- Verified the original `linkapi.shop` endpoint is not publicly routable from Vercel and the replacement `new-api.xiron.net.cn` provider exposes only `gpt-5.6-terra` but fails generation with upstream timeouts / `666 openai_error`.
- Configured Vercel AI Gateway as the production provider using the deployment OIDC token, free-tier-eligible `openai/gpt-5.4-mini`, and `openai/gpt-image-2` (image generation remains disabled).
- Verified production Responses API generation (`200`, completed output) and a forced `web_search` call (`200`, one reported search call) through the owner-only diagnostics page.
- Re-ran a clean npm install, production dependency audit, Prisma generation, type check, all 17 tests, ESLint, and the production build successfully before the latest release commit.
- Fixed the Next.js 16 Server Action export contract on `/artists/new`, redeployed production, and added a regression test that rejects non-async runtime exports from file-level `"use server"` modules.
- Verified production artist creation end to end: `POST /artists/new` returned `303`, the new `/artists/[id]` page returned `200`, and the deployment logged no Prisma or 5xx errors after increasing the Neon transaction startup allowance.

The current working tree is deployed to production for acceptance testing. It is not yet tagged as the accepted MVP release.

### Remaining Before Production Acceptance

- Complete deployed acceptance for Excel import, online research, candidate edit/import, status updates, export, and logout.

Production deployment, owner authentication, and the AI Gateway release gate are complete; full collection-workflow acceptance is still in progress.

> The entries below are historical milestones. Older statements that made pasted-source structuring primary or described general per-user behavior are superseded by the production MVP decisions above.

## 2026-06-08

### Phase 4

- Refocused the product around the collector loop: choose artist, manage release list, mark ownership, see gaps, fill metadata, export backup.
- Simplified the artist table to the default collector fields: status, category, title, date, catalog number, format, source count, notes, and cover as the final column.
- Moved advanced release metadata editing to the release detail page.
- Simplified inline editing to collection status, notes, and cover URL.
- Simplified filters to keyword, category, status, missing cover, and pending review; moved source/catalog/reissue/remaster/exclusion/year/confidence filters into an advanced section.
- Added a one-click gap view.
- Simplified stats cards to completion rate, owned/collectible total, gap count, pending review, and missing cover; moved category completion behind a details section.
- Simplified bulk actions and moved priority/default-exclusion operations into an advanced bulk section.
- At that phase, reworked `/ai-search` so pasted-source structuring was primary and unsupported web search was folded into a capability note. This ordering is superseded by the 2026-07-11 online-first launch decision.
- Added `docs/LEAN_UX_CHECKLIST.md`.

### Phase 3.9

- Enhanced `/artists/[id]` into the core collection management workspace.
- Added release service modules:
  - `src/lib/releases/release-service.ts`
  - `src/lib/releases/release-types.ts`
  - `src/lib/releases/release-filters.ts`
  - `src/lib/releases/release-stats.ts`
  - `src/lib/releases/release-export.ts`
- Added inline release editing for title, category, date, format, catalog number, label, price, edition type, reissue/remaster flags, default exclusion, cover URL, and notes.
- Added direct collection-status editing backed by automatic `UserReleaseStatus` creation. The production product uses this only for the allowlisted owner.
- Added multi-select bulk updates for status, priority, and `isExcludedByDefault`, scoped to the current artist.
- Added filter panel for keyword, category, status, confidence, flags, missing cover/source/catalog, pending review, and decade/year ranges.
- Added collection stats cards and category completion rates.
- Added Excel export for all rows or current filtered rows.
- Enhanced release detail pages with cover URL editing, source URL add/delete, user status display, return link, and exclusion reason.
- Added tests for release filters, stats, export rows, and bulk update validation.

### Phase 3.8.1

- Calibrated pasted-source confidence scoring so complete, sourced CD rows are not stuck at LOW.
- Separated data confidence from collection-scope exclusion:
  - Complete sourced CD rows can become HIGH.
  - Sourced rows with catalog numbers but incomplete fields can become MEDIUM.
  - Reissue/remaster rows and non-CD physical rows can remain MEDIUM while `isExcludedByDefault=true`.
  - Missing sources, risky warnings, and source-less candidates still force LOW.
- Added tests for sourced complete rows, missing dates, missing sources, missing catalog numbers, reissues, LP/Vinyl, hallucination warnings, and invented cover cleanup.

Calibrated pasted-source smoke result:

- Fixtures: 3
- Candidates: 8
- Confidence: HIGH 6 / MEDIUM 2 / LOW 0
- Missing catalog numbers: 0
- Missing release dates: 0
- Missing sources: 0
- Default excluded: 2
- Invented source URLs: no
- Invented cover image URLs: no
- Claimed online search: no

### Phase 3.8

- Added real pasted-source smoke fixtures in `sample-data/pasted-sources/` for official label, retailer, and CD database style snippets.
- Added `scripts/smoke-pasted-structure.mjs` and `npm run smoke:pasted-structure`.
- Smoke test uses `OPENAI_TEXT_MODEL`, calls the pasted-source structuring service, and does not use `web_search`.
- Hardened pasted-source parsing for partial model JSON, explicit source-only URL preservation, explicit cover-only preservation, category inference, reissue inference, and non-CD format gates.
- Expanded response text extraction to handle relay Responses API content variants.
- Added `tests/release-structure-real-fixture.test.ts`.

Real pasted-source smoke result:

- Fixtures: 3
- Candidates: 8
- Confidence: HIGH 0 / MEDIUM 0 / LOW 8
- Missing catalog numbers: 0
- Missing release dates: 0
- Missing sources: 0
- Default excluded: 2
- Invented source URLs: no
- Invented cover image URLs: no
- Claimed online search: no
- `COLLECTION 2015 復刻` and `COLLECTION LP` were retained as candidates and excluded by default.
- `中山美穂 & WANDS` artist credit was preserved.

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

- Complete the 2026-07-11 production acceptance checklist above.
- Configure credentials only in ignored local environment files or encrypted Vercel environment variables; never commit secrets.
- Do not call the MVP released until GitHub OAuth, Neon migration, and real relay `web_search` have passed in production.
