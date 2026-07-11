import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseBooleanValue, parseDateValue, parseExcelBuffer } from "@/lib/import/excel-parser";

const workbook = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      类型: "Album",
      标题: "C",
      原版发行日: "1985-09-05",
      格式: "CD",
      原版品番: "K32X-1",
      厂牌: "King",
      是否再版: "原版",
      备注: "sample album",
      "封面图 URL": "https://example.com/cover-c.jpg",
      "来源 URL": "https://example.com/source-c",
      优先级: "1",
      收集状态: "想买",
      是否纳入: "是",
    },
  ]),
  "A_原创专辑原版CD",
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      类型: "Live",
      标题: "Live Sample",
      发行日: "1985年9月5日",
      格式: "CD",
      品番: "LIVE-1",
      厂牌: "King",
      是否再版: "否",
      "来源 URL": "https://example.com/live-source",
      收集状态: "已拥有",
    },
    {
      类型: "Remix",
      标题: "Remix Sample",
      发行日: 31295,
      格式: "CD",
      品番: "RMX-1",
      是否纳入: "否",
    },
  ]),
  "C_精选现场混音",
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([{ 标题: "Should Not Import" }]),
  "总览",
);

const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const rows = parseExcelBuffer(buffer, "test.xlsx");

assert.equal(rows.length, 3);
assert.equal(rows[0].category, "ORIGINAL_ALBUM");
assert.equal(rows[0].title, "C");
assert.equal(rows[0].originalReleaseDate, "1985-09-05");
assert.equal(rows[0].coverImageUrl, "https://example.com/cover-c.jpg");
assert.equal(rows[0].sourceUrl, "https://example.com/source-c");
assert.equal(rows[0].status, "WANTED");
assert.equal(rows[1].category, "LIVE");
assert.equal(rows[1].status, "OWNED");
assert.equal(rows[2].category, "REMIX");
assert.equal(rows[2].status, "EXCLUDED");
assert.equal(parseDateValue("1985/09/05")?.toISOString().slice(0, 10), "1985-09-05");
assert.equal(parseDateValue("1985年9月5日")?.toISOString().slice(0, 10), "1985-09-05");
assert.equal(parseBooleanValue("再版"), true);
assert.equal(parseBooleanValue("原版"), false);

const priorityWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  priorityWorkbook,
  XLSX.utils.json_to_sheet([
    { 标题: "Too high", 优先级: "9" },
    { 标题: "Too low", 优先级: "-3" },
    { 标题: "No status" },
  ]),
  "A_原创专辑原版CD",
);
const priorityRows = parseExcelBuffer(XLSX.write(priorityWorkbook, { type: "buffer", bookType: "xlsx" }));
assert.deepEqual(priorityRows.map((row) => row.priority), [5, 1, 3]);
assert.equal(priorityRows[2].status, "NOT_OWNED");

console.log("Import parser test passed.");
