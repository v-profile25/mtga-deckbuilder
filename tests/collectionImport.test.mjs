import test from "node:test";
import assert from "node:assert/strict";

import { parseCollectionText, normalizeCardName, lookupOwnedCount } from "../src/collectionImport.js";

test("parseCollectionText handles bare '<count> <name>' lines", () => {
  const collection = parseCollectionText("4 Lightning Bolt\n2 Counterspell");
  assert.deepEqual(collection, { "lightning bolt": 4, counterspell: 2 });
});

test("parseCollectionText handles Arena's own deck-export format with (SET) number", () => {
  const collection = parseCollectionText("4 Lightning Bolt (LEA) 161\n1 Wrath of God (M10) 213");
  assert.deepEqual(collection, { "lightning bolt": 4, "wrath of god": 1 });
});

test("parseCollectionText handles CSV in either column order", () => {
  const collection = parseCollectionText("Lightning Bolt,4\n1,Wrath of God");
  assert.deepEqual(collection, { "lightning bolt": 4, "wrath of god": 1 });
});

test("parseCollectionText sums duplicate names across separate lines", () => {
  const collection = parseCollectionText("2 Lightning Bolt (LEA) 161\n3 Lightning Bolt (M10) 146");
  assert.deepEqual(collection, { "lightning bolt": 5 });
});

test("parseCollectionText normalizes case and whitespace so names still match", () => {
  const collection = parseCollectionText("2   LIGHTNING BOLT\n1 lightning   bolt");
  assert.deepEqual(collection, { "lightning bolt": 3 });
});

test("parseCollectionText skips blank lines and lines it can't parse (e.g. a CSV header)", () => {
  const collection = parseCollectionText("Name,Quantity\n\n4 Lightning Bolt\nsome random note\n");
  assert.deepEqual(collection, { "lightning bolt": 4 });
});

test("parseCollectionText handles a real semicolon-delimited exporter format (Count;Name;Edition;Collector Number;Rarity)", () => {
  const csv = [
    "Count;Name;Edition;Collector Number;Rarity",
    "1;Settle the Wreckage;xln;34;rare",
    "4;Spell Pierce;xln;81;common",
    "3;Shock;anb;84;common",
  ].join("\n");
  const collection = parseCollectionText(csv);
  assert.deepEqual(collection, {
    "settle the wreckage": 1,
    "spell pierce": 4,
    shock: 3,
  });
});

test("parseCollectionText handles semicolon CSV even for card names containing a literal comma", () => {
  const collection = parseCollectionText("1;Teferi, Hero of Dominaria;dom;207;mythic");
  assert.deepEqual(collection, { "teferi, hero of dominaria": 1 });
});

test("parseCollectionText ignores zero/negative counts", () => {
  const collection = parseCollectionText("0 Lightning Bolt\n4 Counterspell");
  assert.deepEqual(collection, { counterspell: 4 });
});

test("normalizeCardName trims, collapses whitespace, and lowercases", () => {
  assert.equal(normalizeCardName("  Lightning   Bolt  "), "lightning bolt");
});

test("lookupOwnedCount matches on the card's full name", () => {
  const collection = { "lightning bolt": 4 };
  assert.equal(lookupOwnedCount(collection, { name: "Lightning Bolt" }), 4);
});

test("lookupOwnedCount falls back to the front-face name for double-faced cards", () => {
  const collection = { "delver of secrets": 2 };
  const card = { name: "Delver of Secrets // Insectile Aberration" };
  assert.equal(lookupOwnedCount(collection, card), 2);
});

test("lookupOwnedCount returns 0 for an unowned card", () => {
  assert.equal(lookupOwnedCount({}, { name: "Black Lotus" }), 0);
});
