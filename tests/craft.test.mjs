import test from "node:test";
import assert from "node:assert/strict";

import { computeCraftCost } from "../src/craft.js";

const cardDb = new Map([
  [100, { name: "Owned Common", typeLine: "Creature", rarity: "common" }],
  [200, { name: "Partially Owned Rare", typeLine: "Instant", rarity: "rare" }],
  [300, { name: "Unowned Mythic", typeLine: "Sorcery", rarity: "mythic" }],
  [400, { name: "Plains", typeLine: "Basic Land", rarity: "common" }],
]);

test("computeCraftCost: fully owned cards need nothing", () => {
  const collection = { "owned common": 4 };
  const { missing, wildcardsNeeded } = computeCraftCost([{ arenaId: 100, count: 4 }], collection, cardDb);
  assert.deepEqual(missing, []);
  assert.deepEqual(wildcardsNeeded, { common: 0, uncommon: 0, rare: 0, mythic: 0 });
});

test("computeCraftCost: partially owned and fully unowned cards compute correct per-rarity wildcard totals", () => {
  const collection = { "owned common": 4, "partially owned rare": 1 };
  const decklist = [
    { arenaId: 100, count: 4 },
    { arenaId: 200, count: 3 },
    { arenaId: 300, count: 2 },
    { arenaId: 400, count: 17 },
  ];

  const { missing, wildcardsNeeded } = computeCraftCost(decklist, collection, cardDb);

  assert.deepEqual(wildcardsNeeded, { common: 0, uncommon: 0, rare: 2, mythic: 2 });
  assert.equal(missing.length, 2);

  const rareMissing = missing.find((m) => m.arenaId === 200);
  assert.equal(rareMissing.owned, 1);
  assert.equal(rareMissing.required, 3);
  assert.equal(rareMissing.need, 2);

  const mythicMissing = missing.find((m) => m.arenaId === 300);
  assert.equal(mythicMissing.owned, 0);
  assert.equal(mythicMissing.need, 2);
});

test("computeCraftCost: basic lands never appear in missing/wildcards even fully unowned", () => {
  const { missing, wildcardsNeeded } = computeCraftCost([{ arenaId: 400, count: 17 }], {}, cardDb);
  assert.deepEqual(missing, []);
  assert.deepEqual(wildcardsNeeded, { common: 0, uncommon: 0, rare: 0, mythic: 0 });
});

test("computeCraftCost: skips decklist entries with an arenaId not present in the card db", () => {
  const { missing } = computeCraftCost([{ arenaId: 99999, count: 4 }], {}, cardDb);
  assert.deepEqual(missing, []);
});
