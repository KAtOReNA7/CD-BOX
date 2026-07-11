const CJK_NAME_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function localizedArtistNameUpdate(
  currentName: string,
  currentSortName: string | null,
  candidateName: string | null | undefined,
) {
  const candidate = candidateName?.normalize("NFKC").trim() ?? "";
  if (!candidate || !CJK_NAME_PATTERN.test(candidate) || CJK_NAME_PATTERN.test(currentName)) {
    return null;
  }

  return {
    name: candidate,
    sortName: currentSortName?.trim() || currentName.trim(),
  };
}
