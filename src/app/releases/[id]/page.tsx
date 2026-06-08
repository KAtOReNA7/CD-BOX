import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { ReleaseDetailClient } from "@/components/app/release-detail-client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getReleaseDetailView } from "@/lib/releases/release-service";

export const dynamic = "force-dynamic";

export default async function ReleaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const detail = await getReleaseDetailView(id, userId);

  if (!detail) {
    notFound();
  }

  return (
    <AppShell>
      <ReleaseDetailClient initialRelease={detail.release} artist={{ id: detail.artist.id, name: detail.artist.name }} />
    </AppShell>
  );
}
