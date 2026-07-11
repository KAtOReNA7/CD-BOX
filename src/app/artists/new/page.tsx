import { AppShell } from "@/components/app/app-shell";
import { ArtistCreateForm } from "@/app/artists/new/artist-create-form";
import { requirePageOwner } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function NewArtistPage() {
  await requirePageOwner();

  return (
    <AppShell>
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-muted-foreground">Artist Library</p>
        <h1 className="mt-2 text-3xl font-semibold">新建艺人库</h1>
        <ArtistCreateForm />
      </div>
    </AppShell>
  );
}
