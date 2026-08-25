import test from "node:test";
import assert from "node:assert/strict";

import { formatArenaImport } from "../src/deckExport.js";

test("formatArenaImport formats mainboard-only as a Deck block", () => {
  const mainboard = [
    { arenaId: 1, name: "Lightning Bolt", count: 4 },
    { arenaId: 0, name: "Mountain", count: 20 },
  ];
  assert.equal(formatArenaImport(mainboard, []), "Deck\n4 Lightning Bolt\n20 Mountain");
});

test("formatArenaImport adds a blank-line-separated Sideboard section when present", () => {
  const mainboard = [{ arenaId: 1, name: "Lightning Bolt", count: 4 }];
  const sideboard = [{ arenaId: 2, name: "Negate", count: 2 }];
  assert.equal(formatArenaImport(mainboard, sideboard), "Deck\n4 Lightning Bolt\n\nSideboard\n2 Negate");
});

test("formatArenaImport omits the Sideboard section entirely when empty or absent", () => {
  const mainboard = [{ arenaId: 1, name: "Lightning Bolt", count: 4 }];
  assert.equal(formatArenaImport(mainboard, []), "Deck\n4 Lightning Bolt");
  assert.equal(formatArenaImport(mainboard, undefined), "Deck\n4 Lightning Bolt");
});

test("formatArenaImport handles an empty mainboard", () => {
  assert.equal(formatArenaImport([], []), "Deck");
});
