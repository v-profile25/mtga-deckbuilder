// MTGA no longer logs a full owned-card snapshot to Player.log (the
// PlayerInventory.GetPlayerCardsV3 event this app originally relied on
// doesn't exist in current clients), so collection data comes from the
// player pasting/uploading a list instead. Ownership in Arena is by card
// name, not specific printing - owning any printing of a card lets you
// play it, so the collection is keyed by normalized name rather than
// arenaId.

export function normalizeCardName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Arena's own deck-export format looks like "4 Lightning Bolt (LEA) 161".
// We also accept a bare "4 Lightning Bolt", "Lightning Bolt,4" (CSV,
// either column order), and ignore blank lines / a CSV header row.
const ARENA_EXPORT_LINE = /^(\d+)\s+(.+?)(?:\s+\([A-Za-z0-9]+\)\s+\S+)?$/;
const CSV_NAME_FIRST = /^"?([^",]+)"?\s*,\s*(\d+)\s*$/;
const CSV_COUNT_FIRST = /^(\d+)\s*,\s*"?([^",]+)"?\s*$/;

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let match = trimmed.match(ARENA_EXPORT_LINE);
  if (match) return { name: match[2].trim(), count: Number(match[1]) };

  match = trimmed.match(CSV_COUNT_FIRST);
  if (match) return { name: match[2].trim(), count: Number(match[1]) };

  match = trimmed.match(CSV_NAME_FIRST);
  if (match && !Number.isNaN(Number(match[2]))) {
    return { name: match[1].trim(), count: Number(match[2]) };
  }

  return null;
}

/**
 * Parses a pasted collection list into { [normalizedName]: totalCount }.
 * Accepts one entry per line in any of:
 *   "4 Lightning Bolt"
 *   "4 Lightning Bolt (LEA) 161"   (Arena's own deck-export format)
 *   "Lightning Bolt,4"  or  "4,Lightning Bolt"   (CSV, either column order)
 * Unparseable lines (blank lines, a CSV header row, stray notes) are
 * skipped rather than rejecting the whole import. Duplicate names across
 * lines (e.g. two different printings pasted separately) are summed.
 */
export function parseCollectionText(text) {
  const collection = {};
  for (const line of (text || "").split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed || !Number.isFinite(parsed.count) || parsed.count <= 0 || !parsed.name) continue;
    const key = normalizeCardName(parsed.name);
    collection[key] = (collection[key] ?? 0) + parsed.count;
  }
  return collection;
}

/**
 * Looks up how many copies of `card` (a slimmed Scryfall card, as stored
 * in the card db) the player owns. Falls back to the front-face name for
 * double-faced cards ("Delver of Secrets // Insectile Aberration"), since
 * most collection exports only list the front face.
 */
export function lookupOwnedCount(collection, card) {
  const fullName = normalizeCardName(card.name);
  if (collection[fullName] !== undefined) return collection[fullName];

  const frontFace = card.name.split("//")[0];
  if (frontFace !== card.name) {
    const frontKey = normalizeCardName(frontFace);
    if (collection[frontKey] !== undefined) return collection[frontKey];
  }

  return 0;
}
