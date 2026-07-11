import { AppShell } from "@/components/app/app-shell";
import { AiSearchClient } from "@/components/app/ai-search-client";
import { getConfiguredProviderCapabilities } from "@/lib/ai/provider-capabilities";
import { requirePageOwner } from "@/lib/auth/current-user";
import { listArtistOptions } from "@/lib/services/artists";

export const dynamic = "force-dynamic";

export default async function AiSearchPage() {
  await requirePageOwner();
  const artists = await listArtistOptions();
  const capabilities = getConfiguredProviderCapabilities();

  return (
    <AppShell>
      <AiSearchClient artists={artists} capabilities={capabilities} />
    </AppShell>
  );
}
