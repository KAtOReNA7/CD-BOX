# CD-BOX

CD-BOX is a Next.js WebUI for physical CD collectors. It manages artist-specific release libraries, source URLs, cover image URLs, and per-user collection status.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- PostgreSQL
- NextAuth
- OpenAI SDK

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000.

## Environment Variables

```bash
DATABASE_URL=
AUTH_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://your-relay.example.com/v1
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2
AI_PROVIDER_MODE=openai-compatible
AI_ENABLE_WEB_SEARCH=true
AI_ENABLE_IMAGE_GENERATION=true
```

## Database

Generate the Prisma client:

```bash
npx prisma generate
```

Create and apply a local migration after `DATABASE_URL` points to PostgreSQL:

```bash
npx prisma migrate dev --name init
```

For production deployments:

```bash
npx prisma migrate deploy
```

## Excel Import

The import workflow is available at `/import`.

- Upload `.xlsx` files by drag-and-drop or file picker.
- Choose a new artist or an existing artist library.
- Preview parsed rows before writing to the database.
- Confirm import with a duplicate strategy: skip, update existing, or create as new.
- Source URLs are saved to `ReleaseSource.url`.
- Cover image URLs are saved to `Release.coverImageUrl`.

Create the local sample workbook:

```bash
npm run sample:excel
```

The sample file is written to `sample-data/cd-box-import-sample.xlsx`.

To smoke test the real local workbook, place it at `sample-data/中山美穂_原版CD收藏清单.xlsx`, then run:

```bash
npm run smoke:real-import
```

The real workbook is intentionally ignored by git. Commit tests should use generated fixtures instead of checking in private or large source workbooks.

## Collection Library

The artist library page at `/artists/[id]` is the main workspace for collection management.

- Inline edit release metadata, including cover image URL.
- Edit per-user collection status, priority, owned condition, and owned notes directly from the table.
- Bulk update selected releases by status, priority, or default exclusion.
- Filter by keyword, category, status, confidence, missing metadata, pending review, and decade/year range.
- View ownership and metadata stats, including completion rates by category.
- Export all rows or the current filtered result as Excel from `/api/artists/[id]/export`.

Lean UX defaults keep the main table focused on collector work: status, category, title, date, catalog number, format, source count, notes, and cover as the final column. Advanced filters, category completion, and advanced bulk operations are collapsed by default. Source URLs are available on release detail pages and in Excel export, but are not restored as the main table's final column.

## AI Release Research

The release research workflow is available at `/ai-search`.

- CD-BOX is configured for an OpenAI-compatible relay by default. It does not assume direct official OpenAI API access.
- `OPENAI_BASE_URL` is required and must point to the relay's `/v1`-style base URL.
- Model names must match aliases actually supported by the relay.
- Relays may not support Responses API, `web_search`, or image generation.
- Run the provider probe before using AI features:

```bash
npm run probe:ai
```

- Enter an artist name, country or region, collection scope, and inclusion rules.
- Searches use the OpenAI Responses API with the `web_search` tool.
- User-started searches force web search with `tool_choice: "required"`.
- Results are saved to `AiSearchTask.rawResult` and `AiSearchTask.parsedResult`.
- Candidates must be previewed, selected, and confirmed before they are imported to `Release`.
- Candidate sources are imported to `ReleaseSource`.
- Missing catalog numbers are capped at medium confidence and marked pending review.
- AI-generated images are not used as real CD covers.
- Low-quality candidates are gated before import: missing sources force LOW confidence, wiki-only sources are capped at MEDIUM, and non-CD physical formats are excluded under original-old-CD scope.
- Duplicate `title + catalogNumber` candidates for the same artist are skipped instead of overwriting existing releases.

Required environment variables:

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_TEXT_MODEL=gpt-5.5
```

Run the real AI smoke test after configuring the OpenAI environment:

```bash
npm run smoke:real-ai-search
```

If `webSearchSupported=false`, release research is blocked. CD-BOX does not fallback to a normal chat completion and pretend it searched the web.

### Pasted Source Structuring

The `/ai-search` page is presented as "资料整理". Pasted source structuring is the default workflow; online search is only shown as an active tab when the configured relay supports `web_search`.

- Paste text, tables, or CSV copied from official sites, labels, Tower Records, HMV, CDJapan, CDJournal, ORICON, MusicBrainz, VGMdb, or similar sources.
- Optionally provide a source URL and a cover source URL.
- The AI structures only the pasted facts. It does not browse and does not claim search.
- Sources are only taken from explicit URLs in the pasted text or source URL field.
- If no source URL is present, candidates are downgraded and marked pending review.
- Cover URLs are not invented.
- Confidence reflects extraction trust, while default exclusion reflects the selected collection scope.
- Complete sourced CD rows can become HIGH; sourced reissues or LP/record rows can remain MEDIUM while being excluded by default.
- Candidates reuse the same preview, quality gates, duplicate checks, and import flow as AI release research.

Real pasted-source smoke fixtures live in `sample-data/pasted-sources/`. Run the smoke after configuring AI environment variables:

```bash
npm run smoke:pasted-structure
```

The smoke does not use `web_search`; it reports candidate counts, confidence, missing fields, default exclusions, invented cover/source checks, and accidental online-search claims.

## Validation

```bash
npx prisma generate
npm run test:import
npm run smoke:pasted-structure
npm run lint
npm run build
```
