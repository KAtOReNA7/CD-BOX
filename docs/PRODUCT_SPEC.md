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
