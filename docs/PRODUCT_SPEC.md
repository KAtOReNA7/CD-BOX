# CD-BOX Product Spec

CD-BOX is a WebUI collection manager for physical CD collectors. Users sign in, create artist-specific libraries, and manage release information for original albums, singles, compilations, live releases, remixes, box sets, and other physical CD formats.

## MVP Goals

- Run as a Next.js App Router application with TypeScript, Tailwind CSS, shadcn/ui, Prisma, PostgreSQL, and NextAuth.
- Store user data in the cloud database so collection status can sync across devices.
- Use the current Excel template as the data prototype.
- Replace the WebUI table's final `Source URL` column with `Cover Image`.
- Preserve source URLs as `ReleaseSource` records and show them on the release or artist detail surface.
- Store `coverImageUrl` as a URL in MVP. Object storage can be added later through Supabase Storage or Cloudflare R2.
- Route all AI text calls through `src/lib/ai/client.ts` with `OPENAI_TEXT_MODEL=gpt-5.5`.
- Route UI illustration, empty state, decoration, and placeholder generation through the same AI wrapper using `OPENAI_IMAGE_MODEL=gpt-image-2`.
- Never generate fake CD covers with AI. Real CD cover art must come from a real source URL or manual user input.

## First Phase Pages

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

- `A_原创专辑原版CD`
- `B_单曲原版CD`
- `C_精选现场混音`

Ignored instruction sheets:

- `总览`
- `收藏口径`
- `术语与排除项`
- `选项`

Column handling:

- `封面图` maps to `Release.coverImageUrl`.
- `来源 URL` maps to `ReleaseSource.url`.
- If both columns exist, both values are preserved in their separate fields.
- Source URLs never appear as the final column in the main WebUI table.

Duplicate handling:

- First match by `artistId + originalCatalogNo`.
- If catalog number is empty, match by `artistId + title + originalReleaseDate + format`.
- Preview marks duplicates without writing to the database.
- Confirm supports skip, update existing, or create as a new release.

`/releases/[id]` displays release details and source URLs. Real cover art must still come from a real URL or manual user input; AI image generation is not used for CD covers.
