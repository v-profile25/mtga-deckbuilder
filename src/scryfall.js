import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "..", "data", "scryfall-cache.json");
const USER_AGENT = "mtga-deckbuilder/0.1 (personal project)";

function slimCard(card) {
  return {
    arenaId: card.arena_id,
    name: card.name,
    manaCost: card.mana_cost ?? "",
    cmc: card.cmc ?? 0,
    typeLine: card.type_line ?? "",
    oracleText: card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).join(" // ") ?? "",
    colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
    colorIdentity: card.color_identity ?? [],
    rarity: card.rarity,
    set: card.set,
    collectorNumber: card.collector_number,
    legalities: {
      standard: card.legalities?.standard,
      historic: card.legalities?.historic,
      alchemy: card.legalities?.alchemy,
      explorer: card.legalities?.explorer,
      brawl: card.legalities?.brawl,
    },
    imageUrl: card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null,
  };
}

function isGzip(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

// Decodes and yields each line of a (possibly huge) buffer of newline-
// delimited text, decoding one line at a time instead of converting the
// whole buffer to a single JS string first - decompressed, the full
// default_cards file (every printing of every card, not just Arena's)
// is large enough to exceed V8's ~512MB string length limit, even though
// Buffers themselves have no such limit.
export function* iterLines(buffer) {
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) {
      yield buffer.toString("utf8", start, i);
      start = i + 1;
    }
  }
  if (start < buffer.length) yield buffer.toString("utf8", start, buffer.length);
}

// Scryfall retired the plain-JSON bulk download (the "download_uri" field)
// on 2026-07-20 in favor of "jsonl_download_uri" - a gzipped file of one
// JSON object per line, rather than one big JSON array. Prefer the new
// field but fall back to the old one/format in case it ever reappears,
// and detect gzip by magic bytes rather than trusting the URL/headers.
// Filters down to Arena-legal cards (and slims each one) as it goes,
// rather than materializing every printing of every card at once.
async function fetchArenaCards(defaultCards) {
  const downloadUri = defaultCards.jsonl_download_uri || defaultCards.download_uri;
  if (!downloadUri) {
    throw new Error(
      "Scryfall's 'default_cards' bulk-data entry has no download URI (checked jsonl_download_uri and download_uri)."
    );
  }

  const cardsRes = await fetch(downloadUri, { headers: { "User-Agent": USER_AGENT } });
  if (!cardsRes.ok) {
    throw new Error(`Scryfall bulk card download failed: ${cardsRes.status} ${cardsRes.statusText}`);
  }

  const bytes = Buffer.from(await cardsRes.arrayBuffer());
  const raw = isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes;

  const arenaCards = [];
  if (downloadUri.includes(".jsonl")) {
    for (const line of iterLines(raw)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const card = JSON.parse(trimmed);
      if (typeof card.arena_id === "number") arenaCards.push(slimCard(card));
    }
  } else {
    // Legacy plain-JSON-array fallback - not expected to be gzipped or
    // large enough to hit the string limit like the current format, so a
    // single parse is fine here.
    const allCards = JSON.parse(raw.toString("utf8"));
    for (const card of allCards) {
      if (typeof card.arena_id === "number") arenaCards.push(slimCard(card));
    }
  }
  return arenaCards;
}

/**
 * Downloads Scryfall's "default_cards" bulk file (all printings) and
 * caches a filtered-down version (only cards with an arena_id, i.e.
 * cards that actually exist on Arena) to data/scryfall-cache.json.
 * Re-run with force:true to refresh after Scryfall's data updates.
 */
export async function ensureCardCache({ force = false } = {}) {
  if (!force && fs.existsSync(CACHE_PATH)) return;

  const bulkListRes = await fetch("https://api.scryfall.com/bulk-data", {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!bulkListRes.ok) {
    throw new Error(`Scryfall bulk-data listing failed: ${bulkListRes.status} ${bulkListRes.statusText}`);
  }
  const bulkList = await bulkListRes.json();
  const defaultCards = bulkList.data.find((d) => d.type === "default_cards");
  if (!defaultCards) throw new Error("Scryfall bulk-data response missing 'default_cards' entry");

  const arenaCards = await fetchArenaCards(defaultCards);

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(arenaCards), "utf8");
}

/** Returns a Map<arenaId (number), card>. Call ensureCardCache() first. */
export function loadCardDb() {
  if (!fs.existsSync(CACHE_PATH)) {
    throw new Error("Scryfall cache not found. Call ensureCardCache() first (or POST /api/cards/sync).");
  }
  const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  const byArenaId = new Map();
  for (const card of raw) byArenaId.set(card.arenaId, card);
  return byArenaId;
}

export function cacheExists() {
  return fs.existsSync(CACHE_PATH);
}

export function cacheStat() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  const stat = fs.statSync(CACHE_PATH);
  return { sizeBytes: stat.size, mtime: stat.mtime };
}
