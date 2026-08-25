import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCardCache, loadCardDb, cacheExists, cacheStat } from "../src/scryfall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "..", "data", "scryfall-cache.json");

// Shapes mirror Scryfall's real API responses (bulk-data listing, then the
// default_cards bulk file) closely enough to exercise ensureCardCache's
// fetch-and-filter logic without hitting the network.
const FAKE_BULK_LISTING = {
  object: "list",
  data: [
    { type: "oracle_cards", download_uri: "https://example.invalid/oracle-cards.json" },
    { type: "default_cards", download_uri: "https://example.invalid/default-cards.json" },
  ],
};

const FAKE_CARDS = [
  {
    arena_id: 12345,
    name: "Lightning Bolt",
    mana_cost: "{R}",
    cmc: 1,
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "common",
    set: "lea",
    collector_number: "161",
    legalities: { standard: "not_legal", historic: "legal", alchemy: "not_legal", explorer: "not_legal", brawl: "legal" },
    image_uris: { normal: "https://example.invalid/bolt.jpg" },
  },
  {
    // No arena_id -> a paper-only printing, must be filtered out.
    name: "Black Lotus",
    mana_cost: "{0}",
    cmc: 0,
    type_line: "Artifact",
    colors: [],
    color_identity: [],
    rarity: "special",
    set: "lea",
    collector_number: "232",
    legalities: { standard: "not_legal", historic: "not_legal", alchemy: "not_legal", explorer: "not_legal", brawl: "not_legal" },
  },
];

function withMockedFetch(responsesByUrl, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = responsesByUrl[url];
    if (!body) throw new Error(`Unexpected fetch to ${url} in test`);
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function withSavedCacheFile(fn) {
  const existed = fs.existsSync(CACHE_PATH);
  const original = existed ? fs.readFileSync(CACHE_PATH, "utf8") : null;
  return fn().finally(() => {
    if (existed) fs.writeFileSync(CACHE_PATH, original, "utf8");
    else if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
  });
}

test("ensureCardCache downloads, filters to arena-only cards, and caches them", async () => {
  await withSavedCacheFile(() =>
    withMockedFetch(
      {
        "https://api.scryfall.com/bulk-data": FAKE_BULK_LISTING,
        "https://example.invalid/default-cards.json": FAKE_CARDS,
      },
      async () => {
        await ensureCardCache({ force: true });

        assert.equal(cacheExists(), true);
        const stat = cacheStat();
        assert.ok(stat.sizeBytes > 0);

        const cardDb = loadCardDb();
        assert.equal(cardDb.size, 1, "paper-only card without arena_id must be filtered out");

        const bolt = cardDb.get(12345);
        assert.ok(bolt, "Lightning Bolt should be present, keyed by arena_id");
        assert.equal(bolt.name, "Lightning Bolt");
        assert.equal(bolt.rarity, "common");
        assert.equal(bolt.legalities.historic, "legal");
        assert.equal(bolt.legalities.standard, "not_legal");
        assert.equal(bolt.imageUrl, "https://example.invalid/bolt.jpg");
      }
    )
  );
});

test("ensureCardCache skips the network entirely when a cache already exists and force is not set", async () => {
  await withSavedCacheFile(async () => {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify([{ arenaId: 1, name: "Placeholder" }]), "utf8");

    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch should not have been called");
    };
    try {
      await ensureCardCache({ force: false });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(fetchCalled, false);
    const cardDb = loadCardDb();
    assert.equal(cardDb.get(1).name, "Placeholder");
  });
});

test("cacheExists/cacheStat/loadCardDb behave correctly with no cache present", async () => {
  await withSavedCacheFile(async () => {
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);

    assert.equal(cacheExists(), false);
    assert.equal(cacheStat(), null);
    assert.throws(() => loadCardDb(), /Scryfall cache not found/);
  });
});
