// MTGA's own deck-import format: a "Deck" section, an optional blank-line-
// separated "Sideboard" section, one "<count> <name>" per line. Arena
// accepts a bare name without a (SET) collector-number suffix, so this
// works for the basic lands in mainboard too (added by name only, with
// the arenaId:0 sentinel, since they're never in the candidate pool).
export function formatArenaImport(mainboard, sideboard) {
  const lines = ["Deck", ...(mainboard || []).map(({ count, name }) => `${count} ${name}`)];

  if (sideboard && sideboard.length > 0) {
    lines.push("", "Sideboard", ...sideboard.map(({ count, name }) => `${count} ${name}`));
  }

  return lines.join("\n");
}
