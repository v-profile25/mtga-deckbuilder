import test from "node:test";
import assert from "node:assert/strict";

import { extractJsonBlock, filterKnownCards, buildCandidatePool } from "../src/deckbuilder.js";

function makeCard(arenaId, overrides = {}) {
  return {
    arenaId,
    name: `Card ${arenaId}`,
    manaCost: "{1}",
    typeLine: "Creature",
    colors: ["R"],
    rarity: "common",
    legalities: { standard: "legal" },
    ...overrides,
  };
}

test("buildCandidatePool always reserves room for unowned cards, even when owned alone exceeds the candidate cap", () => {
  // Regression test: a large real collection (thousands of unique cards)
  // can easily have more than 800 legal-in-format owned cards on its own.
  // The candidate pool used to fill entirely with owned cards in that
  // case, leaving zero slots for anything unowned - so the model could
  // never suggest a card worth crafting, no matter what was asked.
  const cardDb = new Map();
  for (let i = 0; i < 900; i++) {
    cardDb.set(i, makeCard(i, { rarity: "common" }));
  }
  cardDb.set(9000, makeCard(9000, { name: "Unowned Bomb", rarity: "mythic" }));

  const collection = {};
  for (let i = 0; i < 900; i++) collection[`card ${i}`] = 4;

  const candidates = buildCandidatePool(cardDb, collection, "standard");
  const names = candidates.map((c) => c.name);
  assert.ok(names.includes("Unowned Bomb"), "an unowned card must still make it into the candidate pool");
});

test("buildCandidatePool caps owned and unowned independently rather than one crowding out the other", () => {
  const cardDb = new Map();
  for (let i = 0; i < 850; i++) cardDb.set(i, makeCard(i));
  for (let i = 850; i < 1000; i++) cardDb.set(i, makeCard(i, { rarity: "mythic" }));

  const collection = {};
  for (let i = 0; i < 850; i++) collection[`card ${i}`] = 1;

  const candidates = buildCandidatePool(cardDb, collection, "standard");
  const ownedCount = candidates.filter((c) => c.owned > 0).length;
  const unownedCount = candidates.filter((c) => c.owned === 0).length;

  assert.ok(ownedCount > 0, "owned cards must be represented");
  assert.equal(unownedCount, 150, "all 150 available unowned cards should fit within the unowned reserve");
});

test("extractJsonBlock parses a clean JSON-only response", () => {
  const text = `{"deckName": "Mono Red", "mainboard": []}`;
  assert.deepEqual(extractJsonBlock(text), { deckName: "Mono Red", mainboard: [] });
});

test("extractJsonBlock parses JSON wrapped in a ```json fenced code block", () => {
  const text = 'Here is the deck:\n```json\n{"deckName": "Azorius Control"}\n```\nHope it helps!';
  assert.deepEqual(extractJsonBlock(text), { deckName: "Azorius Control" });
});

test("extractJsonBlock ignores braces inside string values (mana symbols)", () => {
  const text = `{
    "deckName": "Mono Red Burn",
    "reasoning": "Uses {T}: Add {R} rocks and {2/W} hybrid removal to close games.",
    "mainboard": [{"arenaId": 1, "name": "Mountain", "count": 20}]
  }`;
  const result = extractJsonBlock(text);
  assert.equal(result.deckName, "Mono Red Burn");
  assert.match(result.reasoning, /\{T\}/);
  assert.equal(result.mainboard[0].name, "Mountain");
});

test("extractJsonBlock ignores an escaped quote followed by a brace inside a string", () => {
  const text = `{"reasoning": "The card literally says \\"Add {R}\\" in its text box."}`;
  const result = extractJsonBlock(text);
  assert.equal(result.reasoning, 'The card literally says "Add {R}" in its text box.');
});

test("extractJsonBlock throws when there's no JSON object in the response", () => {
  assert.throws(() => extractJsonBlock("Sorry, I can't build that deck."), /No JSON object found/);
});

test("extractJsonBlock's error includes what the model actually said, for diagnosing failures", () => {
  assert.throws(
    () => extractJsonBlock("I'd be happy to help, but I need more details about your collection first."),
    /I'd be happy to help/
  );
});

test("extractJsonBlock reports '(empty response)' rather than a blank preview when there's no text at all", () => {
  assert.throws(() => extractJsonBlock(""), /\(empty response\)/);
});

test("extractJsonBlock throws on truncated/unbalanced JSON (e.g. hit max_tokens)", () => {
  const text = `{"deckName": "Mono Red", "mainboard": [{"arenaId": 1, "name": "Mountain"`;
  assert.throws(() => extractJsonBlock(text), /Unbalanced JSON object/);
});

test("filterKnownCards drops arenaIds Claude hallucinated outside the candidate pool", () => {
  const validArenaIds = new Set([100, 200]);
  const entries = [
    { arenaId: 100, name: "Owned Card", count: 4 },
    { arenaId: 999, name: "Hallucinated Card", count: 2 },
    { arenaId: 200, name: "Another Real Card", count: 1 },
  ];
  const filtered = filterKnownCards(entries, validArenaIds);
  assert.deepEqual(
    filtered.map((e) => e.name),
    ["Owned Card", "Another Real Card"]
  );
});

test("filterKnownCards keeps arenaId 0 as the basic-land sentinel even though it's never in the candidate pool", () => {
  const validArenaIds = new Set([100]);
  const entries = [{ arenaId: 0, name: "Mountain", count: 20 }];
  assert.deepEqual(filterKnownCards(entries, validArenaIds), entries);
});

test("filterKnownCards passes through non-array input unchanged", () => {
  assert.equal(filterKnownCards(undefined, new Set()), undefined);
});
