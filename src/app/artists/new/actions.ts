"use server";

import "server-only";

import { redirect } from "next/navigation";
import { parseArtistCreateInput } from "@/lib/artists/artist-input";
import { requirePageOwner } from "@/lib/auth/current-user";
import { createFollowedArtist } from "@/lib/services/artists";

export type ArtistCreateActionState = {
  errors?: {
    name?: string[];
    sortName?: string[];
    country?: string[];
    description?: string[];
  };
  message?: string;
};

export async function createArtistAction(
  _previousState: ArtistCreateActionState,
  formData: FormData,
): Promise<ArtistCreateActionState> {
  const owner = await requirePageOwner();
  const parsed = parseArtistCreateInput({
    name: formData.get("name"),
    sortName: formData.get("sortName"),
    country: formData.get("country"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  let artistId: string;

  try {
    ({ artistId } = await createFollowedArtist(owner.id, parsed.data));
  } catch (error) {
    console.error("Artist creation failed", error);
    return { message: "暂时无法创建艺人库，请稍后重试。" };
  }

  redirect(`/artists/${artistId}`);
}
