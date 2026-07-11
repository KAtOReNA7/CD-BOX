import { AppShell } from "@/components/app/app-shell";
import { ImportClient } from "@/components/app/import-client";
import { requirePageOwner } from "@/lib/auth/current-user";
import { listArtistOptions } from "@/lib/services/artists";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requirePageOwner();
  const artists = await listArtistOptions();

  return (
    <AppShell>
      <ImportClient artists={artists} />
    </AppShell>
  );
}
