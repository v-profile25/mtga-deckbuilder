const $ = (id) => document.getElementById(id);

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}
function clearError() {
  $("error").classList.add("hidden");
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

async function refreshCardsStatus() {
  const data = await api("GET", "/api/cards/status");
  $("cardsStatus").textContent = data.cached
    ? `synced (${(data.stat.sizeBytes / 1e6).toFixed(1)} MB, ${new Date(data.stat.mtime).toLocaleString()})`
    : "not synced yet";
}

async function refreshCollectionStatus() {
  try {
    const data = await api("GET", "/api/collection");
    $("collectionStatus").textContent = `imported (${data.cardCount} unique cards)`;
  } catch {
    $("collectionStatus").textContent = "not imported yet";
  }
}

$("syncCards").addEventListener("click", async () => {
  clearError();
  $("syncCards").disabled = true;
  $("cardsStatus").textContent = "downloading Scryfall bulk data, this can take a minute...";
  try {
    await api("POST", "/api/cards/sync", { force: true });
    await refreshCardsStatus();
  } catch (err) {
    showError(err.message);
  } finally {
    $("syncCards").disabled = false;
  }
});

async function importCollectionText(text, button) {
  clearError();
  if (!text.trim()) {
    showError("That collection text is empty.");
    return;
  }
  button.disabled = true;
  try {
    await api("POST", "/api/collection/import", { text });
    await refreshCollectionStatus();
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

$("importCollection").addEventListener("click", () => {
  importCollectionText($("collectionText").value, $("importCollection"));
});

$("importCollectionFile").addEventListener("click", () => {
  $("collectionFileInput").click();
});

$("collectionFileInput").addEventListener("change", async () => {
  const file = $("collectionFileInput").files[0];
  if (!file) return;
  const text = await file.text();
  await importCollectionText(text, $("importCollectionFile"));
  $("collectionFileInput").value = ""; // allow re-selecting the same file later
});

function renderDecklist(el, entries) {
  el.innerHTML = "";
  for (const entry of entries || []) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${entry.count}x ${entry.name}</span>`;
    el.appendChild(li);
  }
}

function renderMissing(el, missing) {
  el.innerHTML = "";
  for (const m of missing) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${m.name} <span class="status">(${m.rarity})</span></span><span class="need">need ${m.need}</span>`;
    el.appendChild(li);
  }
}

function renderSuggestedCrafts(el, entries) {
  el.innerHTML = "";
  for (const s of entries || []) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${s.name}</span><span class="status">${s.reason || ""}</span>`;
    el.appendChild(li);
  }
}

$("generate").addEventListener("click", async () => {
  clearError();
  const description = $("description").value.trim();
  const format = $("format").value;
  if (!description) {
    showError("Describe the deck you want first.");
    return;
  }
  const maxWildcardsValue = $("maxWildcards").value.trim();
  const maxRareMythicWildcards = maxWildcardsValue === "" ? undefined : Number(maxWildcardsValue);

  $("generate").disabled = true;
  $("generate").textContent = "Generating...";
  try {
    const { deck, craftCost, arenaImport } = await api("POST", "/api/deck/generate", {
      description,
      format,
      maxRareMythicWildcards,
    });

    $("deckName").textContent = `${deck.deckName} (${(deck.colors || []).join("")}) — ${deck.archetype || ""}`;
    $("reasoning").textContent = deck.reasoning || "";
    $("arenaImport").value = arenaImport || "";
    $("copyStatus").textContent = "";
    renderDecklist($("mainboard"), deck.mainboard);
    renderDecklist($("sideboard"), deck.sideboard);

    const legalityMessages = [...(deck.legality?.fixes || []), ...(deck.legality?.issues || [])];
    if (legalityMessages.length > 0) {
      $("legalityMessages").innerHTML = legalityMessages.map((m) => `<li>${m}</li>`).join("");
      $("legality").classList.remove("hidden");
    } else {
      $("legality").classList.add("hidden");
    }

    const { common, uncommon, rare, mythic } = craftCost.wildcardsNeeded;
    $("wildcardSummary").textContent =
      `Wildcards needed: ${common} common, ${uncommon} uncommon, ${rare} rare, ${mythic} mythic.`;
    renderMissing($("missingList"), craftCost.missing);
    renderSuggestedCrafts($("suggestedCrafts"), deck.suggestedCrafts);

    $("result").classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    $("generate").disabled = false;
    $("generate").textContent = "Generate deck";
  }
});

$("copyArenaImport").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("arenaImport").value);
    $("copyStatus").textContent = "Copied!";
  } catch {
    $("arenaImport").select();
    $("copyStatus").textContent = "Couldn't auto-copy - text is selected, press Ctrl/Cmd+C.";
  }
});

refreshCardsStatus();
refreshCollectionStatus();
