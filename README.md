# CD-BOX

CD-BOX is a private, locally hosted WebUI for managing a physical CD collection. It maintains one shared artist and release catalog, source URLs, cover image URLs, import history, AI research tasks, and the owner's collection status.

## Local Deployment Decisions

- **Single owner:** local owner mode is restricted to loopback requests. CD-BOX does not provide registration, invitations, roles, or user management.
- **Shared catalog:** artists and releases live in one shared release catalog. The schema keeps an owner identity and collection-status records for authentication and data integrity, but the product is not a multi-user workspace.
- **Online research:** release evidence comes from verified native `web_search` when available, otherwise from deterministic MusicBrainz and Cover Art Archive records. GPT-5.6 is reserved for structuring user-pasted unstructured material; ordinary chat is never presented as web evidence.
- **Deployment:** one local Next.js production process bound to `127.0.0.1`, local PostgreSQL, and the existing OpenAI-compatible relay. No cloud hosting, paid search API, cloud database, or external login is required.

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
- Quickly edit collection status, notes, and cover URL in the table; edit full release metadata on the release detail page.
- Bulk-update selected releases and filter by metadata, status, confidence, and review state.
- View ownership, gap, and metadata-completion statistics.
- Keep source URLs in `ReleaseSource` and show them on release detail pages.
- Keep `coverImageUrl` as the final visible table column.
- Export all rows or the filtered result to Excel.

The owner-facing statuses are `OWNED`, `NOT_OWNED`, `WANTED`, `EXCLUDED`, and `PENDING_REVIEW`. Priority uses a 1–5 scale.

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
2. Use native Responses `web_search` only when the relay explicitly supports it. The verified local relay instead queries the free MusicBrainz and Cover Art Archive public services.
3. Map public evidence deterministically without a model call. This avoids extra relay cost and long waits; GPT-5.6 remains available for the separate pasted-source structuring workflow.
4. Enrich missing covers and native-script artist names only from uniquely matched Apple Music metadata; unmatched or ambiguous rows stay unchanged.
5. Review and edit candidates, then import only explicitly selected rows. Source URLs are preserved as `ReleaseSource` records.

Quality gates cap or lower confidence for missing catalog numbers, missing sources, wiki-only evidence, reissues, and out-of-scope physical formats. When MusicBrainz cannot verify reissue status under an exclude-reissues search, the row is forced to pending review rather than presented as safe to import. AI-generated images are never accepted as real CD covers. Apple Music artwork is linked to its store source and is accepted only after at least two distinct, uniquely matched Apple collections establish one dominant artist ID, followed by a unique exact title/year album match. Cover metadata never raises release confidence or substitutes for physical-edition evidence. Duplicate `title + catalogNumber` candidates for the same artist are skipped instead of overwriting curated data.

Pasted-source structuring remains available for user-supplied text, tables, or URLs and must never claim network access.

Before the local release, verify the relay without printing secrets:

```bash
npm run probe:ai
```

The local gate requires Chat Completions text and JSON support. Responses and native `web_search` may remain unsupported because public metadata research is a separate, source-faithful path. A real research smoke can be run with:

```bash
npm run smoke:real-ai-search
```

## Validation

```bash
npm ci
npm run audit:prod
npm run db:generate
npm run check
npm run build
```

The local release is not considered verified until the local owner boundary, database migration, artist creation, Excel import, online research, candidate edit/import, collection updates, export, backup, and graceful shutdown all pass on `127.0.0.1`.
