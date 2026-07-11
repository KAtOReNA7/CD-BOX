import fs from "node:fs";
import path from "node:path";
import { parseExcelBuffer } from "@/lib/import/excel-parser";
import { confirmImport } from "@/lib/import/import-service";
import { upsertLocalOwner } from "@/lib/auth/local-owner";
import { prisma } from "@/lib/db/prisma";

function requiredArgument(value: string | undefined, label: string) {
  const normalized = value?.normalize("NFKC").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

async function main() {
  const workbookPath = path.resolve(requiredArgument(process.argv[2], "workbook path"));
  const artistName = requiredArgument(process.argv[3], "artist name");
  const country = process.argv[4]?.normalize("NFKC").trim() || null;

  if (!fs.existsSync(workbookPath) || !fs.statSync(workbookPath).isFile()) {
    throw new Error("The exported workbook does not exist.");
  }

  const rows = parseExcelBuffer(fs.readFileSync(workbookPath), path.basename(workbookPath));
  if (rows.length === 0) {
    throw new Error("The workbook contains no importable CD-BOX rows.");
  }
  if (rows.some((row) => row.errors.length > 0)) {
    throw new Error("The workbook contains invalid rows; no import was attempted.");
  }

  const owner = await upsertLocalOwner();
  const result = await confirmImport(
    {
      fileName: path.basename(workbookPath),
      artist: { mode: "create", artistName },
      duplicateStrategy: "update",
      rows,
    },
    owner.id,
  );

  if (country) {
    await prisma.artist.update({
      where: { id: result.artistId },
      data: { country },
    });
  }

  console.log(JSON.stringify({
    artistId: result.artistId,
    artistName,
    rows: rows.length,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors,
  }, null, 2));
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Local export import failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
