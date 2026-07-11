# CD-BOX Product Spec

CD-BOX is a private WebUI collection manager for one physical CD collector. The owner signs in with GitHub, maintains a shared artist and release catalog, and tracks original albums, singles, best albums, collections, live releases, remixes, box sets, EPs, and other physical CD formats.

This document describes the production MVP target. Historical implementation milestones remain in `docs/PROGRESS.md`; when an older milestone differs from this specification, this document is authoritative.

## MVP Goals

- Run as a Next.js App Router application with TypeScript, Tailwind CSS, shadcn/ui, Prisma, PostgreSQL, and NextAuth.
- Use GitHub as the only authentication provider and allow only stable GitHub numeric ID `26319181` through `AUTH_GITHUB_ALLOWED_ID`; the login is display-only.
- Do not provide registration, invitations, roles, teams, or user administration.
- Store one shared artist/release catalog and the owner's collection state in PostgreSQL so it can sync across the owner's devices.
- Use the existing Excel template as the data prototype.
- Replace the WebUI table's final `Source URL` column with `Cover Image`.
- Preserve source URLs as `ReleaseSource` records and show them on release detail pages.
- Store `coverImageUrl` as a URL in MVP. Object storage is out of scope for the production MVP.
- Route all AI text calls through `src/lib/ai/client.ts`; production uses Vercel AI Gateway with `OPENAI_TEXT_MODEL=openai/gpt-5.6-sol` and deployment OIDC authentication.
- Require real online release research through the Responses API `web_search` tool for launch.
- Keep image generation disabled for the production MVP even though an image-model setting is reserved for future UI assets.
- Never generate fake CD covers with AI. Real CD cover art must come from a real source URL or manual user input.
- Deploy the production application to Vercel with Neon PostgreSQL.

## Identity and Data Boundary

- GitHub OAuth is the only sign-in method.
- Only the configured stable GitHub numeric ID may create a valid session. Login and email are display/profile data and are not sufficient for authorization.
- Every protected page and API route resolves the authenticated owner server-side.
- Artists and releases form one shared catalog. The database may retain user-linked follow and collection-status records, but these support the single-owner boundary and do not constitute user-management functionality.
- No anonymous mutation or cross-user data access is permitted.

## Pages

- `/`
- `/dashboard`
- `/artists/new`
- `/artists/[id]`
- `/releases/[id]`
- `/import`
- `/ai-search`
- `/settings`

## Artist Release Table

The artist detail table displays these fields in order:

1. Collection status
2. Category
3. Title
4. Original release date
5. Original catalog number
6. Format
7. Source count
8. Notes
9. Cover image

`coverImageUrl` is the final visible column. Source URLs are not discarded; they are persisted in `ReleaseSource`.

The artist library page supports quick collection status editing, quick notes/cover URL editing, bulk actions, filters, ownership stats, category completion rates, and Excel export. Release detail pages support full release metadata editing and manual `ReleaseSource` add/delete. Source URLs remain outside the main table's final column.

Lean UX defaults:

- The default artist table shows no more than 9 business fields and keeps cover image as the final column.
- Advanced release fields such as label, original price, edition type, reissue/remaster flags, default exclusion, confidence, and warnings are moved to details or folded sections.
- Default filters are keyword, category, collection status, missing cover, and pending review.
- Missing source, missing catalog number, reissue/remaster, exclusion, year range, and confidence filters are advanced.
- Category completion rates and advanced bulk operations are folded by default.
- `/ai-search` is online-search first when the required relay capability is available. Pasted-source structuring is secondary and cannot satisfy the production launch gate.

## Excel Import Workflow

The `/import` page supports drag-and-drop `.xlsx` upload, choosing an existing artist library, or creating a new artist by name. Uploading a workbook only creates a preview; database writes happen after the user clicks confirm.

Supported sheets:

- `A_OriginalAlbumOriginalCD`
- `B_SingleOriginalCD`
- `C_BestLiveRemix`

The real Japanese workbook uses equivalent Japanese sheet names. Instruction sheets such as overview, collection policy, glossary, and options are skipped.

Column handling:

- Cover image maps to `Release.coverImageUrl`.
- Source URL maps to `ReleaseSource.url`.
- If both columns exist, both values are preserved in their separate fields.
- Source URLs never appear as the final column in the main WebUI table.

Duplicate handling:

- First match by `artistId + originalCatalogNo`.
- If catalog number is empty, match by `artistId + title + originalReleaseDate + format`.
- Preview marks duplicates without writing to the database.
- Confirm supports skip, update existing, or create as a new release.

## GPT Release Research Workflow

The `/ai-search` page lets the authenticated owner create release candidates before importing anything into the formal collection library.

It has two modes, in this order:

- Online search
- Pasted source structuring

Inputs:

- Artist name
- Country or region, defaulting to Japan
- Collection scope: original old CD, all CD, or all physical
- Exclude reissues
- Include collaborations
- Include Live / Remix / Best

AI requirements:

- All AI calls go through `src/lib/ai/client.ts`.
- CD-BOX requires an OpenAI-compatible relay through `OPENAI_BASE_URL`; direct official API access is not assumed.
- Release research logic lives in `src/lib/ai/release-research.ts`.
- JSON extraction and validation live in `src/lib/ai/release-research-parser.ts`.
- Types live in `src/lib/ai/release-research-types.ts`.
- Searches use the OpenAI Responses API with `tools: [{ type: "web_search" }]`.
- User-started searches set `tool_choice: "required"` to force web search.
- If the relay does not support Responses API or `web_search`, online release research is blocked and the UI asks the user to run `npm run probe:ai`.
- Chat Completions fallback may only be used for non-search text tasks. It must not be used to fabricate online search results.
- A deployment that cannot complete a real `web_search` call is not release-ready.
- Online results may enrich a missing cover and native-script artist name from Apple Music Search metadata only after at least two distinct, uniquely matched Apple collections establish one majority artist ID; each cover still requires one unique exact title/year album within that artist. Existing covers are never overwritten, ambiguous matches remain empty, every accepted Apple cover retains a separate Apple Music provenance link, and cover-only metadata is excluded from release-evidence counts and never raises release confidence.

## Pasted Source Structuring

The owner can paste source material from official sites, labels, retailers, CD databases, MusicBrainz, VGMdb, or CSV/table text. This secondary mode is called "Pasted source structuring"; it is not search, must not claim network access, and does not replace the launch requirement for working online search.

Rules:

- All calls still go through `src/lib/ai/client.ts`.
- Structuring logic lives in `src/lib/ai/release-structure.ts`.
- Parser logic lives in `src/lib/ai/release-structure-parser.ts`.
- Sources may only come from URLs explicitly present in pasted text or the optional user-provided source URL.
- If no source URL exists, candidates keep empty `sources`, are downgraded by quality gates, and are marked pending review.
- `coverImageUrl` may only be kept when it matches an explicit user-provided cover URL. The model must not invent cover art.
- Missing fields remain `null`; the model must not guess catalog numbers or dates.
- The same candidate preview, quality gates, and import path are reused.
- The parser keeps release-like rows even when they are outside scope, then marks reissues, remasters, LP, record, cassette, tape, DVD, and Blu-ray rows as excluded by default where applicable.
- `廃盤` means out of print and is not treated as a reissue by itself.
- `COLLECTION`, `Best`, `ベスト`, `精选`, and `合集` are classified as `BEST` or `COLLECTION`, not `SINGLE`.
- `8cmCD`, `CDシングル`, and single rows are classified as `SINGLE` unless the source says collection, best, live, remix, or box.

Smoke fixtures:

- Real pasted-source smoke snippets live in `sample-data/pasted-sources/`.
- `npm run smoke:pasted-structure` calls the pasted-source structuring workflow without `web_search`.
- Smoke output reports candidate counts, confidence counts, missing fields, missing sources, default exclusions, invented cover URLs, invented source URLs, and accidental online-search claims.

Persistence:

- Search tasks are saved as `AiSearchTask`.
- `rawResult` stores the raw model output and a JSON-safe response snapshot.
- `parsedResult` stores the validated candidate structure.
- Failed parsing or API errors set `status = FAILED` and write `errorMessage`.

Import rules:

- AI results never write directly to `Release`.
- Candidates are previewed in a dense table with confidence, category, title, artist credit, date, format, catalog number, label, reissue flag, cover, source count, and warnings.
- Users select candidates, mark exclusions, and mark pending-review rows before import.
- Sources are saved to `ReleaseSource`.
- Cover image URLs are only saved when a real source provides them. AI-generated CD covers remain forbidden.
- Missing catalog numbers are capped at `MEDIUM` confidence and marked with a `PENDING_REVIEW` warning.
- Missing sources force `LOW` confidence and must be pending review.
- Wikipedia-only sources cap confidence at `MEDIUM` and must include an `only wiki source` warning.
- Non-CD physical formats are excluded by default under original-old-CD scope.
- Reissues are excluded by default when the user asks to exclude reissues.
- Confidence measures extraction trust, while `isExcludedByDefault` measures collection-scope fit. A complete sourced reissue or LP row can be `MEDIUM` and excluded at the same time.
- Complete sourced CD rows with catalog number, release date, label, and CD format may be `HIGH`.
- Existing manually curated data is protected: candidate imports skip duplicate `title + catalogNumber` rows for the same artist instead of overwriting them.
- By default, only HIGH confidence candidates with catalog numbers, sources, and no default exclusion are selected for import.

## Provider Capability Probe

`npm run probe:ai` checks relay capabilities without printing secrets:

- Required configuration and redacted API key
- Text model smoke
- JSON output smoke
- Responses API smoke
- `web_search` smoke when Responses API is available
- Chat Completions fallback smoke
- Image model configuration only; image generation is deferred to a later phase

The probe emits a summary object with `textSupported`, `jsonSupported`, `responsesSupported`, `webSearchSupported`, `chatCompletionsSupported`, and `imageModelConfigured`.

## Production Deployment and Acceptance

Target infrastructure:

- Vercel for the Next.js application and GitHub-connected deployments.
- Neon PostgreSQL through Vercel Marketplace.
- GitHub OAuth with the production callback URL.
- Vercel AI Gateway, or another verified OpenAI-compatible provider, whose Responses API can execute and report `web_search` calls.

The production MVP is accepted only after all of the following pass in the deployed environment:

1. Database migrations apply cleanly to Neon.
2. GitHub numeric ID `26319181` can sign in and a non-allowlisted GitHub ID is rejected, regardless of login text.
3. The owner can create an artist and access only authenticated pages and APIs.
4. Excel preview, duplicate handling, and confirmed import persist correctly.
5. The provider probe reports Responses API and `web_search` support, and a real online release search returns evidence-backed candidates.
6. Candidate review/edit/import, collection-status updates, source handling, and Excel export work end to end.
7. Type checking, tests, lint, production build, and production dependency audit pass.

Vercel deployment, Neon migration, stable-domain GitHub OAuth, owner login, unauthenticated API protection, Responses API generation, and a real AI Gateway `web_search` call are complete. Full collection-workflow acceptance remains tracked in `docs/PROGRESS.md`.
