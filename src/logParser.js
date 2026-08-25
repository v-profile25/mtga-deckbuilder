import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COLLECTION_MARKER = "PlayerInventory.GetPlayerCardsV3";

// Default Player.log locations per OS. MTGA must have
// "Detailed Logs (Plug-in Support)" enabled in its in-game options,
// otherwise these events are never written to the log.
export function defaultLogPaths() {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === "win32") {
    return [
      path.join(home, "AppData", "LocalLow", "Wizards Of The Coast", "MTGA", "Player.log"),
    ];
  }
  if (platform === "darwin") {
    return [
      path.join(home, "Library", "Logs", "Wizards Of The Coast", "MTGA", "Player.log"),
    ];
  }
  // MTGA doesn't officially support Linux, but Lutris/Wine setups land here.
  return [
    path.join(home, ".wine", "drive_c", "users", os.userInfo().username, "AppData", "LocalLow", "Wizards Of The Coast", "MTGA", "Player.log"),
  ];
}

export function findDefaultLogPath() {
  return defaultLogPaths().find((p) => fs.existsSync(p)) ?? null;
}

// Pull the JSON object immediately following `startIndex` by counting
// balanced braces (the log line itself isn't valid JSON, only the
// object embedded in it is).
function extractJsonObjectAfter(text, startIndex) {
  const braceStart = text.indexOf("{", startIndex);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const raw = text.slice(braceStart, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Parses a MTGA Player.log file and returns the player's collection as
 * { [grpId: string]: ownedCount }. Uses the LAST matching snapshot in the
 * file, since the client re-logs the full collection each time it changes.
 */
export function parseCollectionFromLog(logText) {
  let lastMatch = null;
  let searchFrom = 0;
  while (true) {
    const idx = logText.indexOf(COLLECTION_MARKER, searchFrom);
    if (idx === -1) break;
    const obj = extractJsonObjectAfter(logText, idx + COLLECTION_MARKER.length);
    if (obj && typeof obj === "object") lastMatch = obj;
    searchFrom = idx + COLLECTION_MARKER.length;
  }

  if (!lastMatch) return null;

  // Keys are grpId strings, values are owned counts. Filter out any
  // non-numeric noise defensively.
  const collection = {};
  for (const [grpId, count] of Object.entries(lastMatch)) {
    const n = Number(count);
    if (Number.isFinite(n) && n > 0) collection[grpId] = n;
  }
  return collection;
}

export function loadCollectionFromFile(logPath) {
  const text = fs.readFileSync(logPath, "utf8");
  const collection = parseCollectionFromLog(text);
  if (!collection) {
    throw new Error(
      `No "${COLLECTION_MARKER}" snapshot found in ${logPath}. ` +
      `Make sure "Detailed Logs (Plug-in Support)" is enabled in MTGA's ` +
      `Account settings, then restart the client and let it fully load ` +
      `your collection screen once before syncing again.`
    );
  }
  return collection;
}
