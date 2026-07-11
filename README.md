# CD-BOX

CD-BOX is a private WebUI for managing a physical CD collection. It maintains one shared artist and release catalog, source URLs, cover image URLs, import history, AI research tasks, and the owner's collection status.

## Production MVP Decisions

- **Single owner:** GitHub is the only sign-in provider. `AUTH_GITHUB_ALLOWED_ID=26319181` is the stable owner allowlist; `AUTH_GITHUB_ALLOWED_LOGIN=KAtOReNA7` is display-only. CD-BOX does not provide registration, invitations, roles, or user management.
- **Shared catalog:** artists and releases live in one shared release catalog. The schema keeps an owner identity and collection-status records for authentication and data integrity, but the product is not a multi-user workspace.
- **Online AI research at launch:** real internet search through the OpenAI Responses API `web_search` tool is a launch requirement. If the configured relay cannot prove `web_search` support, online research stays blocked rather than falling back to ordinary chat and claiming that a search occurred.
- **Deployment:** the production stack is Vercel (Hong Kong region), Neon PostgreSQL, GitHub OAuth, and Vercel AI Gateway authenticated by the deployment OIDC token.

The production application is available at <https://cd-box.vercel.app>. Neon migrations, the stable-domain GitHub OAuth callback, owner login, unauthenticated API protection, Responses API generation, and a real AI Gateway `web_search` call have been verified. Final acceptance still requires the complete deployed collection workflow. See [docs/PROGRESS.md](docs/PROGRESS.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Tech Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS and shadcn/ui
- Prisma and PostgreSQL
- NextAuth with GitHub OAuth
- OpenAI SDK with Vercel AI Gateway or another OpenAI-compatible relay
- Vercel and Neon PostgreSQL for production

## Local Setup

Use Node.js 24 and npm 11, then create a local environment file that is ignored by Git:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run db:generate
npm run dev
```

Open <http://localhost:3000>. GitHub OAuth must be configured with the local callback URL `http://localhost:3000/api/auth/callback/github` before sign-in works.

Required configuration:

```bash
DATABASE_URL=
AUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_GITHUB_ALLOWED_ID=26319181
AUTH_GITHUB_ALLOWED_LOGIN=KAtOReNA7
OPENAI_API_KEY=
AI_GATEWAY_API_KEY=
OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1
OPENAI_TEXT_MODEL=openai/gpt-5.6-sol
OPENAI_IMAGE_MODEL=openai/gpt-image-2
AI_PROVIDER_MODE=vercel-ai-gateway
AI_ENABLE_WEB_SEARCH=true
AI_ENABLE_IMAGE_GENERATION=false
```

Vercel deployments use the automatically injected `VERCEL_OIDC_TOKEN`; `AI_GATEWAY_API_KEY` is only needed for local Gateway access. For a custom OpenAI-compatible relay, set `AI_PROVIDER_MODE=openai-compatible`, provide `OPENAI_API_KEY`, and replace the base URL and model IDs. Never commit real credentials.

## Database

Generate the Prisma client and apply committed migrations locally:

```bash
npm run db:generate
npm run db:migrate:dev
```

For production, use committed migrations rather than `prisma db push`:

```bash
npm run db:migrate:deploy
```

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

The `/ai-search` launch workflow is online-first:

1. Enter an artist, region, scope, and inclusion rules.
2. Run Responses API research with `tools: [{ type: "web_search" }]` and required tool use.
3. Enrich missing covers and native-script artist names only from uniquely matched Apple Music album metadata; unmatched or ambiguous rows stay unchanged.
4. Review and edit candidates before import.
5. Import only explicitly selected candidates; source URLs are preserved as `ReleaseSource` rows.

Quality gates cap or lower confidence for missing catalog numbers, missing sources, wiki-only evidence, reissues, and out-of-scope physical formats. AI-generated images are never accepted as real CD covers. Apple Music artwork is linked to its store source and is accepted only after at least two distinct, uniquely matched Apple collections establish one dominant artist ID, followed by a unique exact title/year album match. Cover metadata never raises release confidence or substitutes for physical-edition evidence. Duplicate `title + catalogNumber` candidates for the same artist are skipped instead of overwriting curated data.

Pasted-source structuring remains available as a secondary workflow for organizing user-supplied text, tables, or URLs. It is not a substitute for the required launch-time online search and must never claim network access.

Before deployment, verify the relay without printing secrets:

```bash
npm run probe:ai
```

The production gate requires `responsesSupported=true`, `webSearchSupported=true`, and the configured production model. A real online-search smoke test can then be run with:

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

Production is not considered verified until GitHub owner login, database migration, artist creation, Excel import, online research, candidate edit/import, collection updates, export, and logout all pass against the deployed Vercel application.
