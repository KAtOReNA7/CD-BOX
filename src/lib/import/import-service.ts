import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type {
  DuplicateStrategy,
  ImportConfirmInput,
  ImportConfirmResult,
  ImportPreviewResult,
  ParsedReleaseRow,
} from "@/lib/import/import-types";

function toDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function releaseWhereForDuplicate(artistId: string, row: ParsedReleaseRow): Prisma.ReleaseWhereInput {
  if (row.originalCatalogNo) {
    return {
      artistId,
      originalCatalogNo: row.originalCatalogNo,
    };
  }

  return {
    artistId,
    title: row.title,
    originalReleaseDate: toDate(row.originalReleaseDate),
    format: row.format,
  };
}

async function resolvePreviewArtistId(input: ImportPreviewResult["artist"]) {
  if (input.mode === "existing") {
    return input.artistId;
  }

  if (!input.artistName.trim()) {
    return null;
  }

  const artist = await prisma.artist.findFirst({
    where: { name: input.artistName.trim() },
    select: { id: true },
  });

  return artist?.id ?? null;
}

export async function buildImportPreview(input: {
  fileName: string;
  artist: ImportPreviewResult["artist"];
  rows: ParsedReleaseRow[];
}): Promise<ImportPreviewResult> {
  const artistId = await resolvePreviewArtistId(input.artist);
  const rows: ParsedReleaseRow[] = input.rows.map((row) => ({
    ...row,
    duplicate: false,
    duplicateReleaseId: null,
  }));

  if (artistId) {
    await Promise.all(
      rows.map(async (row) => {
        if (row.errors.length > 0 || !row.title) {
          return;
        }

        const duplicate = await prisma.release.findFirst({
          where: releaseWhereForDuplicate(artistId, row),
          select: { id: true },
        });

        if (duplicate) {
          row.duplicate = true;
          row.duplicateReleaseId = duplicate.id;
        }
      }),
    );
  }

  return {
    fileName: input.fileName,
    artist: input.artist,
    summary: {
      totalRows: rows.length,
      importableRows: rows.filter((row) => row.errors.length === 0 && row.included).length,
      duplicateRows: rows.filter((row) => row.duplicate).length,
      errorRows: rows.filter((row) => row.errors.length > 0).length,
    },
    rows,
  };
}

async function resolveConfirmArtist(input: ImportConfirmInput["artist"]) {
  if (input.mode === "existing") {
    return prisma.artist.findUniqueOrThrow({
      where: { id: input.artistId },
    });
  }

  const existing = await prisma.artist.findFirst({
    where: { name: input.artistName.trim() },
  });

  if (existing) {
    return existing;
  }

  return prisma.artist.create({
    data: {
      name: input.artistName.trim(),
    },
  });
}

async function upsertReleaseStatus(userId: string, releaseId: string, row: ParsedReleaseRow) {
  await prisma.userReleaseStatus.upsert({
    where: {
      userId_releaseId: {
        userId,
        releaseId,
      },
    },
    update: {
      status: row.status,
      priority: row.priority,
    },
    create: {
      userId,
      releaseId,
      status: row.status,
      priority: row.priority,
    },
  });
}

async function addReleaseSource(releaseId: string, row: ParsedReleaseRow) {
  if (!row.sourceUrl) {
    return;
  }

  const existing = await prisma.releaseSource.findFirst({
    where: {
      releaseId,
      url: row.sourceUrl,
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.releaseSource.create({
      data: {
        releaseId,
        url: row.sourceUrl,
        label: "Imported source URL",
      },
    });
  }
}

function releaseData(row: ParsedReleaseRow, artistId: string, batchId: string) {
  return {
    artistId,
    importBatchId: batchId,
    category: row.category,
    title: row.title,
    originalReleaseDate: toDate(row.originalReleaseDate),
    format: row.format,
    originalCatalogNo: row.originalCatalogNo,
    label: row.label,
    isReissue: row.isReissue,
    notes: row.notes,
    coverImageUrl: row.coverImageUrl,
  };
}

export async function confirmImport(input: ImportConfirmInput, userId: string): Promise<ImportConfirmResult> {
  const artist = await resolveConfirmArtist(input.artist);
  const rowsWithPreview = await buildImportPreview({
    fileName: input.fileName,
    artist: { mode: "existing", artistId: artist.id, artistName: artist.name },
    rows: input.rows,
  });

  const batch = await prisma.importBatch.create({
    data: {
      userId,
      artistId: artist.id,
      fileName: input.fileName,
      status: "DRAFT",
      rowCount: input.rows.length,
      errorJson: rowsWithPreview.rows
        .filter((row) => row.errors.length > 0)
        .map((row) => ({
          sheetName: row.sheetName,
          rowNumber: row.rowNumber,
          errors: row.errors,
        })),
    },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rowsWithPreview.rows) {
    if (row.errors.length > 0) {
      errors += 1;
      continue;
    }

    if (row.duplicate && input.duplicateStrategy === "skip") {
      skipped += 1;
      continue;
    }

    if (row.duplicate && row.duplicateReleaseId && input.duplicateStrategy === "update") {
      const release = await prisma.release.update({
        where: { id: row.duplicateReleaseId },
        data: releaseData(row, artist.id, batch.id),
      });
      await upsertReleaseStatus(userId, release.id, row);
      await addReleaseSource(release.id, row);
      updated += 1;
      continue;
    }

    const release = await prisma.release.create({
      data: releaseData(row, artist.id, batch.id),
    });
    await upsertReleaseStatus(userId, release.id, row);
    await addReleaseSource(release.id, row);
    created += 1;
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: errors > 0 && created === 0 && updated === 0 ? "FAILED" : "IMPORTED",
      importedAt: new Date(),
    },
  });

  return {
    artistId: artist.id,
    batchId: batch.id,
    created,
    updated,
    skipped,
    errors,
  };
}

export function normalizeDuplicateStrategy(value: unknown): DuplicateStrategy {
  if (value === "update" || value === "create") {
    return value;
  }

  return "skip";
}
