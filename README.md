# MTGA Deckbuilder

A local web app that takes your **real MTG Arena collection** and turns a
plain-language deck request ("mono red aggro that curves out and burns
their face by turn 6") into a legal decklist built from cards you own —
plus a wildcard-cost breakdown for anything worth crafting.

There is no official MTGA collection API, and (unlike match/game data)
Arena's client no longer writes a full collection snapshot to `Player.log`
either — that log event existed at one point but doesn't appear in current
clients. So instead of auto-syncing, you paste in a collection list
yourself (see below for the formats it accepts). Nothing is sent to
Wizards/Arena; nothing modifies your client or save data.

## How it works

1. **Card database** — downloads Scryfall's bulk card data once, filtered
   down to cards that exist on Arena, and caches it locally
   (`data/scryfall-cache.json`).
2. **Your collection** — you paste a plain-text list of what you own
   (`4 Lightning Bolt`, one per line — see formats below) and it's parsed
   and cached (`data/collection.json`), keyed by card name. Arena
   ownership is name-based anyway: owning any printing of a card lets you
   play it, so which specific art/set you have doesn't matter here.
3. **Deck generation** — sends your description + format + a candidate
   card pool (your owned cards, plus a shortlist of powerful unowned ones)
   to Claude, which returns a structured decklist, reasoning, and a short
   list of specific cards worth crafting.
4. **Craft cost** — diffs the suggested mainboard against your collection
   and reports wildcards needed per rarity.

## Setup

```
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # required for deck generation
npm start
```

Then open `http://localhost:8934`.

### In the browser

1. Click **"Sync card database"** (first run downloads/filters Scryfall's
   full card set — can take a minute or two; re-run any time to refresh).
2. Paste your collection into the text box and click **"Import
   collection"**. Accepted formats, one entry per line:
   - `4 Lightning Bolt` — plain count + name
   - `4 Lightning Bolt (LEA) 161` — Arena's own deck-export format (the
     `(SET) number` part is ignored; only the name and count matter)
   - `Lightning Bolt,4` or `4,Lightning Bolt` — CSV, either column order
   - Duplicate names across lines are summed, so pasting multiple
     printings of the same card (each still just "count + name") is fine.
   - Unparseable lines (a CSV header row, blank lines, stray notes) are
     skipped rather than rejecting the whole paste.

   You can build this list from a third-party MTGA collection exporter,
   or just type in the cards you know you own.
3. Pick a format, describe the deck you want, click **Generate deck**.

## Project layout

```
server.js                 Express app / API routes
src/collectionImport.js    Pasted text -> collection {cardName: count}
src/scryfall.js            Scryfall bulk data -> local card cache, keyed by arenaId
src/deckbuilder.js         Builds the Claude prompt, parses the deck JSON back
src/craft.js               Decklist + collection -> wildcards needed by rarity
public/                    Static frontend (no build step)
```

## Known limitations

- Collection data is only as accurate/current as what you paste in — there's
  no live sync, so re-import after significant collection changes (packs
  opened, wildcards crafted) to keep craft-cost numbers accurate.
- The Scryfall `arena_id` field is what maps a card to Arena's internal
  `grpId`; a handful of cards (some Alchemy rebalances, very new sets)
  can lag behind if Scryfall's data hasn't caught up yet.
- Deck generation requires `ANTHROPIC_API_KEY`. There's currently no
  offline/rule-based fallback.
