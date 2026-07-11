"use client";

import { useActionState } from "react";
import {
  createArtistAction,
  type ArtistCreateActionState,
} from "@/app/artists/new/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialArtistCreateState: ArtistCreateActionState = {};

function FieldErrors({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;

  return (
    <div id={id} className="text-sm text-destructive" aria-live="polite">
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}

export function ArtistCreateForm() {
  const [state, formAction, pending] = useActionState(
    createArtistAction,
    initialArtistCreateState,
  );

  return (
    <form action={formAction} className="mt-8 grid gap-6 border bg-white p-6">
      <div className="grid gap-2">
        <Label htmlFor="name">艺人名称</Label>
        <Input
          id="name"
          name="name"
          placeholder="例如：宇多田ヒカル"
          required
          maxLength={160}
          aria-invalid={Boolean(state.errors?.name)}
          aria-describedby={state.errors?.name ? "name-errors" : undefined}
        />
        <FieldErrors id="name-errors" errors={state.errors?.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sortName">排序名</Label>
        <Input
          id="sortName"
          name="sortName"
          placeholder="例如：Utada Hikaru"
          maxLength={160}
          aria-invalid={Boolean(state.errors?.sortName)}
          aria-describedby={state.errors?.sortName ? "sort-name-errors" : undefined}
        />
        <FieldErrors id="sort-name-errors" errors={state.errors?.sortName} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="country">国家/地区</Label>
        <Input
          id="country"
          name="country"
          placeholder="Japan"
          maxLength={80}
          aria-invalid={Boolean(state.errors?.country)}
          aria-describedby={state.errors?.country ? "country-errors" : undefined}
        />
        <FieldErrors id="country-errors" errors={state.errors?.country} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">备注</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="收藏范围、版本偏好、资料来源说明"
          maxLength={4_000}
          aria-invalid={Boolean(state.errors?.description)}
          aria-describedby={state.errors?.description ? "description-errors" : undefined}
        />
        <FieldErrors id="description-errors" errors={state.errors?.description} />
      </div>
      {state.message ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "正在保存…" : "保存艺人库"}
      </Button>
    </form>
  );
}
