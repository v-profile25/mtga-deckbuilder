import Anthropic from "@anthropic-ai/sdk";
import { lookupOwnedCount } from "./collectionImport.js";
import {
  MAX_COPIES_PER_CARD,
  REQUIRED_MAINBOARD_SIZE,
  clampCopyLimits,
  checkDeckLegality,
  checkManaBase,
} from "./deckRules.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// Owned cards aren't ranked by relevance - cutting them off at some cap
// would silently drop arbitrary ones (whatever order the card cache
// happens to store them in) with no relation to which ones actually
// matter for the request. A real collection can have well over a
// thousand legal-in-format owned cards; input tokens are cheap relative
// to the output budget this app already spends, so there's no real cost
// reason to truncate here - this ceiling only exists to bound a
// pathological case (a corrupted import producing tens of thousands of
// "owned" entries), not to trim a normal collection.
const MAX_OWNED_CANDIDATES = 5000;
// Unowned cards get a fixed, rarity-prioritized reserve instead - the
// unowned pool is the entire rest of the format's card pool (thousands
// of cards with nothing to do with what the player owns), so it's
// deliberately curated down to the best crafting suggestions rather than
// shown in full. This must never come out of owned's budget, or a large
// collection crowds unowned out of the prompt entirely.
const MAX_UNOWNED_CANDIDATES = 150;

const FORMAT_LEGALITY_KEY = {
  standard: "standard",
  historic: "historic",
  explorer: "explorer",
  alchemy: "alchemy",
  brawl: "brawl",
};

export function buildCandidatePool(cardDb, collection, format) {
  const legalityKey = FORMAT_LEGALITY_KEY[format] || "standard";

  const owned = [];
  const unowned = [];
  for (const card of cardDb.values()) {
    if (card.legalities?.[legalityKey] !== "legal") continue;
    if (card.typeLine?.includes("Basic Land")) continue; // always available, no need to list
    const count = lookupOwnedCount(collection, card);
    (count > 0 ? owned : unowned).push({ ...card, owned: count });
  }

  const rarityRank = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
  unowned.sort((a, b) => (rarityRank[a.rarity] ?? 4) - (rarityRank[b.rarity] ?? 4));

  return [...owned.slice(0, MAX_OWNED_CANDIDATES), ...unowned.slice(0, MAX_UNOWNED_CANDIDATES)];
}

function candidatesToPromptLines(candidates) {
  return candidates
    .map(
      (c) =>
        `${c.arenaId}|${c.name}|${c.manaCost || "-"}|${c.typeLine}|${(c.colors || []).join("") || "C"}|${c.rarity}|owned:${c.owned}`
    )
    .join("\n");
}

function preview(text, length = 400) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "(empty response)";
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

// A card's reasoning/oracle text routinely contains literal { } characters
// (mana symbols like {T}, {2/W}), so brace-matching has to ignore braces
// that appear inside JSON string values rather than just counting them.
export function extractJsonBlock(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start === -1) {
    throw new Error(`No JSON object found in model response. It said: ${preview(text)}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error(`Unbalanced JSON object in model response (likely truncated). It said: ${preview(text)}`);
}

// Claude is instructed to only use arenaIds from the candidate list, but
// nothing stops it from hallucinating one anyway - drop anything that
// isn't a known candidate (arenaId 0 is the sentinel for basic lands,
// which are deliberately excluded from the candidate list).
export function filterKnownCards(entries, validArenaIds) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((e) => e && (e.arenaId === 0 || validArenaIds.has(e.arenaId)));
}

/**
 * Asks Claude to build a deck from the player's real collection.
 * `format` is one of standard|historic|explorer|alchemy|brawl.
 * Returns { deckName, colors, mainboard, sideboard, reasoning, suggestedCrafts }
 * where mainboard/sideboard entries are { arenaId, name, count }.
 */
export async function generateDeck({ description, format, collection, cardDb, apiKey }) {
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key configured. Set ANTHROPIC_API_KEY in your environment (see README)."
    );
  }
  const client = new Anthropic({ apiKey });

  const candidates = buildCandidatePool(cardDb, collection, format);
  const candidateText = candidatesToPromptLines(candidates);

  const maxCopies = MAX_COPIES_PER_CARD[format] ?? 4;
  const mainboardSize = REQUIRED_MAINBOARD_SIZE[format] ?? 60;
  const copyRule =
    maxCopies === 1
      ? "This is a SINGLETON format: at most 1 copy of any card other than basic lands."
      : `At most ${maxCopies} copies of any single card (mainboard and sideboard combined) other than basic lands, which are unlimited.`;

  const landGuidance =
    maxCopies === 1
      ? "Brawl decks typically run 17-18 lands out of 100 for a two-color deck (adjust for curve/ramp/color count)."
      : "Constructed decks typically run 16-18 lands out of 60 (roughly 40%) for consistent draws - lean toward 15-16 only for a very low, aggressive curve, and 17-18 for midrange/control. Never go below ~14; a deck can't function without enough lands, no matter how good the spells are.";

  const system = `You are an expert Magic: The Gathering Arena deckbuilder who deeply understands \
competitive deckbuilding fundamentals: mana curve construction, card advantage, removal density, \
color consistency, and how individual cards combine into a coherent game plan - not just a pile of \
powerful cards. You will be given the player's request in plain language, the target format, \
and a list of candidate cards (one per line: arenaId|name|manaCost|typeLine|colors|rarity|owned:N). \
"owned:N" is how many copies the player already has in their MTGA collection - N=0 means they'd need to craft it. \
Build ONE coherent, legal ${format} deck that matches the request as closely as possible, following these \
deckbuilding rules EXACTLY - a deck that breaks them is unplayable and useless, so count carefully before responding: \
1. The mainboard must total EXACTLY ${mainboardSize} cards - not fewer, not more. Sum the counts yourself before answering. \
2. ${copyRule} \
3. The sideboard, if any, must have between 0 and 15 cards, and is also subject to rule 2. \
4. Include a real, functional mana base. ${landGuidance} \
5. Build a sensible mana curve for the archetype: enough cheap plays to function in the early turns, a \
reasonable top end, and don't overload any single mana value. Every nonland card should serve the deck's \
stated game plan (aggro, control, ramp, tempo, etc.) - prefer a smaller set of synergistic, mutually \
supporting cards (a consistent removal suite, a clear win condition, appropriate card advantage) over a \
scattershot pile of unrelated "good cards". Think about what the deck is actually trying to do on turns \
1 through 6+ before picking cards. \
Strongly prefer cards the player already owns. You may include a modest number of unowned cards \
(especially at rare/mythic where wildcards are precious in real MTGA economy) when they meaningfully \
improve the deck, and list those separately as suggestedCrafts with a one-line reason each. \
Only use arenaId values that appear in the candidate list. Basic lands are not in the list because they're \
always free to add in Arena - include them in the mainboard by name only, with a made-up arenaId of 0, and \
they count toward the ${mainboardSize}-card total like any other mainboard card. \
Put all of your deckbuilding explanation in the "reasoning" field of the JSON below (including your land \
count and curve reasoning) - do not write any text, greeting, or commentary before or after the JSON \
object. The very first character of your response must be '{' and the very last character must be '}'. \
Respond with ONLY that single JSON object, shaped exactly like:
{
  "deckName": string,
  "colors": string[],
  "archetype": string,
  "mainboard": [{ "arenaId": number, "name": string, "count": number }],
  "sideboard": [{ "arenaId": number, "name": string, "count": number }],
  "reasoning": string,
  "suggestedCrafts": [{ "arenaId": number, "name": string, "reason": string }]
}`;

  const user = `Format: ${format}\nRequest: ${description}\n\nCandidate cards:\n${candidateText}`;

  // Deckbuilding needs real arithmetic (land count, curve, copy limits) and
  // strategic reasoning (synergy, game plan), not just pattern completion -
  // thinking was previously disabled to work around an empty-response bug
  // (it was exhausting a too-small max_tokens before any text came out),
  // but that also removed the model's scratchpad for getting this right,
  // which produced decks with absurdly few lands and no coherent plan.
  // Re-enabled with real headroom instead: 16000 wasn't enough once
  // thinking was back on (a real, well-formed deck got cut off mid-list),
  // so this raises the ceiling further and switches to streaming, since
  // the SDK requires streaming at this max_tokens to avoid HTTP timeouts.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system,
    messages: [{ role: "user", content: user }],
  });
  const response = await stream.finalMessage();

  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  let deck;
  try {
    deck = extractJsonBlock(text);
  } catch (err) {
    throw new Error(`${err.message} (stop_reason: ${response.stop_reason})`);
  }

  const validArenaIds = new Set(candidates.map((c) => c.arenaId));
  deck.mainboard = filterKnownCards(deck.mainboard, validArenaIds);
  deck.sideboard = filterKnownCards(deck.sideboard, validArenaIds);
  deck.suggestedCrafts = filterKnownCards(deck.suggestedCrafts, validArenaIds);

  // Nothing above guarantees Claude actually followed the copy-limit and
  // deck-size rules stated in the prompt, so enforce them here rather
  // than trust the model's count.
  const clamped = clampCopyLimits(deck.mainboard, deck.sideboard, format);
  deck.mainboard = clamped.mainboard;
  deck.sideboard = clamped.sideboard;
  const legality = checkDeckLegality(deck, format);
  const manaBaseIssues = checkManaBase(deck.mainboard, cardDb);
  deck.legality = {
    valid: legality.valid && manaBaseIssues.length === 0,
    issues: [...legality.issues, ...manaBaseIssues],
    fixes: clamped.fixes,
  };

  return deck;
}
