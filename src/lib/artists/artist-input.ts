import { z } from "zod";

function optionalTrimmedText(maxLength: number, label: string) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "string") return value;

      const trimmed = value.trim();
      return trimmed || undefined;
    },
    z.string().max(maxLength, `${label}不能超过 ${maxLength} 个字符`).optional(),
  );
}

export const artistCreateSchema = z.object({
  name: z.string().trim().min(1, "请输入艺人名称").max(160, "艺人名称不能超过 160 个字符"),
  sortName: optionalTrimmedText(160, "排序名"),
  country: optionalTrimmedText(80, "国家/地区"),
  description: optionalTrimmedText(4_000, "备注"),
});

export type ArtistCreateInput = z.infer<typeof artistCreateSchema>;

export function parseArtistCreateInput(input: unknown) {
  return artistCreateSchema.safeParse(input);
}
