"use client";

import { Fragment, useMemo, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bot, ChevronDown, ChevronRight, ExternalLink, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AiSearchTaskView,
  CollectionScopeTarget,
  ReleaseResearchCandidate,
  ResearchConfidence,
} from "@/lib/ai/release-research-types";

type ArtistOption = {
  id: string;
  name: string;
};

const categories = ["ALL", "ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "BOX", "EP", "OTHER"];
const confidences = ["ALL", "HIGH", "MEDIUM", "LOW"];

export function AiSearchClient({ artists }: { artists: ArtistOption[] }) {
  const router = useRouter();
  const [artistName, setArtistName] = useState("中山美穂");
  const [country, setCountry] = useState("Japan");
  const [target, setTarget] = useState<CollectionScopeTarget>("ORIGINAL_CD");
  const [excludeReissues, setExcludeReissues] = useState(true);
  const [includeCollaborations, setIncludeCollaborations] = useState(true);
  const [includeLiveRemixBest, setIncludeLiveRemixBest] = useState(true);
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
  const [importArtistName, setImportArtistName] = useState("中山美穂");

  const visibleReleases = useMemo(
    () => {
      const releases = task?.parsedResult?.releases ?? [];
      return (
      releases.filter((release) => {
        const categoryOk = categoryFilter === "ALL" || release.category === categoryFilter;
        const confidenceOk = confidenceFilter === "ALL" || release.confidence === confidenceFilter;
        return categoryOk && confidenceOk;
      })
      );
    },
    [categoryFilter, confidenceFilter, task?.parsedResult?.releases],
  );

  async function startSearch() {
    setLoading(true);
    setMessage(null);
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

    const response = await fetch("/api/ai-search/release-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistName,
        country,
        target,
        excludeReissues,
        includeCollaborations,
        includeLiveRemixBest,
      }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setTask(null);
      setMessage(payload.error ?? "搜索失败");
      return;
    }

    setTask(payload);
    const defaultSelected = new Set<string>();
    const defaultExcluded = new Set<string>();
    const defaultPending = new Set<string>();

    for (const release of payload.parsedResult?.releases ?? []) {
      defaultSelected.add(release.id);
      if (release.isExcludedByDefault) defaultExcluded.add(release.id);
      if (release.confidence === "LOW" || release.warnings.some((warning: string) => warning.includes("PENDING_REVIEW"))) {
        defaultPending.add(release.id);
      }
    }

    setSelectedIds(defaultSelected);
    setExcludedIds(defaultExcluded);
    setPendingIds(defaultPending);
    setImportArtistName(payload.parsedResult?.artist?.name ?? artistName);
  }

  async function importCandidates() {
    if (!task || task.id === "pending") return;

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
        excludedCandidateIds: [...excludedIds],
        pendingReviewCandidateIds: [...pendingIds],
      }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(payload.error ?? "导入候选失败");
      return;
    }

    router.push(`/artists/${payload.artistId}`);
  }

  function toggle(setter: (value: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function bulkMarkPending() {
    setPendingIds(new Set([...pendingIds, ...selectedIds]));
  }

  function bulkExclude() {
    setExcludedIds(new Set([...excludedIds, ...selectedIds]));
  }

  return (
    <div className="grid gap-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">AI Research</p>
        <h1 className="mt-2 text-3xl font-semibold">GPT-5.5 发行资料搜索</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          使用 Responses API + web_search 检索真实实体 CD 发行资料。候选不会直接入库，必须预览、勾选后导入。
        </p>
      </div>

      {message ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>提示</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="size-5" />
            搜索条件
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-3">
          <Field label="艺人名">
            <Input value={artistName} onChange={(event) => setArtistName(event.target.value)} />
          </Field>
          <Field label="国家/地区">
            <Input value={country} onChange={(event) => setCountry(event.target.value)} />
          </Field>
          <Field label="收藏口径">
            <Select value={target} onValueChange={(value) => setTarget(value as CollectionScopeTarget)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
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
          <div className="lg:col-span-3">
            <Button onClick={startSearch} disabled={loading || !artistName.trim()} className="gap-2">
              <Search className="size-4" />
              搜索发行资料
            </Button>
          </div>
        </CardContent>
      </Card>

      {task ? (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3 border bg-white p-4">
            <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{task.status}</Badge>
            <span className="text-sm text-muted-foreground">model: {task.model || "pending"}</span>
            {loading ? <span className="text-sm text-muted-foreground">搜索中...</span> : null}
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
          <div className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
            <div className="flex flex-wrap gap-3">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {confidences.map((confidence) => (
                    <SelectItem key={confidence} value={confidence}>
                      {confidence}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={bulkExclude}>批量排除</Button>
              <Button variant="outline" onClick={bulkMarkPending}>批量待核对</Button>
            </div>
          </div>

          <ReleaseCandidateTable
            releases={visibleReleases}
            selectedIds={selectedIds}
            excludedIds={excludedIds}
            pendingIds={pendingIds}
            expandedIds={expandedIds}
            toggleSelected={(id) => toggle(setSelectedIds, selectedIds, id)}
            toggleExcluded={(id) => toggle(setExcludedIds, excludedIds, id)}
            togglePending={(id) => toggle(setPendingIds, pendingIds, id)}
            toggleExpanded={(id) => toggle(setExpandedIds, expandedIds, id)}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">导入候选</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <Field label="导入目标">
                <Select value={artistMode} onValueChange={(value) => setArtistMode(value as "create" | "existing")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">新建 Artist</SelectItem>
                    <SelectItem value="existing">已有 Artist</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {artistMode === "create" ? (
                <Field label="Artist 名称">
                  <Input value={importArtistName} onChange={(event) => setImportArtistName(event.target.value)} />
                </Field>
              ) : (
                <Field label="已有 Artist">
                  <Select value={artistId} onValueChange={setArtistId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artists.map((artist) => (
                        <SelectItem key={artist.id} value={artist.id}>
                          {artist.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <div className="flex items-end">
                <Button onClick={importCandidates} disabled={loading || selectedIds.size === 0}>
                  导入 {selectedIds.size} 条
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

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-10 items-center gap-3 border px-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
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
}) {
  return (
    <div className="overflow-x-auto border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">选</TableHead>
            <TableHead>置信度</TableHead>
            <TableHead>分类</TableHead>
            <TableHead className="min-w-56">标题</TableHead>
            <TableHead className="min-w-40">艺人名义</TableHead>
            <TableHead>发行日</TableHead>
            <TableHead>格式</TableHead>
            <TableHead>品番</TableHead>
            <TableHead>厂牌</TableHead>
            <TableHead>再版</TableHead>
            <TableHead>封面图</TableHead>
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
                    <input type="checkbox" checked={selectedIds.has(release.id)} onChange={() => toggleSelected(release.id)} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={confidenceVariant(release.confidence)}>{release.confidence}</Badge>
                  </TableCell>
                  <TableCell>{release.category}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(release.id)}
                      className="flex items-center gap-2 text-left font-medium hover:underline"
                    >
                      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      {release.title}
                    </button>
                  </TableCell>
                  <TableCell>{release.artistCredit}</TableCell>
                  <TableCell>{release.originalReleaseDate ?? release.releaseDate ?? "-"}</TableCell>
                  <TableCell>{release.format ?? "-"}</TableCell>
                  <TableCell>{release.catalogNumber ?? "-"}</TableCell>
                  <TableCell>{release.label ?? "-"}</TableCell>
                  <TableCell>{release.isReissue ? "是" : "否"}</TableCell>
                  <TableCell>{release.coverImageUrl ? "已填写" : "-"}</TableCell>
                  <TableCell>{release.sources.length}</TableCell>
                  <TableCell>{release.warnings.length}</TableCell>
                </TableRow>
                {expanded ? (
                <TableRow>
                    <TableCell colSpan={13} className="bg-stone-50">
                      <div className="grid gap-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={excludedIds.has(release.id)} onChange={() => toggleExcluded(release.id)} />
                            是否纳入：否
                          </label>
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={pendingIds.has(release.id)} onChange={() => togglePending(release.id)} />
                            待核对
                          </label>
                        </div>
                        {release.warnings.length ? (
                          <div>
                            <p className="font-medium">Warnings</p>
                            <ul className="mt-1 list-inside list-disc text-muted-foreground">
                              {release.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <div>
                          <p className="font-medium">Sources</p>
                          <div className="mt-2 grid gap-2">
                            {release.sources.length === 0 ? (
                              <p className="text-muted-foreground">暂无来源。</p>
                            ) : (
                              release.sources.map((source) => (
                                <a
                                  key={source.url}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                                >
                                  <ExternalLink className="size-4" />
                                  {source.title}
                                </a>
                              ))
                            )}
                          </div>
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

function confidenceVariant(confidence: ResearchConfidence) {
  if (confidence === "HIGH") return "secondary";
  if (confidence === "MEDIUM") return "outline";
  return "destructive";
}
