import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseExcelBuffer } from "@/lib/import/excel-parser";

const workbook = XLSX.utils.book_new();

const realHeaderRows = [
  {
    收集状态: "未拥有",
    优先级: "必收",
    序号: 1,
    线别: "A线",
    分类: "原创专辑",
    标题: "「C」",
    "名义/艺人": "中山美穂",
    原版CD发行日: "1985-09-05",
    原版CD品番: "K32X-30",
    格式: "CD",
    是否纳入: "纳入",
    排除提示: "避开再发",
    备注: "真实表头 fixture",
    来源URL: "https://example.com/source",
  },
];

XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(realHeaderRows), "A_原创专辑原版CD");
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      ...realHeaderRows[0],
      标题: "Sample Single",
      原版CD发行日: "1985/10/01",
      原版CD品番: "K10X-1",
    },
  ]),
  "B_单曲原版CD",
);
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      ...realHeaderRows[0],
      分类: "Live",
      标题: "Live Sample",
      原版CD发行日: "1986年1月2日",
      原版CD品番: "LIVE-1",
      是否纳入: "否",
    },
  ]),
  "C_精选现场混音",
);
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 说明: "跳过" }]), "总览");

const fixtureDir = path.resolve("tests", "fixtures");
fs.mkdirSync(fixtureDir, { recursive: true });
const fixturePath = path.join(fixtureDir, "real-template-headers.xlsx");
XLSX.writeFile(workbook, fixturePath);

const rows = parseExcelBuffer(fs.readFileSync(fixturePath), "real-template-headers.xlsx");

assert.equal(rows.length, 3);
assert.equal(rows[0].category, "ORIGINAL_ALBUM");
assert.equal(rows[0].title, "「C」");
assert.equal(rows[0].originalReleaseDate, "1985-09-05");
assert.equal(rows[0].originalCatalogNo, "K32X-30");
assert.equal(rows[0].format, "CD");
assert.equal(rows[0].notes, "真实表头 fixture");
assert.equal(rows[0].sourceUrl, "https://example.com/source");
assert.equal(rows[0].priority, 1);
assert.equal(rows[0].status, "NOT_OWNED");
assert.equal(rows[1].category, "SINGLE");
assert.equal(rows[1].originalReleaseDate, "1985-10-01");
assert.equal(rows[2].category, "LIVE");
assert.equal(rows[2].status, "EXCLUDED");

console.log("Real template header fixture test passed.");
