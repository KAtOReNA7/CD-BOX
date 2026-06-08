import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

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
      厂牌: "King Records",
      是否再版: "原版",
      备注: "最小样例：来源 URL 与封面图同时存在",
      封面图: "https://example.com/real-cover-url.jpg",
      "来源 URL": "https://example.com/release-source",
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
      类型: "Single",
      标题: "Sample Single",
      发行日: "1985/10/01",
      格式: "CD",
      品番: "K10X-1",
      厂牌: "King Records",
      是否再版: "否",
      "来源 URL": "https://example.com/single-source",
      收集状态: "未拥有",
    },
  ]),
  "B_单曲原版CD",
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      类型: "Live",
      标题: "Sample Live",
      发行日: "1986年1月2日",
      格式: "CD",
      品番: "LIVE-1",
      收集状态: "已拥有",
    },
  ]),
  "C_精选现场混音",
);

XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 说明: "不导入" }]), "总览");

const outputDir = path.resolve("sample-data");
fs.mkdirSync(outputDir, { recursive: true });
XLSX.writeFile(workbook, path.join(outputDir, "cd-box-import-sample.xlsx"));
console.log("Created sample-data/cd-box-import-sample.xlsx");
