# CD-BOX Progress

## 2026-06-08

### Phase 2

- Added Excel import parsing with `xlsx` in `src/lib/import/excel-parser.ts`.
- Added import types and database write service in `src/lib/import/import-types.ts` and `src/lib/import/import-service.ts`.
- Added API routes: `POST /api/import/preview` and `POST /api/import/confirm`.
- Reworked `/import` into a drag-and-drop upload, preview, duplicate strategy, and confirm workflow.
- Added `/releases/[id]` to show release details and `ReleaseSource` URLs outside the main collection table.
- Added support for `来源 URL` to `ReleaseSource.url` and `封面图` to `Release.coverImageUrl`.
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
- Add richer import review controls and row-level edit corrections before confirm.
- Implement AI-assisted release research and deduplication through `src/lib/ai/client.ts`.
