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
const ARENA_EXPORT_LINE = /^(\d+)\s+(.+?)(?:\s+\([A-Za-z0-9]+\)\s+\S+)?$/;

function stripQuotes(field) {
  return field.replace(/^"(.*)"$/, "$1").trim();
}

// CSV-ish exports vary in delimiter (comma or semicolon - semicolon is
// common specifically because plenty of card names contain a literal
// comma, e.g. "Teferi, Hero of Dominaria") and column count/order (a
// simple "Name,Count" pair, or a full "Count;Name;Edition;Collector
// Number;Rarity" export). We only need the count and the name, wherever
// they land, and ignore any other columns.
function parseDelimited(line) {
  const delimiter = line.includes(";") ? ";" : line.includes(",") ? "," : null;
  if (!delimiter) return null;

  const fields = line.split(delimiter).map(stripQuotes);
  if (fields.length < 2) return null;

  const [first, second] = fields;
  if (/^\d+$/.test(first)) return { name: second, count: Number(first) };
  if (/^\d+$/.test(second)) return { name: first, count: Number(second) };
  return null;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const arenaMatch = trimmed.match(ARENA_EXPORT_LINE);
  if (arenaMatch) return { name: arenaMatch[2].trim(), count: Number(arenaMatch[1]) };

  return parseDelimited(trimmed);
}

/**
 * Parses a pasted collection list into { [normalizedName]: totalCount }.
 * Accepts one entry per line in any of:
 *   "4 Lightning Bolt"
 *   "4 Lightning Bolt (LEA) 161"        (Arena's own deck-export format)
 *   "Lightning Bolt,4"  or  "4,Lightning Bolt"        (comma CSV, either column order)
 *   "1;Settle the Wreckage;xln;34;rare"  (semicolon CSV, extra columns ignored)
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
