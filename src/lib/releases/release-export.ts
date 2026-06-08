import * as XLSX from "xlsx";
import type { ReleaseListItem } from "@/lib/releases/release-types";

function statusLabel(release: ReleaseListItem) {
  return release.userStatus?.status ?? "UNKNOWN";
}

export function releaseExportRows(releases: ReleaseListItem[]) {
  return releases.map((release) => ({
    "收藏状态": statusLabel(release),
    "优先级": release.userStatus?.priority ?? "",
    "分类": release.category,
    "标题": release.title,
    "原版发行日": release.originalReleaseDate ?? "",
    "格式": release.format,
    "原版品番": release.originalCatalogNo ?? "",
    "厂牌": release.label ?? "",
    "原价": release.originalPrice ?? "",
    "版本类型": release.editionType ?? "",
    "是否再版": release.isReissue ? "是" : "否",
    "是否 Remaster": release.isRemaster ? "是" : "否",
    "是否默认排除": release.isExcludedByDefault ? "是" : "否",
    "封面图 URL": release.coverImageUrl ?? "",
    "来源 URL": release.sources.map((source) => source.url).join("\n"),
    "备注": release.notes ?? "",
    "拥有状态备注": release.userStatus?.ownedNotes ?? release.userStatus?.notes ?? "",
  }));
}

export function buildReleaseExportWorkbook(releases: ReleaseListItem[]) {
  const worksheet = XLSX.utils.json_to_sheet(releaseExportRows(releases));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "CD-BOX");
  return workbook;
}

export function buildReleaseExportBuffer(releases: ReleaseListItem[]) {
  return XLSX.write(buildReleaseExportWorkbook(releases), {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}

export function exportFileName(artistName: string, date = new Date()) {
  const yyyyMMdd = date.toISOString().slice(0, 10).replaceAll("-", "");
  const safeArtist = artistName.replace(/[\\/:*?"<>|]/g, "_");
  return `CD-BOX_${safeArtist}_${yyyyMMdd}.xlsx`;
}
