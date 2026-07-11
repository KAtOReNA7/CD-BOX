"use client";

import { Fragment, useMemo, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, FileText, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { summarizeResearchQuality } from "@/lib/ai/release-research-quality";
import {
  addCandidateIds,
  intersectCandidateIds,
  removeCandidateIds,
  toggleCandidateId,
} from "@/lib/ai/release-research-selection";
import type {
  AiSearchTaskView,
  CollectionScopeTarget,
  ReleaseResearchCandidate,
  ReleaseResearchCandidateEdit,
  ResearchConfidence,
} from "@/lib/ai/release-research-types";
import type { AiProviderCapabilitySummary as ProviderSummary } from "@/lib/ai/provider-capabilities";

type ArtistOption = { id: string; name: string };

const categories = ["ALL", "ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "BOX", "EP", "OTHER"];
const confidences = ["ALL", "HIGH", "MEDIUM", "LOW"];
const taskPollIntervalMs = 1_500;
const maxTaskPolls = 220;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSafeByDefault(release: ReleaseResearchCandidate) {
  return release.confidence === "HIGH" && !release.isExcludedByDefault && release.sources.length > 0 && Boolean(release.catalogNumber);
}

function isPendingReview(release: ReleaseResearchCandidate) {
  return release.confidence !== "HIGH" || !release.catalogNumber || release.sources.length === 0 || release.warnings.some((warning) => warning.includes("PENDING_REVIEW"));
}

function toCandidateEdit(candidate: ReleaseResearchCandidate): ReleaseResearchCandidateEdit {
  return {
    title: candidate.title,
    category: candidate.category,
    artistCredit: candidate.artistCredit,
    originalReleaseDate: candidate.originalReleaseDate,
    format: candidate.format,
    catalogNumber: candidate.catalogNumber,
    label: candidate.label,
    coverImageUrl: candidate.coverImageUrl,
    isReissue: candidate.isReissue,
    isRemaster: candidate.isRemaster,
    notes: candidate.notes,
  };
}

export function AiSearchClient({ artists, capabilities }: { artists: ArtistOption[]; capabilities: ProviderSummary }) {
  const router = useRouter();
  const [artistName, setArtistName] = useState("Miho Nakayama");
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
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [confidenceFilter, setConfidenceFilter] = useState("ALL");
  const [artistMode, setArtistMode] = useState<"create" | "existing">("create");
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [importArtistName, setImportArtistName] = useState("Miho Nakayama");
  const [candidateEdits, setCandidateEdits] = useState<Record<string, ReleaseResearchCandidate>>({});

  const releases = useMemo(
    () => (task?.parsedResult?.releases ?? []).map((release) => candidateEdits[release.id] ?? release),
    [candidateEdits, task?.parsedResult?.releases],
  );
  const summary = useMemo(() => summarizeResearchQuality(releases), [releases]);
  const visibleReleases = useMemo(
    () =>
      releases.filter((release) => {
        const categoryOk = categoryFilter === "ALL" || release.category === categoryFilter;
        const confidenceOk = confidenceFilter === "ALL" || release.confidence === confidenceFilter;
        return categoryOk && confidenceOk;
      }),
    [categoryFilter, confidenceFilter, releases],
  );
  const visibleCandidateIds = visibleReleases.map((release) => release.id);
  const visibleSelectedCount = visibleCandidateIds.filter((candidateId) => selectedIds.has(candidateId)).length;

  function setPendingTask() {
    setTask({
      id: "pending",
      status: "pending",
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
    setCandidateEdits({});
    const nextSelected = new Set<string>();
    const nextExcluded = new Set<string>();
    const nextPending = new Set<string>();

    for (const release of payload.parsedResult?.releases ?? []) {
      if (isSafeByDefault(release)) nextSelected.add(release.id);
      if (release.isExcludedByDefault) nextExcluded.add(release.id);
      if (isPendingReview(release)) nextPending.add(release.id);
    }

    setSelectedIds(nextSelected);
    setExcludedIds(nextExcluded);
    setPendingIds(nextPending);
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
    if (!capabilities.webSearchSupported) return;
    setLoading(true);
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
      setLoading(false);
    }
  }

  async function structureNotes() {
    setLoading(true);
    setMessage(null);
    setPendingTask();

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
    setLoading(false);

    if (!response.ok) {
      setTask(null);
      setMessage(payload.error ?? "资料整理失败。");
      return;
    }
    applyTaskPayload(payload);
  }

  async function importCandidates() {
    if (!task || task.id === "pending") return;
    const selected = releases.filter((release) => selectedIds.has(release.id));
    const skipped = releases.length - selected.length;
    const pending = selected.filter((release) => pendingIds.has(release.id) || isPendingReview(release)).length;
    const ok = window.confirm(`将导入 ${selected.length} 条，跳过 ${skipped} 条，其中 ${pending} 条待核对。是否继续？`);
    if (!ok) return;

    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/ai-search/tasks/${task.id}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistMode,
        artistId,
        artistName: importArtistName,
        selectedCandidateIds: [...selectedIds],
        excludedCandidateIds: intersectCandidateIds(excludedIds, selectedIds),
        pendingReviewCandidateIds: intersectCandidateIds(pendingIds, selectedIds),
        candidateEdits: Object.fromEntries(
          Object.entries(candidateEdits)
            .filter(([candidateId]) => selectedIds.has(candidateId))
            .map(([candidateId, candidate]) => [candidateId, toCandidateEdit(candidate)]),
        ),
      }),
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(payload.error ?? "候选导入失败。");
      return;
    }
    setMessage(`创建 ${payload.imported} 条，跳过重复 ${payload.skippedDuplicates} 条，待核对 ${payload.pendingReview} 条，排除 ${payload.excluded} 条。`);
    router.push(`/artists/${payload.artistId}`);
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

      {!capabilities.webSearchSupported ? (
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
              联网搜索不会降级为普通聊天模型执行。当前请使用粘贴资料整理。
            </p>
          </div>
            </details>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue={capabilities.webSearchSupported ? "online-search" : "pasted-structure"}>
        <TabsList>
          {capabilities.webSearchSupported ? <TabsTrigger value="online-search">联网搜索</TabsTrigger> : null}
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
                <Button onClick={structureNotes} disabled={loading || !artistName.trim() || !sourceText.trim()} className="gap-2">
                  <FileText className="size-4" />
                  整理为候选清单
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {capabilities.webSearchSupported ? (
          <TabsContent value="online-search" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="size-5" />
                  联网搜索
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-3">
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
                  <Button onClick={startSearch} disabled={loading || !artistName.trim()} className="gap-2">
                    <Search className="size-4" />
                    搜索发行资料
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      {task ? (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3 border bg-white p-4">
            <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{task.status}</Badge>
            <span className="text-sm text-muted-foreground">model: {task.model || "pending"}</span>
            {loading ? <span className="text-sm text-muted-foreground">处理中...</span> : null}
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
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Metric label="候选" value={summary.total} />
            <Metric label="可安全导入" value={summary.safeToImport} />
            <Metric label="待核对" value={summary.pendingReview} />
            <Metric label="缺品番" value={summary.missingCatalog} />
            <Metric label="缺来源" value={summary.missingSources} />
            <Metric label="默认排除" value={summary.defaultExcluded} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
            <div className="flex flex-wrap gap-3">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44" aria-label="分类筛选"><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger className="w-36" aria-label="置信度筛选"><SelectValue /></SelectTrigger>
                <SelectContent>{confidences.map((confidence) => <SelectItem key={confidence} value={confidence}>{confidence}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-sm text-muted-foreground" role="status" aria-live="polite">
                当前已选 {visibleSelectedCount}/{visibleCandidateIds.length}，总计 {selectedIds.size}
              </span>
              <Button
                variant="outline"
                onClick={() => setSelectedIds((current) => addCandidateIds(current, visibleCandidateIds))}
                disabled={visibleCandidateIds.length === 0 || visibleSelectedCount === visibleCandidateIds.length}
              >
                全选当前结果
              </Button>
              <Button
                variant="outline"
                onClick={() => setSelectedIds((current) => removeCandidateIds(current, visibleCandidateIds))}
                disabled={visibleSelectedCount === 0}
              >
                取消全选当前结果
              </Button>
              <Button variant="outline" onClick={() => setExcludedIds((current) => addCandidateIds(current, selectedIds))}>全部已选：批量排除</Button>
              <Button variant="outline" onClick={() => setPendingIds((current) => addCandidateIds(current, selectedIds))}>全部已选：标为待核对</Button>
            </div>
          </div>

          <ReleaseCandidateTable
            releases={visibleReleases}
            selectedIds={selectedIds}
            excludedIds={excludedIds}
            pendingIds={pendingIds}
            expandedIds={expandedIds}
            toggleSelected={(id) => toggle(setSelectedIds, id)}
            toggleExcluded={(id) => toggle(setExcludedIds, id)}
            togglePending={(id) => toggle(setPendingIds, id)}
            toggleExpanded={(id) => toggle(setExpandedIds, id)}
            updateCandidate={(candidate) =>
              setCandidateEdits((current) => ({ ...current, [candidate.id]: candidate }))
            }
          />

          <Card>
            <CardHeader><CardTitle className="text-lg">导入候选</CardTitle></CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <Field label="导入目标">
                <Select value={artistMode} onValueChange={(value) => setArtistMode(value as "create" | "existing")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">新建艺人</SelectItem>
                    <SelectItem value="existing">已有艺人</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {artistMode === "create" ? (
                <Field label="艺人名"><Input value={importArtistName} onChange={(event) => setImportArtistName(event.target.value)} /></Field>
              ) : (
                <Field label="已有艺人">
                  <Select value={artistId} onValueChange={setArtistId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{artists.map((artist) => <SelectItem key={artist.id} value={artist.id}>{artist.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
              <div className="flex items-end">
                <Button onClick={importCandidates} disabled={loading || selectedIds.size === 0}>导入 {selectedIds.size}</Button>
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
  excludedIds,
  pendingIds,
  expandedIds,
  toggleSelected,
  toggleExcluded,
  togglePending,
  toggleExpanded,
  updateCandidate,
}: {
  releases: ReleaseResearchCandidate[];
  selectedIds: Set<string>;
  excludedIds: Set<string>;
  pendingIds: Set<string>;
  expandedIds: Set<string>;
  toggleSelected: (id: string) => void;
  toggleExcluded: (id: string) => void;
  togglePending: (id: string) => void;
  toggleExpanded: (id: string) => void;
  updateCandidate: (candidate: ReleaseResearchCandidate) => void;
}) {
  return (
    <div className="overflow-x-auto border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>选择</TableHead>
            <TableHead>置信度</TableHead>
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
                  <TableCell><Badge variant={confidenceVariant(release.confidence)}>{release.confidence}</Badge></TableCell>
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
                    <TableCell colSpan={9} className="bg-stone-50">
                      <div className="grid gap-3 text-sm">
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-2"><input type="checkbox" checked={excludedIds.has(release.id)} onChange={() => toggleExcluded(release.id)} aria-label={`排除候选：${release.title}`} />排除</label>
                          <label className="flex items-center gap-2"><input type="checkbox" checked={pendingIds.has(release.id)} onChange={() => togglePending(release.id)} aria-label={`候选标为待核对：${release.title}`} />待核对</label>
                        </div>
                        {release.warnings.length ? <p className="text-muted-foreground">Warnings: {release.warnings.join("; ")}</p> : null}
                        <CandidateEditor candidate={release} onChange={updateCandidate} />
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
    </div>
  );
}

function CandidateEditor({
  candidate,
  onChange,
}: {
  candidate: ReleaseResearchCandidate;
  onChange: (candidate: ReleaseResearchCandidate) => void;
}) {
  function update<K extends keyof ReleaseResearchCandidate>(key: K, value: ReleaseResearchCandidate[K]) {
    onChange({ ...candidate, [key]: value });
  }

  return (
    <div className="grid gap-3 border bg-white p-4 md:grid-cols-2 lg:grid-cols-4">
      <Field label="标题">
        <Input value={candidate.title} onChange={(event) => update("title", event.target.value)} />
      </Field>
      <Field label="分类">
        <Select
          value={candidate.category}
          onValueChange={(value) => update("category", value as ReleaseResearchCandidate["category"])}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.filter((category) => category !== "ALL").map((category) => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="原始发行日">
        <Input
          type="date"
          value={candidate.originalReleaseDate?.slice(0, 10) ?? ""}
          onChange={(event) => update("originalReleaseDate", event.target.value || null)}
        />
      </Field>
      <Field label="格式">
        <Input value={candidate.format ?? ""} onChange={(event) => update("format", event.target.value || null)} />
      </Field>
      <Field label="品番">
        <Input
          value={candidate.catalogNumber ?? ""}
          onChange={(event) => update("catalogNumber", event.target.value || null)}
        />
      </Field>
      <Field label="厂牌">
        <Input value={candidate.label ?? ""} onChange={(event) => update("label", event.target.value || null)} />
      </Field>
      <Field label="封面 URL">
        <Input
          type="url"
          value={candidate.coverImageUrl ?? ""}
          onChange={(event) => update("coverImageUrl", event.target.value || null)}
        />
      </Field>
      <Field label="艺人名义">
        <Input value={candidate.artistCredit} onChange={(event) => update("artistCredit", event.target.value)} />
      </Field>
      <label className="flex h-10 items-center gap-3 border px-3 text-sm">
        <input
          type="checkbox"
          checked={candidate.isReissue === true}
          onChange={(event) => update("isReissue", event.target.checked)}
        />
        再版
      </label>
      <label className="flex h-10 items-center gap-3 border px-3 text-sm">
        <input
          type="checkbox"
          checked={candidate.isRemaster === true}
          onChange={(event) => update("isRemaster", event.target.checked)}
        />
        重制
      </label>
      <div className="grid gap-2 md:col-span-2 lg:col-span-4">
        <Label>备注</Label>
        <Textarea
          value={candidate.notes ?? ""}
          onChange={(event) => update("notes", event.target.value || null)}
          rows={3}
        />
      </div>
      <p className="text-xs text-muted-foreground md:col-span-2 lg:col-span-4">
        手工修改会在服务器端重新执行置信度、来源和收藏范围质量门控。
      </p>
    </div>
  );
}

function confidenceVariant(confidence: ResearchConfidence) {
  if (confidence === "HIGH") return "secondary";
  if (confidence === "MEDIUM") return "outline";
  return "destructive";
}
