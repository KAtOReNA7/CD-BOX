export function intersectCandidateIds(
  candidateIds: Iterable<string>,
  selectedIds: ReadonlySet<string>,
): string[] {
  return [...new Set(candidateIds)].filter((candidateId) => selectedIds.has(candidateId));
}

export function addCandidateIds(
  currentIds: ReadonlySet<string>,
  candidateIds: Iterable<string>,
): Set<string> {
  return new Set([...currentIds, ...candidateIds]);
}

export function removeCandidateIds(
  currentIds: ReadonlySet<string>,
  candidateIds: Iterable<string>,
): Set<string> {
  const removedIds = new Set(candidateIds);
  return new Set([...currentIds].filter((candidateId) => !removedIds.has(candidateId)));
}

export function toggleCandidateId(currentIds: ReadonlySet<string>, candidateId: string): Set<string> {
  const nextIds = new Set(currentIds);
  if (nextIds.has(candidateId)) nextIds.delete(candidateId);
  else nextIds.add(candidateId);
  return nextIds;
}
