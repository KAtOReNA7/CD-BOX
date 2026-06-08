# CD-BOX Product Spec

CD-BOX is a WebUI collection manager for physical CD collectors. Users sign in, create artist-specific libraries, and manage release information for original albums, singles, best albums, collections, live releases, remixes, box sets, EPs, and other physical CD formats.

## MVP Goals

- Run as a Next.js App Router application with TypeScript, Tailwind CSS, shadcn/ui, Prisma, PostgreSQL, and NextAuth.
- Store user data in the cloud database so collection status can sync across devices.
- Use the existing Excel template as the data prototype.
- Replace the WebUI table's final `Source URL` column with `Cover Image`.
- Preserve source URLs as `ReleaseSource` records and show them on release detail pages.
- Store `coverImageUrl` as a URL in MVP. Object storage can be added later through Supabase Storage or Cloudflare R2.
- Route all AI text calls through `src/lib/ai/client.ts` with `OPENAI_TEXT_MODEL=gpt-5.5`.
- Route UI illustration, empty state, decoration, and placeholder generation through the same AI wrapper using `OPENAI_IMAGE_MODEL=gpt-image-2`.
- Never generate fake CD covers with AI. Real CD cover art must come from a real source URL or manual user input.

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
2. Priority
3. Category
4. Title
5. Original release date
6. Format
7. Original catalog number
8. Label
9. Reissue flag
10. Notes
11. Cover image

`coverImageUrl` is the final visible column. Source URLs are not discarded; they are persisted in `ReleaseSource`.

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

The `/ai-search` page lets a signed-in user research an artist's physical CD releases before importing anything into the formal collection library.

Inputs:

- Artist name
- Country or region, defaulting to Japan
- Collection scope: original old CD, all CD, or all physical
- Exclude reissues
- Include collaborations
- Include Live / Remix / Best

AI requirements:

- All AI calls go through `src/lib/ai/client.ts`.
- Release research logic lives in `src/lib/ai/release-research.ts`.
- JSON extraction and validation live in `src/lib/ai/release-research-parser.ts`.
- Types live in `src/lib/ai/release-research-types.ts`.
- Searches use the OpenAI Responses API with `tools: [{ type: "web_search" }]`.
- User-started searches set `tool_choice: "required"` to force web search.

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
- Missing catalog numbers are downgraded to `LOW` confidence and marked with a `PENDING_REVIEW` warning.
