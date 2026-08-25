import test from "node:test";
import assert from "node:assert/strict";

import { clampCopyLimits, checkDeckLegality, checkManaBase } from "../src/deckRules.js";

test("clampCopyLimits trims a mainboard entry over the format's copy limit", () => {
  const mainboard = [{ arenaId: 1, name: "Lightning Bolt", count: 6 }];
  const { mainboard: result, fixes } = clampCopyLimits(mainboard, [], "standard");
  assert.equal(result[0].count, 4);
  assert.equal(fixes.length, 1);
  assert.match(fixes[0], /Lightning Bolt.*6 to 4/);
});

test("clampCopyLimits never trims basic lands (arenaId 0) regardless of count", () => {
  const mainboard = [{ arenaId: 0, name: "Mountain", count: 20 }];
  const { mainboard: result, fixes } = clampCopyLimits(mainboard, [], "standard");
  assert.equal(result[0].count, 20);
  assert.equal(fixes.length, 0);
});

test("clampCopyLimits enforces the limit across mainboard + sideboard combined", () => {
  const mainboard = [{ arenaId: 1, name: "Lightning Bolt", count: 4 }];
  const sideboard = [{ arenaId: 1, name: "Lightning Bolt", count: 2 }];
  const { mainboard: mb, sideboard: sb, fixes } = clampCopyLimits(mainboard, sideboard, "standard");
  assert.equal(mb[0].count, 4);
  assert.equal(sb.length, 0, "sideboard copies should be fully trimmed since mainboard already used the limit");
  assert.ok(fixes.some((f) => f.includes("Lightning Bolt")));
});

test("clampCopyLimits treats different printings (arenaIds) of the same card name as one card", () => {
  const mainboard = [
    { arenaId: 100, name: "Lightning Bolt", count: 3 },
    { arenaId: 200, name: "Lightning Bolt", count: 3 },
  ];
  const { mainboard: result, fixes } = clampCopyLimits(mainboard, [], "standard");
  const total = result.reduce((sum, e) => sum + e.count, 0);
  assert.equal(total, 4, "combined copies of the same name across printings must respect the 4-copy limit");
  assert.equal(fixes.length, 1);
});

test("clampCopyLimits enforces singleton (max 1) for brawl", () => {
  const mainboard = [{ arenaId: 1, name: "Llanowar Elves", count: 3 }];
  const { mainboard: result, fixes } = clampCopyLimits(mainboard, [], "brawl");
  assert.equal(result[0].count, 1);
  assert.match(fixes[0], /3 to 1 copy /);
});

test("clampCopyLimits leaves a legal deck completely unchanged", () => {
  const mainboard = [{ arenaId: 1, name: "Lightning Bolt", count: 4 }];
  const { mainboard: result, fixes } = clampCopyLimits(mainboard, [], "standard");
  assert.deepEqual(result, mainboard);
  assert.equal(fixes.length, 0);
});

test("checkDeckLegality reports a mainboard count mismatch", () => {
  const deck = { mainboard: [{ arenaId: 1, name: "Mountain", count: 58 }], sideboard: [] };
  const { valid, issues } = checkDeckLegality(deck, "standard");
  assert.equal(valid, false);
  assert.match(issues[0], /58 cards.*exactly 60/);
});

test("checkDeckLegality passes a correctly-sized deck", () => {
  const deck = { mainboard: [{ arenaId: 1, name: "Mountain", count: 60 }], sideboard: [] };
  const { valid, issues } = checkDeckLegality(deck, "standard");
  assert.equal(valid, true);
  assert.deepEqual(issues, []);
});

test("checkDeckLegality flags an oversized sideboard", () => {
  const deck = {
    mainboard: [{ arenaId: 1, name: "Mountain", count: 60 }],
    sideboard: Array.from({ length: 16 }, (_, i) => ({ arenaId: i + 2, name: `Card ${i}`, count: 1 })),
  };
  const { valid, issues } = checkDeckLegality(deck, "standard");
  assert.equal(valid, false);
  assert.match(issues[0], /16 cards.*max is 15/);
});

test("checkDeckLegality uses the 100-card requirement for brawl", () => {
  const deck = { mainboard: [{ arenaId: 1, name: "Mountain", count: 99 }], sideboard: [] };
  const { valid, issues } = checkDeckLegality(deck, "brawl");
  assert.equal(valid, false);
  assert.match(issues[0], /exactly 100/);
});

const cardDb = new Map([
  [1, { name: "Lightning Bolt", typeLine: "Instant" }],
  [2, { name: "Field of Ruin", typeLine: "Land" }],
]);

test("checkManaBase warns when a deck has far too few lands (the actual bug reported)", () => {
  const mainboard = [
    { arenaId: 0, name: "Mountain", count: 4 },
    { arenaId: 1, name: "Lightning Bolt", count: 56 },
  ];
  const issues = checkManaBase(mainboard, cardDb);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Only 4 lands/);
});

test("checkManaBase counts both basic lands (arenaId 0) and nonbasic lands found via cardDb", () => {
  const mainboard = [
    { arenaId: 0, name: "Mountain", count: 10 },
    { arenaId: 2, name: "Field of Ruin", count: 4 },
    { arenaId: 1, name: "Lightning Bolt", count: 46 },
  ];
  const issues = checkManaBase(mainboard, cardDb);
  assert.deepEqual(issues, [], "10 basics + 4 nonbasic lands = 14, meeting the minimum");
});

test("checkManaBase passes a normal, healthy land count without warning", () => {
  const mainboard = [
    { arenaId: 0, name: "Mountain", count: 17 },
    { arenaId: 1, name: "Lightning Bolt", count: 43 },
  ];
  assert.deepEqual(checkManaBase(mainboard, cardDb), []);
});
