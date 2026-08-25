import { normalizeCardName } from "./collectionImport.js";

// Magic: The Gathering deckbuilding rules, applied as a safety net after
// Claude's decklist comes back - the system prompt states the same rules,
// but nothing guarantees the model actually follows them (especially
// under a token budget, or simply from miscounting a long list).
export const MAX_COPIES_PER_CARD = { standard: 4, historic: 4, explorer: 4, alchemy: 4, brawl: 1 };
export const REQUIRED_MAINBOARD_SIZE = { standard: 60, historic: 60, explorer: 60, alchemy: 60, brawl: 100 };
const MAX_SIDEBOARD_SIZE = 15;

function isBasicLand(entry) {
  return entry.arenaId === 0; // the sentinel Claude uses for basic lands
}

// Cards are limited by name (any printing counts toward the same limit),
// not by the specific arenaId/printing Claude happened to pick - the
// candidate pool can list the same card under more than one arenaId if
// Scryfall has multiple Arena-legal printings of it.
function cardKey(entry) {
  return normalizeCardName(entry.name);
}

/**
 * Caps copies of any single card (mainboard + sideboard combined) to the
 * format's limit - basic lands are exempt. Mainboard is filled first, so
 * if a card is already at the limit there, none of it can appear in the
 * sideboard either (matches the real rule). Returns the clamped lists
 * plus a human-readable list of what was trimmed, for transparency.
 */
export function clampCopyLimits(mainboard, sideboard, format) {
  const max = MAX_COPIES_PER_CARD[format] ?? 4;
  const fixes = [];
  const remaining = new Map();

  function trim(entries) {
    return (entries || [])
      .map((entry) => {
        if (isBasicLand(entry)) return entry;
        const key = cardKey(entry);
        const budget = remaining.has(key) ? remaining.get(key) : max;
        const allowed = Math.max(0, Math.min(entry.count, budget));
        remaining.set(key, budget - allowed);
        if (allowed !== entry.count) {
          fixes.push(`Trimmed ${entry.name} from ${entry.count} to ${allowed} ${allowed === 1 ? "copy" : "copies"} (max ${max} allowed).`);
        }
        return { ...entry, count: allowed };
      })
      .filter((entry) => entry.count > 0);
  }

  return { mainboard: trim(mainboard), sideboard: trim(sideboard), fixes };
}

function sumCounts(entries) {
  return (entries || []).reduce((total, e) => total + (e.count || 0), 0);
}

/**
 * Checks a (already copy-limit-clamped) deck against rules that can't be
 * safely auto-fixed - mainly exact deck size, since inventing or removing
 * cards to hit a count is a deckbuilding decision, not a mechanical clamp.
 */
export function checkDeckLegality(deck, format) {
  const issues = [];
  const requiredMainboard = REQUIRED_MAINBOARD_SIZE[format] ?? 60;
  const mainboardCount = sumCounts(deck.mainboard);
  if (mainboardCount !== requiredMainboard) {
    issues.push(`Mainboard has ${mainboardCount} cards, but ${format} decks need exactly ${requiredMainboard}.`);
  }
  const sideboardCount = sumCounts(deck.sideboard);
  if (sideboardCount > MAX_SIDEBOARD_SIZE) {
    issues.push(`Sideboard has ${sideboardCount} cards, but the max is ${MAX_SIDEBOARD_SIZE}.`);
  }
  return { valid: issues.length === 0, issues };
}
