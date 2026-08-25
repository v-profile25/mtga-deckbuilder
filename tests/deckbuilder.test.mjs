import test from "node:test";
import assert from "node:assert/strict";

import { extractJsonBlock, filterKnownCards } from "../src/deckbuilder.js";

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
