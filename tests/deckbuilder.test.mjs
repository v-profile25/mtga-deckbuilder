import test from "node:test";
import assert from "node:assert/strict";

import { extractJsonBlock, filterKnownCards, buildCandidatePool, buildSystemPrompt } from "../src/deckbuilder.js";

test("buildSystemPrompt always tells the model the player's own request overrides the owned-cards default", () => {
  const prompt = buildSystemPrompt({ format: "standard" });
  assert.match(prompt, /only a DEFAULT/);
  assert.match(prompt, /follow what the player actually asked for instead of this default/);
});

test("buildSystemPrompt says nothing about a wildcard budget when none is set", () => {
  const prompt = buildSystemPrompt({ format: "standard" });
  assert.doesNotMatch(prompt, /explicit budget/);
});

test("buildSystemPrompt states the numeric wildcard budget and tells the model not to be conservative within it", () => {
  const prompt = buildSystemPrompt({ format: "standard", maxRareMythicWildcards: 10 });
  assert.match(prompt, /at most 10 mythic\+rare wildcards/);
  assert.match(prompt, /[Cc]ommon and uncommon wildcards are unrestricted/);
  assert.match(prompt, /don't be conservative/);
});

test("buildSystemPrompt treats a zero wildcard budget as a real, explicit setting (not 'unset')", () => {
  const prompt = buildSystemPrompt({ format: "standard", maxRareMythicWildcards: 0 });
  assert.match(prompt, /at most 0 mythic\+rare wildcards/);
});

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

test("buildCandidatePool includes an unowned card explicitly named in the request, even at low rarity", () => {
  // Regression test for the real reported case: "build a deck around
  // Getaway Barrel" where Getaway Barrel is unowned and not high-rarity
  // enough to make the default top-150-by-rarity unowned reserve. Naming
  // a card outright must guarantee it's a candidate regardless of rarity
  // - the model can't build around a card it was never shown.
  const cardDb = new Map();
  for (let i = 0; i < 200; i++) cardDb.set(i, makeCard(i, { rarity: "mythic" })); // fills the rarity reserve
  cardDb.set(9999, makeCard(9999, { name: "Getaway Barrel", rarity: "uncommon" }));

  const candidates = buildCandidatePool(cardDb, {}, "standard", "build a deck around Getaway Barrel");
  assert.ok(
    candidates.some((c) => c.name === "Getaway Barrel"),
    "a card named directly in the request must be included as a candidate"
  );
});

test("buildCandidatePool is case-insensitive when matching a named card against the request", () => {
  const cardDb = new Map([[1, makeCard(1, { name: "Getaway Barrel", rarity: "uncommon" })]]);
  const candidates = buildCandidatePool(cardDb, {}, "standard", "GETAWAY BARREL deck please");
  assert.ok(candidates.some((c) => c.name === "Getaway Barrel"));
});

test("buildCandidatePool doesn't duplicate a named card that also lands in the rarity reserve", () => {
  const cardDb = new Map([[1, makeCard(1, { name: "Getaway Barrel", rarity: "mythic" })]]);
  const candidates = buildCandidatePool(cardDb, {}, "standard", "Getaway Barrel deck");
  assert.equal(candidates.filter((c) => c.name === "Getaway Barrel").length, 1);
});

test("buildCandidatePool never drops an owned card, even a real collection's worth (well beyond the old 800 cap)", () => {
  // Regression test for the second half of the same bug class: owned
  // cards were also capped (at 800), truncated in arbitrary card-cache
  // order with no relevance ranking - so a real, owned, legal card could
  // silently vanish from the prompt for no reason related to the
  // request, purely because of where it landed in that arbitrary order.
  const cardDb = new Map();
  for (let i = 0; i < 1500; i++) cardDb.set(i, makeCard(i));
  cardDb.set(1499, makeCard(1499, { name: "Getaway Barrel" })); // near the "end" of iteration order

  const collection = {};
  for (let i = 0; i < 1500; i++) collection[`card ${i}`] = 1;
  collection["getaway barrel"] = 1;

  const candidates = buildCandidatePool(cardDb, collection, "standard");
  assert.ok(
    candidates.some((c) => c.name === "Getaway Barrel"),
    "an owned card must never be dropped just because the owned pool is large"
  );
  assert.equal(candidates.filter((c) => c.owned > 0).length, 1500, "every owned legal card should be present");
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
