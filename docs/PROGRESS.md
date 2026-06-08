# CD-BOX Progress

## 2026-06-08

- Initialized the Next.js App Router WebUI foundation.
- Added TypeScript, Tailwind CSS, shadcn/ui components, Prisma, PostgreSQL schema, NextAuth route wiring, and OpenAI SDK wrapper.
- Added Prisma models for `User`, `Account`, `Session`, `Artist`, `UserArtistFollow`, `Release`, `ReleaseSource`, `UserReleaseStatus`, `ImportBatch`, `AiSearchTask`, and `UiAsset`.
- Created MVP pages: `/`, `/dashboard`, `/artists/new`, `/artists/[id]`, `/import`, `/ai-search`, and `/settings`.
- Implemented the artist release table with `coverImageUrl` as the final column.
- Preserved source URL handling as the separate `ReleaseSource` model and detail-page source list.

## Next

- Add server actions or API routes for creating artists and importing Excel files.
- Add authentication provider credentials and database migration in the target deployment environment.
- Implement import parsing, deduplication, and AI-assisted release structuring through `src/lib/ai/client.ts`.
