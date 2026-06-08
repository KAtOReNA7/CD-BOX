import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import XLSX from "xlsx";

const { parseExcelBuffer } = await import(pathToFileURL(path.resolve("src/lib/import/excel-parser.ts")));

const sampleDir = path.resolve("sample-data");
const realFile = fs
  .readdirSync(sampleDir)
  .filter((file) => file.endsWith(".xlsx"))
  .find((file) => file !== "cd-box-import-sample.xlsx");

if (!realFile) {
  throw new Error("Place the real workbook at sample-data/中山美穂_原版CD收藏清单.xlsx before running this smoke test.");
}

const workbookPath = path.join(sampleDir, realFile);
const workbook = XLSX.readFile(workbookPath, { cellDates: true });
const parsedRows = parseExcelBuffer(fs.readFileSync(workbookPath), realFile);

const workbookSheetRows = Object.fromEntries(
  workbook.SheetNames.map((sheetName) => [
    sheetName,
    XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true }).length,
  ]),
);

const parsedSheetRows = parsedRows.reduce((acc, row) => {
  acc[row.sheetName] = (acc[row.sheetName] ?? 0) + 1;
  return acc;
}, {});

const cCategories = parsedRows
  .filter((row) => row.sheetName.startsWith("C_"))
  .reduce((acc, row) => {
    acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});

const summary = {
  file: realFile,
  workbookSheetRows,
  parsedSheetRows,
  cCategories,
  totalParsedRows: parsedRows.length,
  importableRows: parsedRows.filter((row) => row.errors.length === 0 && row.included).length,
  errorRows: parsedRows.filter((row) => row.errors.length > 0).length,
  duplicateRows: 0,
  coverImageRecognized: parsedRows.filter((row) => row.coverImageUrl).length,
  sourceUrlRecognized: parsedRows.filter((row) => row.sourceUrl).length,
  titleMapped: parsedRows.filter((row) => row.title).length,
  releaseDateMapped: parsedRows.filter((row) => row.originalReleaseDate).length,
  catalogNumberMapped: parsedRows.filter((row) => row.originalCatalogNo).length,
  formatMapped: parsedRows.filter((row) => row.format).length,
  labelMapped: parsedRows.filter((row) => row.label).length,
  notesMapped: parsedRows.filter((row) => row.notes).length,
  statusMapped: parsedRows.filter((row) => row.status).length,
  excludedRows: parsedRows.filter((row) => row.status === "EXCLUDED").length,
};

console.log(JSON.stringify(summary, null, 2));
