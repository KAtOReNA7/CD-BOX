import { AppShell } from "@/components/app/app-shell";
import { AiSearchClient } from "@/components/app/ai-search-client";
import { listArtistOptions } from "@/lib/services/artists";

export const dynamic = "force-dynamic";

export default async function AiSearchPage() {
  const artists = await listArtistOptions();

  return (
    <AppShell>
      <AiSearchClient artists={artists} />
    </AppShell>
  );
}
