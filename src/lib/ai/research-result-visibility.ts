import type {
  ReleaseResearchCandidateAudit,
  ReleaseResearchLedgerEntry,
  ReleaseResearchStageSummaryView,
  ReleaseResearchVerificationSummary,
  ResearchCandidateResolution,
} from "@/lib/ai/release-research-types";

export type ResearchFunnelMetricKey =
  | "raw-releases"
  | "work-groups"
  | "national-bibliography"
  | "cross-source"
  | "ai-accepted"
  | "cover-valid"
  | "automatically-filtered";

export type ResearchFunnelMetric = {
  key: ResearchFunnelMetricKey;
  label: string;
  value: number | null;
  detail: string;
};

export type ResearchOutcomeReason = {
  resolution: Exclude<ResearchCandidateResolution, "VERIFIED">;
  stage: string;
  reasonCode: string;
  message: string;
  retryable: boolean;
  count: number;
  candidateIds: string[];
};

export type ResearchProgressStepStatus = "complete" | "active" | "pending";

export type ResearchProgressStep = {
  key: ResearchFunnelMetricKey;
  label: string;
  status: ResearchProgressStepStatus;
};

export type ResearchStageAuditRow = ReleaseResearchStageSummaryView & {
  label: string;
  explanation: string;
  reasons: Array<{
    reasonCode: string;
    label: string;
    count: number;
  }>;
};

const progressDefinitions: Array<{
  key: ResearchFunnelMetricKey;
  label: string;
  start: number;
  end: number;
}> = [
  { key: "raw-releases", label: "原始版本", start: 15, end: 57 },
  { key: "work-groups", label: "作品分组", start: 58, end: 63 },
  { key: "national-bibliography", label: "国家书目", start: 64, end: 75 },
  { key: "cross-source", label: "跨源一致", start: 76, end: 76 },
  { key: "ai-accepted", label: "AI 通过", start: 77, end: 85 },
  { key: "cover-valid", label: "封面有效", start: 86, end: 93 },
  { key: "automatically-filtered", label: "自动过滤", start: 94, end: 99 },
];

const stageSequence: Record<string, number> = {
  DISCOVERY: 10,
  SCOPE: 20,
  MUSICBRAINZ: 30,
  AUTHORITATIVE: 40,
  CORROBORATION: 50,
  AI_AUDIT: 60,
  COVER: 70,
  SELECTION: 80,
  RESOLUTION: 90,
};

const stageLabels: Record<string, string> = {
  DISCOVERY: "原始版本",
  SCOPE: "收藏范围",
  MUSICBRAINZ: "版本身份",
  AUTHORITATIVE: "权威书目",
  CORROBORATION: "跨源一致",
  AI_AUDIT: "AI 裁决",
  COVER: "封面核验",
  SELECTION: "版本选择",
  RESOLUTION: "最终去向",
};

const reasonLabels: Record<string, string> = {
  RELEASE_TYPE_DISABLED: "该发行类型未包含在本次搜索范围内",
  MB_STATUS_NOT_OFFICIAL: "MusicBrainz 标记为非正式发行",
  MB_FORMAT_OUTSIDE_TARGET: "实体格式不符合当前收藏口径",
  MB_COUNTRY_OUTSIDE_TARGET: "发行地区不符合当前收藏口径",
  LATER_EDITION_NOT_SELECTED: "同一作品已有更早且已核验的版本",
  LATER_COMPOSITE_REISSUE_BUNDLE: "后期合辑或再版组合未作为原始作品收录",
  DISCOGS_REISSUE_OUT_OF_SCOPE: "Discogs 标记为再版，已按收藏口径排除",
  DISCOGS_RELEASE_TYPE_OUT_OF_SCOPE: "Discogs 发行类型不在本次范围内",
  DISCOGS_PROMOTIONAL_EDITION_OUT_OF_SCOPE: "宣传版不在本次收藏范围内",
  DISCOGS_LATER_MASTER_EDITION_OUT_OF_SCOPE: "Discogs 同作品的后续版本未选",
  DISCOGS_WORK_TYPE_UNRESOLVED: "Discogs 无法确认作品类型",
  DISCOGS_SCOPE_ROWS_CONFLICT: "Discogs 的范围信息互相冲突",
  CURATED_HISTORICAL_NON_CANONICAL_WORK: "该作品不在权威目录截至日期的完整历史正典内",
  CURATED_CANONICAL_TITLE_DATE_CONFLICT: "标题命中正典作品，但原始发行日期与权威目录冲突",
  NDL_CATALOG_NOT_FOUND: "NDL 国家书目未找到匹配记录",
  NDL_CANDIDATE_INCOMPLETE: "缺少品番或日期，无法完成 NDL 精确查询",
  NDL_LOOKUP_LIMIT: "NDL 查询预算已用尽，等待后续补查",
  NDL_UNAVAILABLE: "NDL 服务暂时不可用",
  NDL_DATE_CONFLICT_UNRESOLVED: "NDL 日期与候选记录不一致，尚未解决",
  NDL_ARTIST_CONFLICT_UNRESOLVED: "NDL 艺人信息与候选记录不一致，尚未解决",
  OFFICIAL_CANDIDATE_LIMIT: "官方目录查询预算已用尽，等待后续补查",
  OFFICIAL_CATALOG_NOT_FOUND: "官方目录未找到唯一匹配记录",
  OFFICIAL_CATALOG_AMBIGUOUS: "官方目录存在多个可能匹配，无法唯一确认",
  OFFICIAL_LABEL_WORK_NOT_FOUND: "唱片公司官方目录未找到该作品",
  OFFICIAL_LABEL_WORK_AMBIGUOUS: "唱片公司官方目录存在歧义",
  SOUND_FUJI_SOURCE_INCOMPLETE: "唱片公司档案暂时未能完整读取",
  DISCOGS_EXACT_EDITION_NOT_FOUND: "Discogs 未找到可唯一绑定的实体版本",
  DISCOGS_MULTIPLE_EXACT_EDITIONS: "Discogs 找到多个精确版本，暂时无法唯一选择",
  MISSING_INDEPENDENT_CORROBORATION: "缺少第二个独立来源佐证",
  INSUFFICIENT_EVIDENCE: "现有证据不足，等待继续补证",
  AI_REVIEW_DISAGREEMENT: "两次 AI 证据裁决不一致，暂不收录",
  AI_AUDIT_FAILED: "AI 证据裁决暂时失败，等待重试",
  AI_REJECTION_CONFIRMED: "两次 AI 裁决均确认存在证据冲突",
  EXACT_COVER_NOT_FOUND: "未找到与该作品或版本精确匹配的封面",
  COVER_SOURCE_TEMPORARILY_UNAVAILABLE: "封面来源暂时不可用，系统会继续重试",
  COVER_LOOKUP_FAILED: "封面查询失败，系统会继续重试",
  COVER_RETRY_FAILED: "封面自动重试仍未成功",
  COVER_INVALID: "找到的封面文件未通过有效性校验",
  EXACT_COVER_INVALID: "精确匹配的封面文件未通过有效性校验",
  LEGACY_VERIFIED_COVER_DATE_MISMATCH_QUARANTINED: "旧封面的版本日期不匹配，已隔离并等待精确重试",
  LEGACY_VERIFIED_PHYSICAL_IDENTITY_INCOMPLETE_QUARANTINED: "旧记录缺少完整实体 CD 日期或格式，等待权威补证",
  VERIFIED: "已通过全部终验门禁",
  PENDING_EVIDENCE: "等待补充权威或独立佐证",
  PENDING_COVER: "证据已通过，等待有效封面",
  REJECTED: "存在明确证据冲突",
  OUT_OF_SCOPE: "不在本次收藏范围",
};

const resolutionOrder: Record<Exclude<ResearchCandidateResolution, "VERIFIED">, number> = {
  REJECTED: 0,
  OUT_OF_SCOPE: 1,
  PENDING_EVIDENCE: 2,
  PENDING_COVER: 3,
};

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function isNdlSourceUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase("en-US");
    return hostname === "ndlsearch.ndl.go.jp" || hostname.endsWith(".ndl.go.jp");
  } catch {
    return false;
  }
}

function isNdlPass(entry: ReleaseResearchLedgerEntry) {
  return entry.stage === "AUTHORITATIVE" &&
    entry.verdict === "PASS" &&
    (entry.reasonCode.startsWith("NDL_") || entry.sourceUrls.some(isNdlSourceUrl));
}

function hasCoverPass(audit: ReleaseResearchCandidateAudit) {
  return [...audit.ledger].reverse().find((entry) => entry.stage === "COVER")?.verdict === "PASS";
}

/**
 * Funnel figures deliberately use only fields persisted in the completed
 * result or per-candidate audit ledger. Missing historical audit fields stay
 * unavailable instead of being inferred from an unrelated downstream count.
 */
export function buildResearchFunnelMetrics(
  summary: ReleaseResearchVerificationSummary | null | undefined,
  audits: readonly ReleaseResearchCandidateAudit[] | undefined,
): ResearchFunnelMetric[] {
  const auditAvailable = audits !== undefined;
  let nationalBibliographyCount = 0;
  let coverValidCount = 0;
  let automaticallyFilteredCount = 0;
  if (audits) {
    for (const audit of audits) {
      if (audit.ledger.some(isNdlPass)) nationalBibliographyCount += 1;
      if (hasCoverPass(audit)) coverValidCount += 1;
      if (audit.resolution !== "VERIFIED") automaticallyFilteredCount += 1;
    }
  }
  const nationalBibliography = auditAvailable ? nationalBibliographyCount : null;
  const coverValid = auditAvailable ? coverValidCount : null;
  const automaticallyFiltered = auditAvailable ? automaticallyFilteredCount : null;

  return [
    {
      key: "raw-releases",
      label: "原始版本",
      value: nonnegativeInteger(summary?.rawReleases),
      detail: "公共资料源抓取到的原始版本记录",
    },
    {
      key: "work-groups",
      label: "作品分组",
      value: nonnegativeInteger(summary?.releaseGroups),
      detail: "按作品身份合并后的分组数",
    },
    {
      key: "national-bibliography",
      label: "国家书目",
      value: nationalBibliography,
      detail: "审计账本中由 NDL 明确通过的版本数",
    },
    {
      key: "cross-source",
      label: "跨源一致",
      value: nonnegativeInteger(summary?.crossSourceMatches),
      detail: "达到跨源证据门槛、可交给 AI 裁决的版本数",
    },
    {
      key: "ai-accepted",
      label: "AI 通过",
      value: nonnegativeInteger(summary?.aiAccepted),
      detail: "AI 仅依据已提供证据裁决通过的版本数",
    },
    {
      key: "cover-valid",
      label: "封面有效",
      value: coverValid,
      detail: "审计账本中通过封面文件与匹配校验的版本数",
    },
    {
      key: "automatically-filtered",
      label: "自动过滤",
      value: automaticallyFiltered,
      detail: "未进入最终列表的版本数，包含待补证据、待补封面和范围外版本",
    },
  ];
}

function preferredLedgerEntry(
  audit: ReleaseResearchCandidateAudit,
  predicate: (entry: ReleaseResearchLedgerEntry) => boolean,
) {
  let selectedEntry: ReleaseResearchLedgerEntry | null = null;
  let selectedScore = -1;
  let selectedIndex = -1;
  audit.ledger.forEach((entry, index) => {
    if (!predicate(entry)) return;
    const score = stageSequence[entry.stage] ?? 0;
    if (score > selectedScore || (score === selectedScore && index > selectedIndex)) {
      selectedEntry = entry;
      selectedScore = score;
      selectedIndex = index;
    }
  });
  return selectedEntry;
}

export function decisiveResearchLedgerEntry(audit: ReleaseResearchCandidateAudit) {
  const preferred = audit.resolution === "REJECTED"
    ? preferredLedgerEntry(audit, (entry) => entry.verdict === "REJECT")
    : audit.resolution === "OUT_OF_SCOPE"
      ? preferredLedgerEntry(audit, (entry) => entry.verdict === "OUT_OF_SCOPE")
      : audit.resolution === "PENDING_COVER"
        ? preferredLedgerEntry(audit, (entry) => entry.stage === "COVER" && entry.verdict === "UNKNOWN")
        : audit.resolution === "PENDING_EVIDENCE"
          ? preferredLedgerEntry(audit, (entry) => entry.stage !== "COVER" && entry.verdict === "UNKNOWN")
          : preferredLedgerEntry(audit, (entry) => entry.stage === "COVER" && entry.verdict === "PASS");
  return preferred ?? audit.ledger.at(-1) ?? null;
}

export function buildResearchOutcomeReasons(
  audits: readonly ReleaseResearchCandidateAudit[],
): ResearchOutcomeReason[] {
  const grouped = new Map<string, ResearchOutcomeReason>();
  for (const audit of audits) {
    if (audit.resolution === "VERIFIED") continue;
    const entry = decisiveResearchLedgerEntry(audit);
    if (!entry) continue;
    const key = `${audit.resolution}\u0000${entry.stage}\u0000${entry.reasonCode}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      current.candidateIds.push(audit.candidateId);
      current.retryable ||= entry.retryable;
      continue;
    }
    grouped.set(key, {
      resolution: audit.resolution,
      stage: entry.stage,
      reasonCode: entry.reasonCode,
      message: entry.message,
      retryable: entry.retryable,
      count: 1,
      candidateIds: [audit.candidateId],
    });
  }
  return [...grouped.values()].sort((left, right) =>
    resolutionOrder[left.resolution] - resolutionOrder[right.resolution] ||
    right.count - left.count ||
    (stageSequence[left.stage] ?? 0) - (stageSequence[right.stage] ?? 0) ||
    left.reasonCode.localeCompare(right.reasonCode, "en"));
}

export function matchesResearchOutcomeReason(
  audit: ReleaseResearchCandidateAudit,
  reason: Pick<ResearchOutcomeReason, "resolution" | "stage" | "reasonCode">,
) {
  if (audit.resolution !== reason.resolution) return false;
  const entry = decisiveResearchLedgerEntry(audit);
  return entry?.stage === reason.stage && entry.reasonCode === reason.reasonCode;
}

export function researchStageLabel(stage: string) {
  return stageLabels[stage] ?? stage;
}

export function researchResolutionLabel(resolution: ResearchCandidateResolution) {
  if (resolution === "VERIFIED") return "已核验";
  if (resolution === "PENDING_EVIDENCE") return "待补证据";
  if (resolution === "PENDING_COVER") return "待补封面";
  if (resolution === "REJECTED") return "明确冲突";
  return "不在范围";
}

export function researchReasonLabel(reasonCode: string) {
  if (reasonLabels[reasonCode]) return reasonLabels[reasonCode];
  if (reasonCode.startsWith("NDL_")) return "NDL 国家书目尚未完成唯一确认";
  if (reasonCode.startsWith("OFFICIAL_")) return "官方目录尚未完成唯一确认";
  if (reasonCode.startsWith("DISCOGS_")) return "Discogs 证据尚未完成唯一确认";
  if (reasonCode.includes("COVER")) return "封面尚未通过精确匹配与文件校验";
  return "请查看审计代码与来源说明";
}

export function selectTrustedFinalReleases<T extends { id: string }>(
  releases: readonly T[],
  trustedCandidateIds: readonly string[],
) {
  if (releases.length === 0 || trustedCandidateIds.length === 0) return [];
  const trusted = new Set(trustedCandidateIds);
  const selected: T[] = [];
  for (const release of releases) {
    if (trusted.has(release.id)) selected.push(release);
  }
  return selected;
}

function stageSummaryExplanation(summary: ReleaseResearchStageSummaryView) {
  const dispositions = [
    `通过 ${summary.passedCount}`,
    `延后 ${summary.deferredCount}`,
    `拒绝 ${summary.rejectedCount}`,
    `合并 ${summary.mergedCount}`,
  ];
  const retry = summary.retryCount > 0
    ? `；其中 ${summary.retryCount} 条已进入或等待重试`
    : "；本阶段没有可重试条目";
  const completeness = summary.detailsComplete
    ? ""
    : "历史摘要的逐条明细不完整；";
  return `${completeness}输入 ${summary.inputCount}，${dispositions.join("，")}${retry}。各阶段可能补充或合并候选，不能用相邻数字直接相减。`;
}

export function buildResearchStageAuditRows(
  summaries: readonly ReleaseResearchStageSummaryView[],
): ResearchStageAuditRow[] {
  const rows: ResearchStageAuditRow[] = [];
  for (const summary of summaries) {
    const reasons = Object.entries(summary.reasonCounts)
      .map(([reasonCode, count]) => ({
        reasonCode,
        label: researchReasonLabel(reasonCode),
        count,
      }))
      .sort((left, right) => right.count - left.count ||
        left.reasonCode.localeCompare(right.reasonCode, "en"));
    rows.push({
      ...summary,
      label: researchStageLabel(summary.stage),
      explanation: stageSummaryExplanation(summary),
      reasons,
    });
  }
  return rows;
}

export function buildResearchProgressSteps(progress: number | null | undefined): ResearchProgressStep[] {
  const normalized = typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : null;
  return progressDefinitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    status: normalized === null || normalized < definition.start
      ? "pending"
      : normalized >= 100 || normalized > definition.end
        ? "complete"
        : "active",
  }));
}

export function researchProgressDetail(progress: number | null | undefined) {
  if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 15) {
    return "任务已排队，后台启动后会逐阶段更新进度与当前处理数量。";
  }
  if (progress < 58) return "正在建立完整实体发行候选，并读取版本、地区、格式与初始封面资料。";
  if (progress < 64) return "正在把同一作品的不同实体版本归组，并应用本次收藏范围。";
  if (progress < 76) return "正在逐条查询 NDL 国家书目与官方目录；处理数量会显示在当前阶段名称中。";
  if (progress < 77) return "正在合并 MusicBrainz、国家书目、官方目录与 Discogs 的独立证据。";
  if (progress < 86) return "AI 只裁决已提供的证据；等待较久时会持续显示批次与已等待秒数。";
  if (progress < 94) return "正在验证封面来源、真实文件签名、尺寸以及作品或版本匹配关系。";
  if (progress < 100) return "正在保存逐条核验账本，并计算每个未收录版本的最终阶段与原因。";
  return "核验账本与最终结果已保存。";
}
