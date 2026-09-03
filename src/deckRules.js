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

// A land count this low can't be mechanically "fixed" (which lands to add
// is a real deckbuilding decision), but it's a clear sign the deck won't
// actually function, so it's worth flagging rather than shipping quietly.
// Real constructed decks run roughly 16-18 out of 60 (~40%); even a very
// aggressive low-curve deck rarely goes below ~14.
const MIN_REASONABLE_LANDS = 14;

/**
 * Counts lands in the mainboard (basic lands via the arenaId:0 sentinel,
 * plus any nonbasic land looked up by arenaId in cardDb) and warns if
 * the total looks too low to actually cast the rest of the deck.
 */
export function checkManaBase(mainboard, cardDb) {
  let landCount = 0;
  for (const entry of mainboard || []) {
    if (entry.arenaId === 0) {
      landCount += entry.count;
      continue;
    }
    if (cardDb.get(entry.arenaId)?.typeLine?.includes("Land")) {
      landCount += entry.count;
    }
  }

  if (landCount < MIN_REASONABLE_LANDS) {
    return [
      `Only ${landCount} land${landCount === 1 ? "" : "s"} in the mainboard - constructed decks typically need 16-18 for consistent mana. This deck likely can't reliably cast its spells as built.`,
    ];
  }
  return [];
}

/**
 * Checks the mythic+rare wildcard cost (from computeCraftCost's
 * wildcardsNeeded) against a player-set budget. Which specific unowned
 * cards to cut to get under budget is a real deckbuilding decision, not
 * something to auto-fix, so this only flags an overrun - same pattern as
 * checkDeckLegality/checkManaBase. maxRareMythicWildcards of null/undefined
 * means no budget was set (nothing to check).
 */
export function checkWildcardBudget(wildcardsNeeded, maxRareMythicWildcards) {
  if (maxRareMythicWildcards == null) return [];
  const needed = (wildcardsNeeded.mythic || 0) + (wildcardsNeeded.rare || 0);
  if (needed > maxRareMythicWildcards) {
    return [`Needs ${needed} mythic/rare wildcards, over your budget of ${maxRareMythicWildcards}.`];
  }
  return [];
}
