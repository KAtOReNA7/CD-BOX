import assert from "node:assert/strict";
import { parseArtistCreateInput } from "@/lib/artists/artist-input";

const valid = parseArtistCreateInput({
  name: "  宇多田ヒカル  ",
  sortName: "  Utada Hikaru ",
  country: "  Japan ",
  description: "  Original releases only. ",
});

assert.equal(valid.success, true);
if (valid.success) {
  assert.deepEqual(valid.data, {
    name: "宇多田ヒカル",
    sortName: "Utada Hikaru",
    country: "Japan",
    description: "Original releases only.",
  });
}

const optionalEmpty = parseArtistCreateInput({
  name: "Artist",
  sortName: " ",
  country: null,
  description: undefined,
});
assert.equal(optionalEmpty.success, true);
if (optionalEmpty.success) {
  assert.deepEqual(optionalEmpty.data, { name: "Artist", sortName: undefined, country: undefined, description: undefined });
}

assert.equal(parseArtistCreateInput({ name: "   " }).success, false);
assert.equal(parseArtistCreateInput({ name: "x".repeat(161) }).success, false);
assert.equal(parseArtistCreateInput({ name: "Artist", country: "x".repeat(81) }).success, false);

console.log("Artist input validation test passed.");
