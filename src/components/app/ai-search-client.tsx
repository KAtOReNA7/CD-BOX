"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import type React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, FileText, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationProgress } from "@/components/app/operation-progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  addCandidateIds,
  removeCandidateIds,
  toggleCandidateId,
} from "@/lib/ai/release-research-selection";
import type {
  AiSearchTaskView,
  CollectionScopeTarget,
  ReleaseResearchCandidate,
} from "@/lib/ai/release-research-types";
import type { AiProviderCapabilitySummary as ProviderSummary } from "@/lib/ai/provider-capabilities";
import { DISCOGS_ATTRIBUTION } from "@/lib/discogs/constants";
import { NDL_SEARCH_ATTRIBUTION } from "@/lib/ndl/constants";

type ArtistOption = { id: string; name: string };
type ActiveOperation = "search" | "structure" | "import" | "navigating";

const categories = ["ALL", "ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "BOX", "EP", "OTHER"];
const EMPTY_RELEASES: ReleaseResearchCandidate[] = [];
const taskPollIntervalMs = 1_500;
const maxTaskPolls = 1_200;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function researchModeLabel(rawResult: unknown) {
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult) || !("mode" in rawResult)) {
    return null;
  }
  if (rawResult.mode === "public-metadata") return "公共资料源";
  if (rawResult.mode === "native-web-search") return "原生 web_search";
  return null;
}

function isSafeByDefault(release: ReleaseResearchCandidate) {
  return release.verification?.status === "VERIFIED" &&
    release.verification.aiDecision === "ACCEPT" &&
    release.confidence === "HIGH" &&
    !release.isExcludedByDefault &&
    release.sources.length >= 2 &&
    Boolean(release.coverImageUrl && release.coverImageSourceUrl);
}

export function AiSearchClient({ artists, capabilities }: { artists: ArtistOption[]; capabilities: ProviderSummary }) {
  const router = useRouter();
  const [navigationPending, startNavigation] = useTransition();
  const [artistName, setArtistName] = useState("中山美穂");
  const [country, setCountry] = useState("Japan");
  const [target, setTarget] = useState<CollectionScopeTarget>("ORIGINAL_CD");
  const [excludeReissues, setExcludeReissues] = useState(true);
  const [includeCollaborations, setIncludeCollaborations] = useState(true);
  const [includeLiveRemixBest, setIncludeLiveRemixBest] = useState(true);
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [defaultCoverSourceUrl, setDefaultCoverSourceUrl] = useState("");
  const [task, setTask] = useState<AiSearchTaskView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [artistMode, setArtistMode] = useState<"create" | "existing">("create");
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [importArtistName, setImportArtistName] = useState("中山美穂");

  const releases = task?.parsedResult?.releases ?? EMPTY_RELEASES;
  const visibleReleases = useMemo(
    () =>
      releases.filter((release) => {
        return categoryFilter === "ALL" || release.category === categoryFilter;
      }),
    [categoryFilter, releases],
  );
  const visibleCandidateIds = visibleReleases.map((release) => release.id);
  const visibleSelectedCount = visibleCandidateIds.filter((candidateId) => selectedIds.has(candidateId)).length;
  const verificationSummary = task?.parsedResult?.verificationSummary ?? null;
  const allResultsVerified = releases.length > 0 && releases.every(isSafeByDefault);
  const progressOperation: ActiveOperation | null = navigationPending ? "navigating" : activeOperation;
  const busy = progressOperation !== null;
  const onlineResearchAvailable = capabilities.configurationReady && capabilities.webSearchEnabled;
  const completedResearchMode = researchModeLabel(task?.rawResult);
  const recognizedArtistNames = task?.parsedResult
    ? [...new Set([
        task.parsedResult.artist.name,
        task.parsedResult.artist.nameKana,
        task.parsedResult.artist.nameRomaji,
      ].filter((name): name is string => Boolean(name?.trim())))]
    : [];

  function setPendingTask() {
    setTask({
      id: "pending",
      status: "pending",
      progress: 5,
      stage: "正在提交任务",
      query: "",
      model: "",
      errorMessage: null,
      rawResult: null,
      parsedResult: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function applyTaskPayload(payload: AiSearchTaskView) {
    setTask(payload);
    const nextSelected = new Set<string>();

    for (const release of payload.parsedResult?.releases ?? []) {
      if (isSafeByDefault(release)) nextSelected.add(release.id);
    }

    setSelectedIds(nextSelected);
    setImportArtistName(payload.parsedResult?.artist?.name ?? artistName);
  }

  async function pollTask(taskId: string) {
    for (let attempt = 0; attempt < maxTaskPolls; attempt += 1) {
      await wait(taskPollIntervalMs);
      const response = await fetch(`/api/ai-search/tasks/${taskId}`, { cache: "no-store" });
      const payload = (await response.json()) as AiSearchTaskView & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "读取联网搜索任务失败。");
      }

      setTask(payload);
      if (payload.status === "succeeded" || payload.status === "failed") {
        return payload;
      }
    }

    throw new Error("联网搜索仍在后台运行，请稍后刷新任务页面。");
  }

  async function startSearch() {
    if (!onlineResearchAvailable) return;
    setActiveOperation("search");
    setMessage(null);
    setPendingTask();

    try {
      const response = await fetch("/api/ai-search/release-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistName, country, target, excludeReissues, includeCollaborations, includeLiveRemixBest }),
      });
      const payload = (await response.json()) as AiSearchTaskView & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "联网搜索失败。");
      }

      if (payload.status === "pending" || payload.status === "running") {
        setTask(payload);
      }
      const completed =
        payload.status === "pending" || payload.status === "running" ? await pollTask(payload.id) : payload;

      if (completed.status === "failed") {
        setTask(completed);
        setMessage(completed.errorMessage ?? "联网搜索失败。");
        return;
      }

      applyTaskPayload(completed);
    } catch (error) {
      setTask(null);
      setMessage(error instanceof Error ? error.message : "联网搜索失败。");
    } finally {
      setActiveOperation(null);
    }
  }

  async function structureNotes() {
    setActiveOperation("structure");
    setMessage(null);
    setPendingTask();

    try {
      const response = await fetch("/api/ai-search/structure-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistName,
          country,
          target,
          excludeReissues,
          includeCollaborations,
          includeLiveRemixBest,
          sourceText,
          sourceUrl: sourceUrl.trim() || null,
          defaultCoverSourceUrl: defaultCoverSourceUrl.trim() || null,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "资料整理失败。");
      }
      applyTaskPayload(payload);
    } catch (error) {
      setTask(null);
      setMessage(error instanceof Error ? error.message : "资料整理失败。");
    } finally {
      setActiveOperation(null);
    }
  }

  async function importCandidates() {
    if (!task || task.id === "pending") return;
    const selected = releases.filter((release) => selectedIds.has(release.id));
    const skipped = releases.length - selected.length;
    if (!selected.every(isSafeByDefault)) {
      setMessage("仅允许导入已经通过国家书目、跨源、AI 与封面硬门禁的条目。");
      return;
    }
    const ok = window.confirm(`将导入 ${selected.length} 条已核验发行，跳过 ${skipped} 条。是否继续？`);
    if (!ok) return;

    setActiveOperation("import");
    setMessage(null);
    try {
      const response = await fetch(`/api/ai-search/tasks/${task.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistMode,
          artistId,
          artistName: importArtistName,
          selectedCandidateIds: [...selectedIds],
          excludedCandidateIds: [],
          pendingReviewCandidateIds: [],
          candidateEdits: {},
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "候选导入失败。");
      }
      setMessage(`创建 ${payload.imported} 条，更新已有 ${payload.updatedDuplicates ?? 0} 条，保留封面冲突 ${payload.coverConflicts ?? 0} 条；新收录项全部已通过自动核验并有有效封面。`);
      setActiveOperation(null);
      startNavigation(() => router.push(`/artists/${payload.artistId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "候选导入失败。");
    } finally {
      setActiveOperation(null);
    }
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => toggleCandidateId(current, id));
  }

  return (
    <div className="grid gap-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">AI Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold">资料整理</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          通过联网搜索建立可核对的实体 CD 发行候选；也可以粘贴官网、唱片公司、唱片店或数据库资料进行补充整理。
        </p>
      </div>

      {message ? (
        <Alert variant={message.includes("创建") ? "default" : "destructive"}>
          <AlertCircle className="size-4" />
          <AlertTitle>结果</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {!onlineResearchAvailable ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>联网搜索尚未就绪</AlertTitle>
          <AlertDescription>
            <details>
              <summary className="cursor-pointer text-sm font-medium">查看中转站能力</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Capability label="Text model" ok={capabilities.textSupported} />
            <Capability label="JSON output" ok={capabilities.jsonSupported} />
            <Capability label="Responses API" ok={capabilities.responsesSupported} />
            <Capability label="web_search" ok={capabilities.webSearchSupported} />
            <p className="md:col-span-4 text-sm text-muted-foreground">
              请先完成中转站基础配置，并将 AI_ENABLE_WEB_SEARCH 设为 true。
            </p>
          </div>
            </details>
          </AlertDescription>
        </Alert>
      ) : null}

      {onlineResearchAvailable ? (
        <Alert>
          <Search className="size-4" />
          <AlertTitle>联网研究使用权威公共资料源</AlertTitle>
          <AlertDescription>
            系统直接查询 MusicBrainz、NDL 国家书目、Discogs 与封面 API，再由 GPT-5.6 只对给定证据做保守终审；不依赖中转站原生 web_search。
          </AlertDescription>
        </Alert>
      ) : null}

      {progressOperation ? (
        <OperationProgress
          label={
            progressOperation === "search"
              ? (task?.stage ?? "正在联网搜索发行资料…")
              : progressOperation === "structure"
                ? "正在整理粘贴资料…"
                : progressOperation === "import"
                  ? `正在导入 ${selectedIds.size} 条候选…`
                  : "导入成功，正在打开艺人库…"
          }
          detail={
            progressOperation === "search"
              ? "正在核对来源、发行信息、原文艺人名与封面，通常需要 1–3 分钟。"
              : progressOperation === "structure"
                ? "正在解析字段并执行收藏范围与置信度检查。"
                : progressOperation === "import"
                  ? "正在创建发行记录并保存来源，请勿重复提交。"
                  : "页面即将自动跳转。"
          }
          value={progressOperation === "search" ? task?.progress : undefined}
          max={progressOperation === "search" && task?.progress !== undefined ? 100 : undefined}
        />
      ) : null}

      <Tabs defaultValue={onlineResearchAvailable ? "online-search" : "pasted-structure"}>
        <TabsList>
          {onlineResearchAvailable ? <TabsTrigger value="online-search">联网搜索</TabsTrigger> : null}
          <TabsTrigger value="pasted-structure">粘贴资料整理</TabsTrigger>
        </TabsList>
        <TabsContent value="pasted-structure" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="size-5" />
                粘贴资料整理
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-3">
              <fieldset disabled={busy} className="contents">
                <SharedSettings
                artistName={artistName}
                setArtistName={setArtistName}
                country={country}
                setCountry={setCountry}
                target={target}
                setTarget={setTarget}
                excludeReissues={excludeReissues}
                setExcludeReissues={setExcludeReissues}
                includeCollaborations={includeCollaborations}
                setIncludeCollaborations={setIncludeCollaborations}
                includeLiveRemixBest={includeLiveRemixBest}
                setIncludeLiveRemixBest={setIncludeLiveRemixBest}
              />
              <Field label="来源 URL，可选">
                <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/discography" />
              </Field>
              <Field label="默认封面来源 URL，可选">
                <Input value={defaultCoverSourceUrl} onChange={(event) => setDefaultCoverSourceUrl(event.target.value)} placeholder="https://example.com/cover-source" />
              </Field>
              <div className="grid gap-2 lg:col-span-3">
                <Label>粘贴资料文本</Label>
                <Textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  rows={10}
                  placeholder="粘贴官网、厂牌、唱片店、数据库、表格或 CSV 文本。这里只整理已有事实，不联网搜索。"
                />
              </div>
                <div className="lg:col-span-3">
                  <Button onClick={structureNotes} disabled={busy || !artistName.trim() || !sourceText.trim()} className="gap-2">
                    <FileText className="size-4" />
                    {activeOperation === "structure" ? "正在整理…" : "整理为候选清单"}
                  </Button>
                </div>
              </fieldset>
            </CardContent>
          </Card>
        </TabsContent>

        {onlineResearchAvailable ? (
          <TabsContent value="online-search" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="size-5" />
                  联网搜索
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-3">
                <fieldset disabled={busy} className="contents">
                  <SharedSettings
                  artistName={artistName}
                  setArtistName={setArtistName}
                  country={country}
                  setCountry={setCountry}
                  target={target}
                  setTarget={setTarget}
                  excludeReissues={excludeReissues}
                  setExcludeReissues={setExcludeReissues}
                  includeCollaborations={includeCollaborations}
                  setIncludeCollaborations={setIncludeCollaborations}
                  includeLiveRemixBest={includeLiveRemixBest}
                  setIncludeLiveRemixBest={setIncludeLiveRemixBest}
                />
                  <div className="lg:col-span-3">
                    <Button onClick={startSearch} disabled={busy || !artistName.trim()} className="gap-2">
                      <Search className="size-4" />
                      {activeOperation === "search" ? "正在联网搜索…" : "搜索发行资料"}
                    </Button>
                  </div>
                </fieldset>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      {task ? (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3 border bg-white p-4">
            <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{task.status}</Badge>
            {completedResearchMode ? <Badge variant="outline">{completedResearchMode}</Badge> : null}
            <span className="text-sm text-muted-foreground">model: {task.model || "pending"}</span>
          </div>
          {task.status === "failed" ? (
            <pre className="max-h-72 overflow-auto border bg-white p-4 text-xs">
              {task.errorMessage ?? JSON.stringify(task.rawResult, null, 2)}
            </pre>
          ) : null}
        </section>
      ) : null}

      {task?.parsedResult ? (
        <section className="grid gap-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <p className="text-xs text-muted-foreground">识别到的艺人名称</p>
                <p className="mt-1 text-xl font-semibold">{task.parsedResult.artist.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[task.parsedResult.artist.nameKana, task.parsedResult.artist.nameRomaji].filter(Boolean).join(" · ") || "暂无其他名称"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="选择导入艺人名称">
                {recognizedArtistNames.map((name) => (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    variant={importArtistName === name ? "secondary" : "outline"}
                    onClick={() => setImportArtistName(name)}
                    disabled={busy}
                  >
                    使用 {name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-7">
            <Metric label="原始版本" value={verificationSummary?.rawReleases ?? releases.length} />
            <Metric label="作品分组" value={verificationSummary?.releaseGroups ?? releases.length} />
            <Metric label="国家书目" value={verificationSummary?.authoritativeMatches ?? 0} />
            <Metric label="跨源一致" value={verificationSummary?.crossSourceMatches ?? 0} />
            <Metric label="AI 通过" value={verificationSummary?.aiAccepted ?? 0} />
            <Metric label="封面有效" value={releases.length} />
            <Metric
              label="自动过滤"
              value={verificationSummary
                ? verificationSummary.rejectedByEvidence + verificationSummary.rejectedByAi + verificationSummary.rejectedWithoutCover + verificationSummary.rejectedCoverUnavailable
                : 0}
            />
          </div>

          {!allResultsVerified ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>结果尚未达到最终收录标准</AlertTitle>
              <AlertDescription>这些资料只能查看；请使用联网搜索完成国家书目、跨源、AI 与封面核验后再导入。</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Search className="size-4" />
              <AlertTitle>仅显示最终核验结果</AlertTitle>
              <AlertDescription>未通过国家书目、跨源一致性、AI 证据裁决或封面有效性检查的条目已自动隐藏，无需人工辨别。</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
            <div className="flex flex-wrap gap-3">
              <Select value={categoryFilter} onValueChange={setCategoryFilter} disabled={busy}>
                <SelectTrigger className="w-44" aria-label="分类筛选"><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-sm text-muted-foreground" role="status" aria-live="polite">
                当前已选 {visibleSelectedCount}/{visibleCandidateIds.length}，总计 {selectedIds.size}
              </span>
              <Button
                variant="outline"
                onClick={() => setSelectedIds((current) => addCandidateIds(current, visibleCandidateIds))}
                disabled={busy || visibleCandidateIds.length === 0 || visibleSelectedCount === visibleCandidateIds.length}
              >
                全选当前结果
              </Button>
              <Button
                variant="outline"
                onClick={() => setSelectedIds((current) => removeCandidateIds(current, visibleCandidateIds))}
                disabled={busy || visibleSelectedCount === 0}
              >
                取消全选当前结果
              </Button>
            </div>
          </div>

          <ReleaseCandidateTable
            releases={visibleReleases}
            selectedIds={selectedIds}
            expandedIds={expandedIds}
            disabled={busy}
            toggleSelected={(id) => toggle(setSelectedIds, id)}
            toggleExpanded={(id) => toggle(setExpandedIds, id)}
          />
          <p className="text-xs text-muted-foreground">
            发行身份必须先通过日本国立国会图书馆国家书目，再由 MusicBrainz 与 Discogs 交叉核对；AI 只比较给定证据并可拒绝冲突项。封面只接受精确 CAA release 或精确 Discogs release 的 primary 图片，并校验真实文件签名与尺寸。{" "}
            <a href={NDL_SEARCH_ATTRIBUTION.apiTermsUrl} target="_blank" rel="noreferrer" className="underline">
              {NDL_SEARCH_ATTRIBUTION.displayNotice}
            </a>{" "}
            {NDL_SEARCH_ATTRIBUTION.dataNotice} ({NDL_SEARCH_ATTRIBUTION.licenseName}){" · "}
            <a href={DISCOGS_ATTRIBUTION.apiDocumentationUrl} target="_blank" rel="noreferrer" className="underline">
              {DISCOGS_ATTRIBUTION.dataNotice}
            </a>{" "}
            {DISCOGS_ATTRIBUTION.nonAffiliationNotice}
          </p>

          <Card>
            <CardHeader><CardTitle className="text-lg">导入候选</CardTitle></CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <Field label="导入目标">
                <Select value={artistMode} disabled={busy} onValueChange={(value) => setArtistMode(value as "create" | "existing")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">新建艺人</SelectItem>
                    <SelectItem value="existing">已有艺人</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {artistMode === "create" ? (
                <Field label="艺人名"><Input value={importArtistName} disabled={busy} onChange={(event) => setImportArtistName(event.target.value)} /></Field>
              ) : (
                <Field label="已有艺人">
                  <Select value={artistId} disabled={busy} onValueChange={setArtistId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{artists.map((artist) => <SelectItem key={artist.id} value={artist.id}>{artist.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
              <div className="flex items-end">
                <Button onClick={importCandidates} disabled={busy || selectedIds.size === 0 || !allResultsVerified}>
                  {activeOperation === "import" || activeOperation === "navigating" ? "正在导入…" : `导入 ${selectedIds.size}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SharedSettings({
  artistName,
  setArtistName,
  country,
  setCountry,
  target,
  setTarget,
  excludeReissues,
  setExcludeReissues,
  includeCollaborations,
  setIncludeCollaborations,
  includeLiveRemixBest,
  setIncludeLiveRemixBest,
}: {
  artistName: string;
  setArtistName: (value: string) => void;
  country: string;
  setCountry: (value: string) => void;
  target: CollectionScopeTarget;
  setTarget: (value: CollectionScopeTarget) => void;
  excludeReissues: boolean;
  setExcludeReissues: (value: boolean) => void;
  includeCollaborations: boolean;
  setIncludeCollaborations: (value: boolean) => void;
  includeLiveRemixBest: boolean;
  setIncludeLiveRemixBest: (value: boolean) => void;
}) {
  return (
    <>
      <Field label="艺人名"><Input value={artistName} onChange={(event) => setArtistName(event.target.value)} /></Field>
      <Field label="国家 / 地区"><Input value={country} onChange={(event) => setCountry(event.target.value)} /></Field>
      <Field label="收藏口径">
        <Select value={target} onValueChange={(value) => setTarget(value as CollectionScopeTarget)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ORIGINAL_CD">老原版 CD</SelectItem>
            <SelectItem value="ALL_CD">所有 CD</SelectItem>
            <SelectItem value="ALL_PHYSICAL">全实体</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <CheckField label="排除再版" checked={excludeReissues} onChange={setExcludeReissues} />
      <CheckField label="包含合作名义" checked={includeCollaborations} onChange={setIncludeCollaborations} />
      <CheckField label="包含 Live / Remix / Best" checked={includeLiveRemixBest} onChange={setIncludeLiveRemixBest} />
    </>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-10 items-center gap-3 border px-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Capability({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border bg-white p-3 text-sm">
      <span>{label}</span>
      <Badge variant={ok ? "secondary" : "destructive"}>{ok ? "available" : "unavailable"}</Badge>
    </div>
  );
}

function ReleaseCandidateTable({
  releases,
  selectedIds,
  expandedIds,
  disabled,
  toggleSelected,
  toggleExpanded,
}: {
  releases: ReleaseResearchCandidate[];
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  disabled: boolean;
  toggleSelected: (id: string) => void;
  toggleExpanded: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto border bg-white" aria-busy={disabled}>
      <fieldset disabled={disabled} className="contents">
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead>选择</TableHead>
            <TableHead>封面</TableHead>
            <TableHead>核验</TableHead>
            <TableHead>分类</TableHead>
            <TableHead className="min-w-56">标题</TableHead>
            <TableHead>发行日</TableHead>
            <TableHead>格式</TableHead>
            <TableHead>品番</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>警告</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {releases.map((release) => {
            const expanded = expandedIds.has(release.id);
            return (
              <Fragment key={release.id}>
                <TableRow>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(release.id)}
                      onChange={() => toggleSelected(release.id)}
                      aria-label={`选择候选：${release.title}，${release.originalReleaseDate ?? release.releaseDate ?? "日期未知"}`}
                    />
                  </TableCell>
                  <TableCell>
                    {release.coverImageUrl ? (
                      <a
                        href={release.coverImageSourceUrl ?? release.coverImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`查看 ${release.title} 的封面来源`}
                        className="block size-14 overflow-hidden border bg-stone-100"
                      >
                        <Image
                          src={release.coverImageUrl}
                          alt={`${release.title} 封面`}
                          width={56}
                          height={56}
                          unoptimized
                          className="size-full object-cover"
                        />
                      </a>
                    ) : <span className="text-xs text-destructive">已拦截</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={release.verification?.status === "VERIFIED" ? "secondary" : "destructive"}>
                      {release.verification?.status === "VERIFIED" ? "已核验" : "未核验"}
                    </Badge>
                  </TableCell>
                  <TableCell>{release.category}</TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleExpanded(release.id)} className="flex items-center gap-2 text-left font-medium hover:underline">
                      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      {release.title}
                    </button>
                  </TableCell>
                  <TableCell>{release.originalReleaseDate ?? release.releaseDate ?? "-"}</TableCell>
                  <TableCell>{release.format ?? "-"}</TableCell>
                  <TableCell>{release.catalogNumber ?? "-"}</TableCell>
                  <TableCell>{release.sources.length}</TableCell>
                  <TableCell>{release.warnings.length}</TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow>
                    <TableCell colSpan={10} className="bg-stone-50">
                      <div className="grid gap-3 text-sm">
                        {release.verification ? (
                          <div className="grid gap-1 border bg-white p-3">
                            <p className="font-medium">AI 证据裁决：{release.verification.aiReason}</p>
                            <p className="text-muted-foreground">一致字段：{release.verification.matchedFields.join("、")}</p>
                            <p className="text-muted-foreground">核验时间：{new Date(release.verification.checkedAt).toLocaleString("zh-CN")}</p>
                          </div>
                        ) : null}
                        <div className="grid gap-2">
                          {release.sources.length === 0 ? (
                            <p className="text-muted-foreground">没有来源 URL。</p>
                          ) : (
                            release.sources.map((source) => (
                              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                                <ExternalLink className="size-4" />
                                {source.title}
                              </a>
                            ))
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
        </Table>
      </fieldset>
    </div>
  );
}
