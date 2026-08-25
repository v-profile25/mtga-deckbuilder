# MTGA Deckbuilder

A local web app that reads your **real MTG Arena collection** and turns a
plain-language deck request ("mono red aggro that curves out and burns
their face by turn 6") into a legal decklist built from cards you own —
plus a wildcard-cost breakdown for anything worth crafting.

There is no official MTGA API, so this works the same way community tools
like Untapped.gg and MTGA Pro Tracker do: it reads the collection snapshot
that the Arena client already writes to its own log file on your machine.
Nothing is sent to Wizards/Arena; nothing modifies your client or save data.

## How it works

1. **Card database** — downloads Scryfall's bulk card data once, filtered
   down to cards that exist on Arena, and caches it locally
   (`data/scryfall-cache.json`).
2. **Your collection** — parses `Player.log` for the
   `PlayerInventory.GetPlayerCardsV3` snapshot the client logs (grpId →
   owned count) and caches it (`data/collection.json`).
3. **Deck generation** — sends your description + format + a candidate
   card pool (your owned cards, plus a shortlist of powerful unowned ones)
   to Claude, which returns a structured decklist, reasoning, and a short
   list of specific cards worth crafting.
4. **Craft cost** — diffs the suggested mainboard against your collection
   and reports wildcards needed per rarity.

## Setup

### 1. Enable detailed logging in MTGA

In the Arena client: **Options → Account → enable "Detailed Logs (Plug-in
Support)"**, then restart the client and let your Collection screen load
once. Without this, `Player.log` won't contain the collection snapshot.

### 2. Install and configure

```
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # required for deck generation
npm start
```

Then open `http://localhost:8934`.

### 3. In the browser

1. Click **"Sync card database"** (first run downloads/filters Scryfall's
   full card set — can take a minute or two; re-run any time to refresh).
2. Click **"Sync my collection"**. It auto-detects `Player.log`'s default
   path for your OS:
   - Windows: `%USERPROFILE%\AppData\LocalLow\Wizards Of The Coast\MTGA\Player.log`
   - macOS: `~/Library/Logs/Wizards Of The Coast/MTGA/Player.log`

   If it's somewhere else, paste the full path into the "Custom log path"
   field first.
3. Pick a format, describe the deck you want, click **Generate deck**.

## Project layout

```
server.js           Express app / API routes
src/logParser.js     Player.log -> collection {grpId: count}
src/scryfall.js       Scryfall bulk data -> local card cache, keyed by arenaId
src/deckbuilder.js    Builds the Claude prompt, parses the deck JSON back
src/craft.js          Decklist + collection -> wildcards needed by rarity
public/               Static frontend (no build step)
```

## Known limitations

- Arena has no login/collection API, so "sync" always means re-reading
  the local log file — there's no way to check your collection from a
  machine that isn't running (or hasn't recently run) the Arena client.
- The Scryfall `arena_id` field is what maps a card to Arena's internal
  `grpId`; a handful of cards (some Alchemy rebalances, very new sets)
  can lag behind if Scryfall's data hasn't caught up yet.
- Deck generation requires `ANTHROPIC_API_KEY`. There's currently no
  offline/rule-based fallback.
