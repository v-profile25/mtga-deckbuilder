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
    await api("POST", "/api/cards/sync", {});
    await refreshCardsStatus();
  } catch (err) {
    showError(err.message);
  } finally {
    $("syncCards").disabled = false;
  }
});

$("importCollection").addEventListener("click", async () => {
  clearError();
  const text = $("collectionText").value;
  if (!text.trim()) {
    showError("Paste your collection list first.");
    return;
  }
  $("importCollection").disabled = true;
  try {
    await api("POST", "/api/collection/import", { text });
    await refreshCollectionStatus();
  } catch (err) {
    showError(err.message);
  } finally {
    $("importCollection").disabled = false;
  }
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

  $("generate").disabled = true;
  $("generate").textContent = "Generating...";
  try {
    const { deck, craftCost } = await api("POST", "/api/deck/generate", { description, format });

    $("deckName").textContent = `${deck.deckName} (${(deck.colors || []).join("")}) — ${deck.archetype || ""}`;
    $("reasoning").textContent = deck.reasoning || "";
    renderDecklist($("mainboard"), deck.mainboard);
    renderDecklist($("sideboard"), deck.sideboard);

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

refreshCardsStatus();
refreshCollectionStatus();
