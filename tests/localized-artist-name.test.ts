import assert from "node:assert/strict";
import test from "node:test";
import { localizedArtistNameUpdate } from "@/lib/artists/localized-artist-name";

test("promotes a controlled CJK artist name and preserves the romanized name for sorting", () => {
  assert.deepEqual(localizedArtistNameUpdate("Miho Nakayama", null, " 中山美穂 "), {
    name: "中山美穂",
    sortName: "Miho Nakayama",
  });
});

test("preserves an existing sort name while promoting the display name", () => {
  assert.deepEqual(localizedArtistNameUpdate("Miho Nakayama", "Nakayama, Miho", "中山美穂"), {
    name: "中山美穂",
    sortName: "Nakayama, Miho",
  });
});

test("does not replace an existing CJK name or promote another romanized name", () => {
  assert.equal(localizedArtistNameUpdate("中山美穂", "Miho Nakayama", "中山美穗"), null);
  assert.equal(localizedArtistNameUpdate("Miho Nakayama", null, "Nakayama Miho"), null);
  assert.equal(localizedArtistNameUpdate("Miho Nakayama", null, "  "), null);
});
