const RARITIES = ["common", "uncommon", "rare", "mythic"];

/**
 * Given a decklist [{ arenaId, count }], the owned collection
 * { [arenaId]: ownedCount }, and the card db (Map<arenaId, card>),
 * returns what's missing and how many wildcards of each rarity it costs.
 * Basic lands are free to add in Arena and are excluded from craft costs.
 */
export function computeCraftCost(decklist, collection, cardDb) {
  const missing = [];
  const wildcardsNeeded = { common: 0, uncommon: 0, rare: 0, mythic: 0 };

  for (const { arenaId, count } of decklist) {
    const card = cardDb.get(arenaId);
    if (!card) continue;
    if (card.typeLine?.includes("Basic Land")) continue;

    const owned = collection[arenaId] ?? collection[String(arenaId)] ?? 0;
    const need = Math.max(0, count - owned);
    if (need <= 0) continue;

    const rarity = RARITIES.includes(card.rarity) ? card.rarity : "common";
    wildcardsNeeded[rarity] += need;
    missing.push({
      arenaId,
      name: card.name,
      rarity,
      owned,
      required: count,
      need,
    });
  }

  return { missing, wildcardsNeeded };
}
