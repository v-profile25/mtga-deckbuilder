import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findDefaultLogPath, loadCollectionFromFile } from "./src/logParser.js";
import { ensureCardCache, loadCardDb, cacheExists, cacheStat } from "./src/scryfall.js";
import { generateDeck } from "./src/deckbuilder.js";
import { computeCraftCost } from "./src/craft.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const COLLECTION_PATH = path.join(DATA_DIR, "collection.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function loadStoredCollection() {
  if (!fs.existsSync(COLLECTION_PATH)) return null;
  return JSON.parse(fs.readFileSync(COLLECTION_PATH, "utf8"));
}

app.get("/api/collection", (req, res) => {
  const collection = loadStoredCollection();
  if (!collection) return res.status(404).json({ error: "No collection synced yet." });
  res.json({ cardCount: Object.keys(collection).length, collection });
});

app.post("/api/collection/sync", (req, res) => {
  try {
    const logPath = req.body?.logPath || findDefaultLogPath();
    if (!logPath) {
      return res.status(400).json({
        error:
          "Couldn't find Player.log at the default location for this OS. Pass an explicit { logPath } in the request body.",
      });
    }
    const collection = loadCollectionFromFile(logPath);
    fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection), "utf8");
    res.json({ ok: true, logPath, cardCount: Object.keys(collection).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/cards/status", (req, res) => {
  res.json({ cached: cacheExists(), stat: cacheStat() });
});

app.post("/api/cards/sync", async (req, res) => {
  try {
    await ensureCardCache({ force: Boolean(req.body?.force) });
    res.json({ ok: true, stat: cacheStat() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/deck/generate", async (req, res) => {
  try {
    const { description, format = "standard" } = req.body || {};
    if (!description || typeof description !== "string") {
      return res.status(400).json({ error: "Missing 'description' string in request body." });
    }
    if (!cacheExists()) {
      return res.status(400).json({ error: "Card database not synced yet. POST /api/cards/sync first." });
    }
    const collection = loadStoredCollection();
    if (!collection) {
      return res.status(400).json({ error: "Collection not synced yet. POST /api/collection/sync first." });
    }

    const cardDb = loadCardDb();
    const deck = await generateDeck({
      description,
      format,
      collection,
      cardDb,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const craftCost = computeCraftCost(deck.mainboard || [], collection, cardDb);
    res.json({ deck, craftCost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8934;
app.listen(PORT, () => {
  console.log(`mtga-deckbuilder running at http://localhost:${PORT}`);
});
