import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { ensureCardCache, loadCardDb, cacheExists, cacheStat } from "../src/scryfall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "..", "data", "scryfall-cache.json");

// Shapes mirror Scryfall's real API responses (bulk-data listing, then the
// default_cards bulk file) closely enough to exercise ensureCardCache's
// fetch-and-filter logic without hitting the network. Scryfall retired the
// plain-JSON "download_uri" on 2026-07-20 in favor of a gzipped
// "jsonl_download_uri" (one JSON object per line) - that's the current,
// primary format these tests mock; a couple of tests also check the old
// plain-JSON field still works as a fallback.
const FAKE_BULK_LISTING = {
  object: "list",
  data: [
    { type: "oracle_cards", jsonl_download_uri: "https://example.invalid/oracle-cards.jsonl.gz" },
    { type: "default_cards", jsonl_download_uri: "https://example.invalid/default-cards.jsonl.gz" },
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

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// responsesByUrl values are either a plain object (served as JSON, for the
// bulk-data listing endpoint) or a Buffer (served as raw bytes, for the
// actual card-data download). A real fetch() Response supports both
// json() and arrayBuffer() regardless of content type, so the mock does
// too - production code always calls arrayBuffer() on the card download,
// whether or not that download happens to be gzipped.
function withMockedFetch(responsesByUrl, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = responsesByUrl[url];
    if (body === undefined) throw new Error(`Unexpected fetch to ${url} in test`);
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => JSON.parse(buffer.toString("utf8")),
      arrayBuffer: async () => toArrayBuffer(buffer),
    };
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

function toGzippedJsonl(cards) {
  return zlib.gzipSync(cards.map((c) => JSON.stringify(c)).join("\n"));
}

test("ensureCardCache downloads gzipped JSONL, filters to arena-only cards, and caches them", async () => {
  await withSavedCacheFile(() =>
    withMockedFetch(
      {
        "https://api.scryfall.com/bulk-data": FAKE_BULK_LISTING,
        "https://example.invalid/default-cards.jsonl.gz": toGzippedJsonl(FAKE_CARDS),
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

test("ensureCardCache falls back to the legacy plain-JSON download_uri when jsonl_download_uri is absent", async () => {
  const legacyListing = {
    object: "list",
    data: [{ type: "default_cards", download_uri: "https://example.invalid/default-cards-legacy.json" }],
  };
  await withSavedCacheFile(() =>
    withMockedFetch(
      {
        "https://api.scryfall.com/bulk-data": legacyListing,
        "https://example.invalid/default-cards-legacy.json": FAKE_CARDS,
      },
      async () => {
        // Legacy download_uri responses are served as plain JSON, not
        // gzipped bytes - the mock's json() branch models that directly.
        await ensureCardCache({ force: true });
        const cardDb = loadCardDb();
        assert.equal(cardDb.size, 1);
        assert.equal(cardDb.get(12345).name, "Lightning Bolt");
      }
    )
  );
});

test("ensureCardCache throws a clear error when the default_cards entry has neither download URI field", async () => {
  const brokenListing = { object: "list", data: [{ type: "default_cards" }] };
  await withSavedCacheFile(() =>
    withMockedFetch({ "https://api.scryfall.com/bulk-data": brokenListing }, async () => {
      await assert.rejects(() => ensureCardCache({ force: true }), /no download URI/);
    })
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
