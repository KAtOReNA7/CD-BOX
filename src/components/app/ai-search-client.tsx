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
import { summarizeResearchQuality } from "@/lib/ai/release-research-quality";
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

function isSafeByDefault(release: ReleaseResearchCandidate) {
  return release.confidence === "HIGH" && !release.isExcludedByDefault && release.sources.length > 0 && Boolean(release.catalogNumber);
}

function isPendingReview(release: ReleaseResearchCandidate) {
  return release.confidence !== "HIGH" || !release.catalogNumber || release.sources.length === 0 || release.warnings.some((warning) => warning.includes("PENDING_REVIEW"));
}

export function AiSearchClient({ artists }: { artists: ArtistOption[] }) {
  const router = useRouter();
  const [artistName, setArtistName] = useState("Miho Nakayama");
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
  const [importArtistName, setImportArtistName] = useState("Miho Nakayama");

  const releases = useMemo(() => task?.parsedResult?.releases ?? [], [task?.parsedResult?.releases]);
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
      setMessage(payload.error ?? "Search failed.");
      return;
    }

    setTask(payload);

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

  async function importCandidates() {
    if (!task || task.id === "pending") return;

    const selected = releases.filter((release) => selectedIds.has(release.id));
    const skipped = releases.length - selected.length;
    const pending = selected.filter((release) => pendingIds.has(release.id) || isPendingReview(release)).length;

    const ok = window.confirm(`Import ${selected.length} candidates, skip ${skipped}, with ${pending} pending review rows?`);
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
        excludedCandidateIds: [...excludedIds],
        pendingReviewCandidateIds: [...pendingIds],
      }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Candidate import failed.");
      return;
    }

    setMessage(
      `Created ${payload.imported}, skipped duplicates ${payload.skippedDuplicates}, pending review ${payload.pendingReview}, excluded ${payload.excluded}.`,
    );
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
        <h1 className="mt-2 text-3xl font-semibold">GPT-5.5 Release Research</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Search real physical CD release data with Responses API and web_search. Candidates must be reviewed before import.
        </p>
      </div>

      {message ? (
        <Alert variant={message.startsWith("Created") ? "default" : "destructive"}>
          <AlertCircle className="size-4" />
          <AlertTitle>Result</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="size-5" />
            Search Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-3">
          <Field label="Artist name">
            <Input value={artistName} onChange={(event) => setArtistName(event.target.value)} />
          </Field>
          <Field label="Country / region">
            <Input value={country} onChange={(event) => setCountry(event.target.value)} />
          </Field>
          <Field label="Collection scope">
            <Select value={target} onValueChange={(value) => setTarget(value as CollectionScopeTarget)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ORIGINAL_CD">Original old CD</SelectItem>
                <SelectItem value="ALL_CD">All CD</SelectItem>
                <SelectItem value="ALL_PHYSICAL">All physical</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <CheckField label="Exclude reissues" checked={excludeReissues} onChange={setExcludeReissues} />
          <CheckField label="Include collaborations" checked={includeCollaborations} onChange={setIncludeCollaborations} />
          <CheckField label="Include Live / Remix / Best" checked={includeLiveRemixBest} onChange={setIncludeLiveRemixBest} />
          <div className="lg:col-span-3">
            <Button onClick={startSearch} disabled={loading || !artistName.trim()} className="gap-2">
              <Search className="size-4" />
              Search Releases
            </Button>
          </div>
        </CardContent>
      </Card>

      {task ? (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3 border bg-white p-4">
            <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{task.status}</Badge>
            <span className="text-sm text-muted-foreground">model: {task.model || "pending"}</span>
            {loading ? <span className="text-sm text-muted-foreground">Searching...</span> : null}
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
            <Metric label="Candidates" value={summary.total} />
            <Metric label="Safe import" value={summary.safeToImport} />
            <Metric label="Pending review" value={summary.pendingReview} />
            <Metric label="Missing catalog" value={summary.missingCatalog} />
            <Metric label="Missing source" value={summary.missingSources} />
            <Metric label="Default excluded" value={summary.defaultExcluded} />
          </div>

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
              <Button variant="outline" onClick={bulkExclude}>Bulk exclude</Button>
              <Button variant="outline" onClick={bulkMarkPending}>Bulk pending review</Button>
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
              <CardTitle className="text-lg">Import Candidates</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <Field label="Import target">
                <Select value={artistMode} onValueChange={(value) => setArtistMode(value as "create" | "existing")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">Create Artist</SelectItem>
                    <SelectItem value="existing">Existing Artist</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {artistMode === "create" ? (
                <Field label="Artist name">
                  <Input value={importArtistName} onChange={(event) => setImportArtistName(event.target.value)} />
                </Field>
              ) : (
                <Field label="Existing Artist">
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
                  Import {selectedIds.size}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
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
            <TableHead className="w-10">Select</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="min-w-56">Title</TableHead>
            <TableHead className="min-w-40">Artist credit</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Catalog</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Reissue</TableHead>
            <TableHead>Cover</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead>Warnings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {releases.map((release) => {
            const expanded = expandedIds.has(release.id);
            return (
              <Fragment key={release.id}>
                <TableRow className={release.confidence === "LOW" ? "bg-red-50/60" : undefined}>
                  <TableCell>
                    <input type="checkbox" checked={selectedIds.has(release.id)} onChange={() => toggleSelected(release.id)} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={confidenceVariant(release.confidence)}>{release.confidence}</Badge>
                  </TableCell>
                  <TableCell>
                    <QualityFlags release={release} />
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
                  <TableCell>{release.isReissue ? "Yes" : "No"}</TableCell>
                  <TableCell>{release.coverImageUrl ? "Yes" : "-"}</TableCell>
                  <TableCell>{release.sources.length}</TableCell>
                  <TableCell>{release.warnings.length}</TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow>
                    <TableCell colSpan={14} className="bg-stone-50">
                      <div className="grid gap-3 text-sm">
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={excludedIds.has(release.id)} onChange={() => toggleExcluded(release.id)} />
                            Excluded
                          </label>
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={pendingIds.has(release.id)} onChange={() => togglePending(release.id)} />
                            Pending review
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
                              <p className="text-muted-foreground">No source URL.</p>
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

function QualityFlags({ release }: { release: ReleaseResearchCandidate }) {
  return (
    <div className="flex flex-wrap gap-1">
      {!release.catalogNumber ? <Badge variant="destructive">no catalog</Badge> : null}
      {release.sources.length === 0 ? <Badge variant="destructive">no source</Badge> : null}
      {release.isExcludedByDefault ? <Badge variant="outline">excluded</Badge> : null}
      {release.isReissue ? <Badge variant="outline">reissue</Badge> : null}
      {release.warnings.some((warning) => warning.includes("only wiki source")) ? (
        <Badge variant="outline">wiki only</Badge>
      ) : null}
    </div>
  );
}

function confidenceVariant(confidence: ResearchConfidence) {
  if (confidence === "HIGH") return "secondary";
  if (confidence === "MEDIUM") return "outline";
  return "destructive";
}
