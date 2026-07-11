import type { ReleaseCategory, ReleaseFormat } from "@prisma/client";
import type { EditableCollectionStatus } from "@/lib/releases/release-types";

export const IMPORTABLE_SHEETS = [
  "A_原创专辑原版CD",
  "B_单曲原版CD",
  "C_精选现场混音",
] as const;

export type DuplicateStrategy = "skip" | "update" | "create";

export type ArtistImportTarget =
  | {
      mode: "existing";
      artistId: string;
      artistName?: string;
    }
  | {
      mode: "create";
      artistName: string;
    };

export type ParsedReleaseRow = {
  rowId: string;
  sheetName: string;
  rowNumber: number;
  category: ReleaseCategory;
  title: string;
  originalReleaseDate: string | null;
  format: ReleaseFormat;
  originalCatalogNo: string | null;
  label: string | null;
  isReissue: boolean;
  notes: string | null;
  coverImageUrl: string | null;
  sourceUrl: string | null;
  priority: number;
  status: EditableCollectionStatus;
  included: boolean;
  duplicate: boolean;
  duplicateReleaseId: string | null;
  errors: string[];
  raw: Record<string, string>;
};

export type ImportPreviewSummary = {
  totalRows: number;
  importableRows: number;
  duplicateRows: number;
  errorRows: number;
};

export type ImportPreviewResult = {
  fileName: string;
  artist: ArtistImportTarget;
  summary: ImportPreviewSummary;
  rows: ParsedReleaseRow[];
};

export type ImportConfirmInput = {
  fileName: string;
  artist: ArtistImportTarget;
  duplicateStrategy: DuplicateStrategy;
  rows: ParsedReleaseRow[];
};

export type ImportConfirmResult = {
  artistId: string;
  batchId: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
};
