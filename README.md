# CD-BOX

CD-BOX is a private, locally hosted WebUI for managing a physical CD collection. It maintains one shared artist and release catalog, source URLs, cover image URLs, import history, AI research tasks, and the owner's collection status.

## Local Deployment Decisions

- **Single owner:** local owner mode is restricted to loopback requests. CD-BOX does not provide registration, invitations, roles, or user management.
- **Shared catalog:** artists and releases live in one shared release catalog. The schema keeps an owner identity and collection-status records for authentication and data integrity, but the product is not a multi-user workspace.
- **Online research:** MusicBrainz is fully paged and consolidated by release group, Japan's National Diet Library (NDL) national bibliography is the mandatory authoritative check, and Discogs is corroborating evidence only. GPT-5.6 compares the supplied records and may reject them; it cannot create facts or override a failed deterministic gate.
- **Deployment:** one local Next.js production process bound to `127.0.0.1`, local PostgreSQL, and the existing OpenAI-compatible relay. Vercel is not used. No cloud hosting, paid search API, cloud database, or external login is required.

See [docs/LOCAL_DEPLOYMENT.md](docs/LOCAL_DEPLOYMENT.md) for the local setup, backup, restore, and graceful-shutdown runbook.

## Tech Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS and shadcn/ui
- Prisma and PostgreSQL
- NextAuth-compatible local owner boundary
- OpenAI SDK with an OpenAI-compatible relay
- Windows PowerShell operations and local PostgreSQL backups

## Local Setup

Use Node.js 24 and npm 11. For a first-time Windows installation, place the existing relay key alone on the Windows clipboard and run the elevated, non-interactive bootstrap:

```powershell
npm run local:bootstrap
npm run local:start
```

Bootstrap creates the dedicated `cd_box_app` PostgreSQL role and `cd_box` database, generates strong database and authentication secrets, writes the ignored `.env.local` atomically, applies migrations, and builds the application. It temporarily adds one `hostnossl postgres postgres 127.0.0.1/32 trust` rule and restores the byte-identical original `pg_hba.conf` in `finally`. The clipboard key and generated secrets are never printed or passed on a process command line.

Open <http://127.0.0.1:3000>. The production server is explicitly bound to the loopback interface and is unavailable from other devices.

Required configuration:

```bash
DATABASE_URL=postgresql://<database-user>:<database-password>@127.0.0.1:55432/<database-name>?schema=public
LOCAL_OWNER_MODE=true
LOCAL_OWNER_BIND_HOST=127.0.0.1
NEXTAUTH_URL=http://127.0.0.1:3000
AUTH_URL=http://127.0.0.1:3000
AUTH_SECRET=<generate-a-long-random-value>
OPENAI_API_KEY=<relay-api-key>
OPENAI_BASE_URL=https://<relay-host>/v1
OPENAI_TEXT_MODEL=gpt-5.6-terra
AI_TEXT_PROTOCOL=chat-completions
AI_MAX_COMPLETION_TOKENS=16384
AI_REASONING_EFFORT=none
AI_REQUEST_TIMEOUT_MS=300000
AI_ENABLE_WEB_SEARCH=true
AI_ORGANIZE_PUBLIC_METADATA=false
AI_ENABLE_IMAGE_GENERATION=false
AI_RESPONSES_SUPPORTED=false
AI_CHAT_COMPLETIONS_SUPPORTED=true
AI_WEB_SEARCH_SUPPORTED=false
```

`OPENAI_IMAGE_MODEL` stays unset while image generation is disabled. The capability declarations above match the verified GPT-5.6 relay; re-run `npm run probe:ai` before changing them. Never commit real credentials.

## Database

Initialize the local database and apply committed migrations:

```bash
npm run local:db:init
```

Create a compressed, checksummed backup with automatic retention:

```bash
npm run local:db:backup
```

Use committed migrations rather than `prisma db push`.

## Collection Library

The artist library at `/artists/[id]` is the main collection workspace.

- Create and follow artists from `/artists/new`.
- Quickly edit collection status and notes. Editing verified release metadata, sources, or its cover invalidates verification immediately and moves the row back to quarantine until a new verified search/backfill succeeds.
- Bulk-update selected releases and filter by metadata, status, confidence, and review state.
- View ownership, gap, and metadata-completion statistics.
- Keep source URLs in `ReleaseSource` and show them on release detail pages.
- Keep `coverImageUrl` as the final visible table column.
- Export all rows or the filtered result to Excel.

The owner-facing statuses are `OWNED`, `NOT_OWNED`, `WANTED`, `EXCLUDED`, and `PENDING_REVIEW`. Priority uses a 1–5 scale.

The normal library view is fail-closed: only releases with `VERIFIED` evidence and a validated real cover are shown. Legacy, imported, unverified, or coverless records remain isolated in the database and cannot be treated as final collection entries.

## Excel Import

The `/import` workflow supports `.xlsx` upload, preview, duplicate detection, and confirmed database writes.

- Choose an existing artist or create a new artist library.
- Confirm duplicates with skip, update-existing, or create-new behavior.
- Save source URLs to `ReleaseSource.url` and cover URLs to `Release.coverImageUrl`.
- Keep private or large real workbooks out of Git; committed tests use generated fixtures.

Create the sample workbook with:

```bash
npm run sample:excel
```

Run the optional real-workbook smoke test after placing the ignored workbook in `sample-data/`:

```bash
npm run smoke:real-import
```

## AI Release Research

The `/ai-search` workflow is online-first:

1. Enter an artist, region, scope, and inclusion rules.
2. Fetch all bounded MusicBrainz pages, consolidate editions by release group, and choose one canonical Japanese physical CD edition instead of exposing every reissue row.
3. Require one unique NDL national-bibliography record bound by exact normalized catalog number, artist, and a non-conflicting date. A controlled title match passes directly; a Japanese/romanized title pair is carried to the AI audit as an explicit unresolved comparison. Accepted rows display the NDL authoritative local title. Unavailable, incomplete, ambiguous, or identifier/date-conflicting NDL evidence fails closed.
4. Use Discogs only as an auxiliary cross-check. The exact Japanese CD release must agree on artist, title, year/date, catalog number, country, format, and a strong identifier; partial Discogs pagination is never treated as complete. An earlier exact MusicBrainz/Discogs edition may veto a renamed reissue even when that earlier edition has no NDL record, but it can never become an output row without NDL evidence.
5. Ask GPT-5.6 to compare the compact MusicBrainz, NDL, and Discogs evidence. It can reject conflicts or insufficient evidence, but deterministic gates prevent it from accepting a weak or invented match.
6. Resolve a cover only from an exact-release Cover Art Archive record or the exact Discogs release's `primary` image. Every URL is bound to its provider and final redirect host, downloaded within a hard byte limit, and must pass signature, MIME, dimension, and full image decode checks before acceptance.
7. Show and allow import only for rows that pass the metadata, AI, and cover gates. Rejected, unverified, ambiguous, or coverless rows are summarized and isolated; the owner is not asked to judge them.

AI-generated and digital-store artwork are never accepted as physical-edition covers. Duplicate editions and duplicate `title + catalogNumber` candidates are rejected instead of overwriting curated data.

The application displays the required NDL Search API credit and CC BY 4.0 license, plus “Data provided by Discogs” and the Discogs non-affiliation notice. NDL requests are serialized at a default minimum interval of one second and cached; anonymous Discogs requests are serialized at 2.5 seconds, observe rate-limit/`Retry-After` headers, and fail closed on incomplete pagination.

Pasted-source structuring remains available for user-supplied text, tables, or URLs and must never claim network access.

Before the local release, verify the relay without printing secrets:

```bash
npm run probe:ai
```

The local gate requires Chat Completions text and JSON support. Responses and native `web_search` may remain unsupported because public metadata research is a separate, source-faithful path. A real research smoke can be run with:

```bash
npm run smoke:verified-discography
# Include the live GPT-5.6 evidence audit:
npm run smoke:verified-discography:ai
```

## Verify an Existing Library

Existing records are never silently promoted. Preview the verification/backfill plan first:

```bash
npm run library:verify
```

After reviewing the report and taking a database backup, apply only uniquely matched, fully verified, cover-complete updates:

```bash
npm run local:db:backup
npm run library:verify:apply
```

The apply command preserves curated notes and non-empty conflicting covers; unresolved records remain quarantined.

## Validation

```bash
npm ci
npm run audit:prod
npm run db:generate
npm run check
npm run build
```

The local release is not considered verified until the local owner boundary, database migration, artist creation, Excel import, online research, verified-candidate selection/import, collection updates, export, backup, and graceful restart all pass on `127.0.0.1`. Verified candidates cannot be edited before import; any field change requires a new search and verification run.
