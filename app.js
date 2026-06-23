let speciesData = [];
let appMeta = {};
let currentTreeRoot = null;
let svg, g, zoomBehavior;
let map, markerLayer;
let activeView = "tree";

const NOTES_KEY = "plantFieldApp_notes_v3";
const LEGACY_NOTE_KEYS = ["plantFieldApp_notes_v1", "plantFieldApp_notes_v2", "plantFieldApp_notes", "plantNotes"];
const THEME_KEY = "plantFieldApp_theme_v3";
const MAPS_KEY = "plantFieldApp_maps_v1";
const PINK_THEME = {
  "--accent": "#ffa1c5",
  "--accent-dark": "#e879a8",
  "--tree-node": "#ffa1c5",
  "--tree-leaf": "#c95b8b",
  "--bg": "#ffffff",
  "--card": "#f8f4f6",
  "--text": "#222222"
};
const DB_NAME = "plantFieldAppImagesV3";
const DB_STORE = "images";

const state = {
  search: "",
  explo: "",
  plot: "",
  family: "",
  maxRank: ""
};

const MY_MAPS = [
  { label: "MyMap 1", mid: "1No9vsYRjBMmr3uNspwBWVYxgyU-LIoY" },
  { label: "MyMap 2", mid: "18939DEUMSrdZfEKHZOCaVxjwufvq8_U" },
  { label: "MyMap 3", mid: "16vot76zUddy8manj_mntBP3uwq0k77k" }
];

const rankOrder = ["kingdom", "phylum", "class", "order", "family", "genus", "species"];
const clean = x => (x ?? "").toString();
const prettyName = x => clean(x).replaceAll("_", " ").replace(/\s+/g, " ").trim();
const safeId = x => clean(x).replace(/[^A-Za-z0-9_.:-]/g, "_");
const taxonId = (rank, name) => `${rank}:${name}`;

function loadNotes() {
  return JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function migrateLegacyNotes() {
  const current = loadNotes();
  let changed = false;

  // 1) Merge old localStorage note objects into the current v3 key.
  LEGACY_NOTE_KEYS.forEach(key => {
    try {
      const old = JSON.parse(localStorage.getItem(key) || "{}");
      Object.entries(old).forEach(([oldId, value]) => {
        const newId = oldId.includes(":") ? oldId : `species:${oldId}`;
        if (!current[newId]) {
          current[newId] = value;
          changed = true;
        }
      });
    } catch (e) {
      console.warn("Could not migrate notes from", key, e);
    }
  });

  // 2) Some older versions saved species without the rank prefix.
  Object.entries({ ...current }).forEach(([id, value]) => {
    if (!id.includes(":")) {
      const newId = `species:${id}`;
      if (!current[newId]) {
        current[newId] = value;
        changed = true;
      }
    }
  });

  if (changed) saveNotes(current);
}

function loadTheme() {
  const saved = JSON.parse(localStorage.getItem(THEME_KEY) || "{}");
  Object.entries(saved).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}

function saveThemeVar(key, value) {
  const saved = JSON.parse(localStorage.getItem(THEME_KEY) || "{}");
  saved[key] = value;
  localStorage.setItem(THEME_KEY, JSON.stringify(saved));
  document.documentElement.style.setProperty(key, value);
}

async function loadData() {
  migrateLegacyNotes();
  loadTheme();
  const response = await fetch("data/species.json?v=" + Date.now());
  const raw = await response.json();
  appMeta = raw.meta || {};
  speciesData = raw.species || raw;

  document.getElementById("dataInfo").textContent =
    `${speciesData.length} Arten · ${appMeta.years || "2021–2023"} · max. Rank ${appMeta.max_rank || "–"}`;

  initFilters();
  initThemePanel();
  initViewTabs();
  initMapPanel();
  initTree();
  initLightbox();
  render();
}

function initFilters() {
  const searchInput = document.getElementById("searchInput");
  const exploFilter = document.getElementById("exploFilter");
  const plotFilter = document.getElementById("plotFilter");
  const familyFilter = document.getElementById("familyFilter");
  const rankFilter = document.getElementById("rankFilter");

  fillSelect(exploFilter, ["AEG", "HEG", "SEG"]);
  fillPlotSelect();
  fillSelect(familyFilter, unique(speciesData.map(d => d.family)).sort());

  rankFilter.max = appMeta.max_rank || "";

  searchInput.addEventListener("input", e => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  });

  exploFilter.addEventListener("change", e => {
    state.explo = e.target.value;
    state.plot = "";
    plotFilter.value = "";
    fillPlotSelect();
    render();
  });

  plotFilter.addEventListener("change", e => {
    state.plot = e.target.value;
    render();
  });

  familyFilter.addEventListener("change", e => {
    state.family = e.target.value;
    render();
  });

  rankFilter.addEventListener("input", e => {
    state.maxRank = e.target.value;
    render();
  });

  document.getElementById("resetFilters").addEventListener("click", () => {
    state.search = "";
    state.explo = "";
    state.plot = "";
    state.family = "";
    state.maxRank = "";
    searchInput.value = "";
    exploFilter.value = "";
    plotFilter.value = "";
    familyFilter.value = "";
    rankFilter.value = "";
    fillPlotSelect();
    render();
  });

  document.getElementById("expandAll").addEventListener("click", () => {
    expandAll(currentTreeRoot);
    updateTree(currentTreeRoot);
  });

  document.getElementById("collapseAll").addEventListener("click", () => {
    collapseBelowDepth(currentTreeRoot, 2);
    updateTree(currentTreeRoot);
  });

  document.getElementById("centerTree").addEventListener("click", centerTree);

  document.getElementById("exportNotes").addEventListener("click", exportAllLocalData);
  document.getElementById("importNotes").addEventListener("click", () => document.getElementById("importNotesFile").click());
  document.getElementById("importNotesFile").addEventListener("change", importAllLocalData);
}

function initThemePanel() {
  const panel = document.getElementById("themePanel");
  document.getElementById("themeToggle").addEventListener("click", () => panel.classList.toggle("hidden"));

  const map = {
    accentColor: "--accent",
    nodeColor: "--tree-node",
    leafColor: "--tree-leaf",
    bgColor: "--bg",
    cardColor: "--card",
    textColor: "--text"
  };

  Object.entries(map).forEach(([inputId, cssVar]) => {
    const input = document.getElementById(inputId);
    const current = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    if (current) input.value = current;
    input.addEventListener("input", e => saveThemeVar(cssVar, e.target.value));
  });

  document.getElementById("resetPinkTheme").addEventListener("click", () => {
    Object.entries(PINK_THEME).forEach(([key, value]) => saveThemeVar(key, value));
    Object.entries(map).forEach(([inputId, cssVar]) => {
      const input = document.getElementById(inputId);
      if (input && PINK_THEME[cssVar]) input.value = PINK_THEME[cssVar];
    });
  });
}

function fillPlotSelect() {
  const plotFilter = document.getElementById("plotFilter");
  const old = plotFilter.value;
  plotFilter.innerHTML = '<option value="">Alle</option>';

  const plots = unique(
    speciesData.flatMap(d => d.plots || [])
      .filter(p => !state.explo || clean(p).startsWith(state.explo))
  ).sort(plotSort);

  fillSelect(plotFilter, plots);
  if (plots.includes(old)) plotFilter.value = old;
}

function fillSelect(sel, values) {
  values.filter(Boolean).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function plotSort(a, b) {
  const order = { AEG: 1, HEG: 2, SEG: 3 };
  const pa = clean(a).slice(0, 3);
  const pb = clean(b).slice(0, 3);
  if ((order[pa] || 99) !== (order[pb] || 99)) return (order[pa] || 99) - (order[pb] || 99);
  return clean(a).localeCompare(clean(b), undefined, { numeric: true });
}

function initTree() {
  svg = d3.select("#tree")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%");

  g = svg.append("g").attr("transform", "translate(20,30)");

  zoomBehavior = d3.zoom()
  .scaleExtent([0.25, 4])
  .translateExtent([[-2500, -3500], [6000, 5000]])
  .extent([[0, 0], [window.innerWidth, window.innerHeight]])
  .on("zoom", event => g.attr("transform", event.transform));

  svg.call(zoomBehavior);
  centerTree();
}

function centerTree() {
  if (!svg || !zoomBehavior) return;
  svg.transition()
    .duration(250)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(24, 32).scale(1));
}

function passesFilters(d) {
  const searchTarget = [
    d.kingdom, d.phylum, d.class, d.order, d.family, d.genus,
    d.Species_original, d.display_name, d.display_name_pretty,
    d.scientificName, d.gbif_species
  ].join(" ").toLowerCase();

  const plotRanks = d.plot_ranks || [];

  const plotOk = !state.plot || plotRanks.some(p => p.Plot_ID === state.plot);
  const exploOk = !state.explo || plotRanks.some(p => clean(p.Plot_ID).startsWith(state.explo));

  const rankOk = !state.maxRank || plotRanks.some(p => {
    const plotMatch = !state.plot || p.Plot_ID === state.plot;
    const exploMatch = !state.explo || clean(p.Plot_ID).startsWith(state.explo);
    return plotMatch && exploMatch && Number(p.Rank_2021_2023) <= Number(state.maxRank);
  });

  return (!state.search || searchTarget.includes(state.search)) &&
         plotOk &&
         exploOk &&
         (!state.family || d.family === state.family) &&
         rankOk;
}

function render() {
  const filtered = speciesData.filter(passesFilters);
  const plots = unique(filtered.flatMap(d => d.plots || []));

  document.getElementById("matchCount").textContent =
    `${filtered.length} Arten angezeigt · ${plots.length} Plots`;

  const treeData = buildTree(filtered);
  currentTreeRoot = d3.hierarchy(treeData);

  collapseBelowDepth(
    currentTreeRoot,
    state.search || state.plot || state.family || state.explo || state.maxRank ? 99 : 2
  );

  updateTree(currentTreeRoot);
}

function buildTree(rows) {
  const root = { name: "Plantae", rank: "root", taxonId: "root:Plantae", rows, children: [] };

  rows.forEach(row => {
    let node = root;

    rankOrder.forEach(rank => {
      const name = rank === "species" ? row.Species_original : clean(row[rank]) || `unknown ${rank}`;
      if (!node.children) node.children = [];

      let child = node.children.find(c => c.rank === rank && c.name === name);
      if (!child) {
        child = {
          name,
          rank,
          taxonId: taxonId(rank, name),
          rows: [],
          children: []
        };
        node.children.push(child);
      }
      child.rows.push(row);
      node = child;
    });

    node.speciesMeta = row;
    delete node.children;
  });

  sortTree(root);
  return root;
}

function sortTree(node) {
  if (!node.children) return;
  node.children.sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  node.children.forEach(sortTree);
}

function displayTaxonName(meta) {
  if (!meta) return "";
  if (meta.rank === "species") {
    const row = meta.speciesMeta || (meta.rows || [])[0] || {};
    return row.display_name_pretty || prettyName(meta.name);
  }
  return prettyName(meta.name);
}

function displaySpeciesName(row) {
  return row?.display_name_pretty || prettyName(row?.Species_original || row?.display_name || row?.scientificName || "");
}

function collapseBelowDepth(root, depth) {
  root.each(d => {
    if (d.depth >= depth && d.children) {
      d._children = d.children;
      d.children = null;
    }
  });
}

function expandAll(root) {
  root.each(d => {
    if (d._children) {
      d.children = d._children;
      d._children = null;
    }
  });
}

function updateTree(root) {
  g.selectAll("*").remove();
  const tree = d3.tree().nodeSize([28, 180]);
  tree(root);

  const nodes = root.descendants();
  const links = root.links();

  g.selectAll(".link")
    .data(links)
    .enter()
    .append("path")
    .attr("class", "link")
    .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

  const node = g.selectAll(".node")
    .data(nodes)
    .enter()
    .append("g")
    .attr("class", d => `node ${d.data.rank === "species" ? "leaf" : ""}`)
    .attr("transform", d => `translate(${d.y},${d.x})`)
    .on("click", (event, d) => {
      event.stopPropagation();
      showTaxon(d.data);
      if (d.children) {
        d._children = d.children;
        d.children = null;
      } else if (d._children) {
        d.children = d._children;
        d._children = null;
      }
      updateTree(root);
    });

  node.append("circle").attr("r", 4.8);
  node.append("text")
    .attr("x", 9)
    .attr("dy", 4)
    .text(d => displayTaxonName(d.data) + (d._children ? " +" : ""));
}

async function showTaxon(meta) {
  const rank = meta.rank || "taxon";
  const name = meta.name || "unknown";
  const displayName = displayTaxonName(meta);
  const id = meta.taxonId || taxonId(rank, name);
  const rows = meta.rows || [];
  const isSpecies = rank === "species";
  const speciesRow = isSpecies ? (meta.speciesMeta || rows[0]) : null;

  const notes = loadNotes();
  const saved = notes[id] || {};

  const fieldChars = saved.field_characteristics ?? "";
  const confusion = saved.confusion_species ?? "";
  const extraNotes = saved.notes ?? "";
  const difficulty = saved.difficulty ?? "";

  const allPlots = unique(rows.flatMap(d => d.plots || [])).sort(plotSort);
  const selectedPlotRank = isSpecies && state.plot && speciesRow?.plot_ranks
    ? speciesRow.plot_ranks.find(p => p.Plot_ID === state.plot)
    : null;

  const rankRows = isSpecies
    ? selectedPlotRank
      ? `<tr><th>Plot</th><td>${selectedPlotRank.Plot_ID}</td></tr>
         <tr><th>Rank</th><td>${selectedPlotRank.Rank_2021_2023}</td></tr>
         <tr><th>Mean Cover</th><td>${formatNumber(selectedPlotRank.Mean_Cover_2021_2023)}</td></tr>`
      : `<tr><th>Plots</th><td>${allPlots.join(", ") || "–"}</td></tr>
         <tr><th>Rank</th><td>Rank wird angezeigt, wenn ein Plot gefiltert ist. Bester Rank: ${speciesRow?.min_rank_2021_2023 ?? "–"}</td></tr>`
    : `<tr><th>Arten</th><td>${unique(rows.map(d => d.Species_original)).length}</td></tr>
       <tr><th>Plots</th><td>${allPlots.join(", ") || "–"}</td></tr>`;

  const taxonomyText = isSpecies
    ? [speciesRow?.class, speciesRow?.order, speciesRow?.family, speciesRow?.genus, prettyName(speciesRow?.Species_original)].filter(Boolean).join(" › ")
    : `${rank}: ${displayName}`;

  const viewer = document.getElementById("viewer");
  viewer.innerHTML = `
    <h2 class="taxon-title">${isSpecies ? `<em>${escapeHtml(displayName)}</em>` : escapeHtml(displayName)}</h2>
    <div class="badges">
      ${badge(rank)}
      ${isSpecies && speciesRow?.family ? badge(speciesRow.family) : ""}
      ${isSpecies && speciesRow?.genus ? badge(speciesRow.genus) : ""}
      ${difficulty ? badge(difficulty) : ""}
    </div>

    <table class="detail-table">
      ${rankRows}
      <tr><th>Taxonomie</th><td>${escapeHtml(taxonomyText)}</td></tr>
      ${isSpecies ? `<tr><th>GBIF</th><td>${escapeHtml(speciesRow?.scientificName || "–")}</td></tr>` : ""}
    </table>

    <h3>Bestimmungsmerkmale</h3>
    <textarea id="fieldCharsInput" class="edit-box" placeholder="Merkmale für ${escapeHtml(displayName)} eintragen...">${escapeHtml(fieldChars)}</textarea>

    <h3>Verwechslung / Abgrenzung</h3>
    <textarea id="confusionInput" class="edit-box" placeholder="Verwechslungsarten oder Abgrenzung eintragen...">${escapeHtml(confusion)}</textarea>

    <h3>Schwierigkeit</h3>
    <input id="difficultyInput" placeholder="leicht / mittel / schwer" value="${escapeHtml(difficulty)}">

    <h3>Notizen</h3>
    <textarea id="notesInput" class="edit-box" placeholder="Weitere Notizen...">${escapeHtml(extraNotes)}</textarea>

    <button id="saveTaxonNotes" class="save-button">Speichern</button>
    <span id="saveStatus" class="small"></span>

    <h3>Eigene Bilder</h3>
    <div class="photo-controls">
      <label class="photo-label" for="imageInput">Bild aufnehmen/hinzufügen</label>
      <input id="imageInput" type="file" accept="image/*" capture="environment">
    </div>
    <div class="image-grid" id="localImages">Lade Bilder...</div>

    ${isSpecies ? `<h3>iNaturalist Bilder</h3><div class="image-grid" id="inatImages">Lade Bilder...</div>` : ""}
  `;

  document.getElementById("saveTaxonNotes").addEventListener("click", () => saveTaxonNotes(id));
  document.getElementById("imageInput").addEventListener("change", e => addImageFromInput(id, e));
  await renderLocalImages(id);
  if (isSpecies) loadINaturalistImages(speciesRow?.Species_clean || speciesRow?.display_name_pretty || name);
}

function saveTaxonNotes(id) {
  const notes = loadNotes();
  notes[id] = {
    field_characteristics: document.getElementById("fieldCharsInput").value,
    confusion_species: document.getElementById("confusionInput").value,
    difficulty: document.getElementById("difficultyInput").value,
    notes: document.getElementById("notesInput").value,
    updated_at: new Date().toISOString()
  };
  saveNotes(notes);
  document.getElementById("saveStatus").textContent = "Gespeichert.";
  setTimeout(() => document.getElementById("saveStatus").textContent = "", 1500);
}

function badge(x) {
  return x ? `<span class="badge">${escapeHtml(x)}</span>` : "";
}

function escapeHtml(str) {
  return clean(str).replace(/[&<>'"]/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", "\"":"&quot;"}[c]));
}

function formatNumber(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "–";
  return Number(x).toFixed(2);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

async function getImages(taxonKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.filter(x => x.taxonKey === taxonKey));
    req.onerror = () => reject(req.error);
  });
}

async function saveImage(taxonKey, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).add({ taxonKey, dataUrl, created_at: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function clearImages(taxonKey) {
  const db = await openDB();
  const imgs = await getImages(taxonKey);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    imgs.forEach(img => store.delete(img.id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteImage(imageId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(imageId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllImages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function importImages(images) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    (images || []).forEach(img => {
      const copy = { ...img };
      delete copy.id;
      store.add(copy);
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function renderLocalImages(taxonKey) {
  const target = document.getElementById("localImages");
  if (!target) return;
  const imgs = await getImages(taxonKey);
  target.innerHTML = imgs.length
    ? imgs.map(img => `
        <figure class="image-tile">
          <img src="${img.dataUrl}" loading="lazy" alt="Eigenes Bild">
          <button class="delete-image" data-id="${img.id}" type="button">Löschen</button>
        </figure>
      `).join("")
    : "<p class='small'>Keine eigenen Bilder hinterlegt.</p>";

  target.querySelectorAll(".delete-image").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteImage(Number(btn.dataset.id));
      await renderLocalImages(taxonKey);
    });
  });
}

function addImageFromInput(taxonKey, event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    await saveImage(taxonKey, e.target.result);
    await renderLocalImages(taxonKey);
  };
  reader.readAsDataURL(file);
}

async function loadINaturalistImages(name) {
  const target = document.getElementById("inatImages");
  if (!target) return;
  try {
    const url = "https://api.inaturalist.org/v1/observations?taxon_name=" +
      encodeURIComponent(name) +
      "&quality_grade=research&photos=true&place_id=7207&per_page=6&captive=false";
    const response = await fetch(url);
    const data = await response.json();
    const imgs = (data.results || [])
      .filter(o => o.photos && o.photos.length)
      .slice(0, 6)
      .map(o => o.photos[0].url.replace("square", "medium"));
    target.innerHTML = imgs.length
      ? imgs.map(src => `<img class="inat-img" src="${src}" data-full="${src.replace("medium", "large")}" loading="lazy" alt="iNaturalist Bild">`).join("")
      : "<p class='small'>Keine iNaturalist-Bilder gefunden.</p>";
    target.querySelectorAll(".inat-img").forEach(img => {
      img.addEventListener("click", () => openLightbox(img.dataset.full || img.src));
    });
  } catch (e) {
    target.innerHTML = "<p class='small'>iNaturalist konnte nicht geladen werden.</p>";
  }
}


function initViewTabs() {
  const treeTab = document.getElementById("treeTab");
  const mapTab = document.getElementById("mapTab");
  const treePanel = document.getElementById("treePanel");
  const mapPanel = document.getElementById("mapPanel");

  treeTab.addEventListener("click", () => {
    activeView = "tree";
    treePanel.classList.remove("hidden");
    mapPanel.classList.add("hidden");
    treeTab.classList.add("active-tab");
    mapTab.classList.remove("active-tab");
  });

  mapTab.addEventListener("click", () => {
    activeView = "map";
    treePanel.classList.add("hidden");
    mapPanel.classList.remove("hidden");
    mapTab.classList.add("active-tab");
    treeTab.classList.remove("active-tab");
    setTimeout(() => map?.invalidateSize(), 50);
  });
}

function initLightbox() {
  document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", e => {
    if (e.target.id === "lightbox") closeLightbox();
  });
}

function openLightbox(src) {
  document.getElementById("lightboxImg").src = src;
  document.getElementById("lightbox").classList.remove("hidden");
}

function closeLightbox() {
  document.getElementById("lightbox").classList.add("hidden");
  document.getElementById("lightboxImg").src = "";
}

function initMapPanel() {
  if (!window.L) {
    document.getElementById("mapStatus").textContent = "Leaflet konnte nicht geladen werden.";
    return;
  }

  map = L.map("map").setView([51.2, 10.2], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  document.getElementById("loadMyMaps").addEventListener("click", loadDefaultMyMaps);
  document.getElementById("kmlInput").addEventListener("change", loadMapFiles);
  document.getElementById("clearMapLayers").addEventListener("click", () => {
    markerLayer.clearLayers();
    localStorage.removeItem(MAPS_KEY);
    document.getElementById("mapStatus").textContent = "Karte geleert.";
  });

  loadSavedMapMarkers();
}

function myMapsKmlUrl(mid) {
  return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`;
}

async function loadDefaultMyMaps() {
  markerLayer.clearLayers();
  let allMarkers = [];
  for (const m of MY_MAPS) {
    try {
      const res = await fetch(myMapsKmlUrl(m.mid));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const markers = parseKmlMarkers(text, m.label);
      allMarkers = allMarkers.concat(markers);
    } catch (e) {
      console.warn("MyMaps konnte nicht geladen werden", m, e);
    }
  }

  if (!allMarkers.length) {
    document.getElementById("mapStatus").textContent = "MyMaps konnte nicht direkt geladen werden. Exportiere die Karten als KML und importiere sie über den Button.";
    return;
  }

  addMarkersToMap(allMarkers);
  saveMapMarkers(allMarkers);
  document.getElementById("mapStatus").textContent = `${allMarkers.length} Plot-Marker geladen.`;
}

function loadMapFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  markerLayer.clearLayers();
  const loaded = [];
  let remaining = files.length;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const markers = file.name.toLowerCase().endsWith(".kml")
          ? parseKmlMarkers(text, file.name)
          : parseGeoJsonMarkers(JSON.parse(text), file.name);
        loaded.push(...markers);
      } catch (err) {
        console.warn("Kartenimport fehlgeschlagen", file.name, err);
      }
      remaining -= 1;
      if (remaining === 0) {
        addMarkersToMap(loaded);
        saveMapMarkers(loaded);
        document.getElementById("mapStatus").textContent = `${loaded.length} Marker importiert.`;
      }
    };
    reader.readAsText(file);
  });
}

function parseKmlMarkers(text, source = "KML") {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  return placemarks.map(pm => {
    const name = pm.getElementsByTagName("name")[0]?.textContent || source;
    const coords = pm.getElementsByTagName("coordinates")[0]?.textContent?.trim();
    if (!coords) return null;
    const [lon, lat] = coords.split(/\s+/)[0].split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { name, lat, lon, plotId: extractPlotId(name), source };
  }).filter(Boolean);
}

function parseGeoJsonMarkers(geojson, source = "GeoJSON") {
  const features = geojson.type === "FeatureCollection" ? geojson.features : [geojson];
  return features.map(f => {
    const geom = f.geometry || {};
    if (geom.type !== "Point") return null;
    const [lon, lat] = geom.coordinates || [];
    const name = f.properties?.name || f.properties?.Name || f.properties?.title || source;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { name, lat, lon, plotId: extractPlotId(name), source };
  }).filter(Boolean);
}

function extractPlotId(text) {
  const m = clean(text).match(/\b(AEG|HEG|SEG)\s*0*(\d{1,2})\b/i);
  if (!m) return "";
  return `${m[1].toUpperCase()}${m[2].padStart(2, "0")}`;
}

function addMarkersToMap(markers) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const bounds = [];
  markers.forEach(m => {
    const marker = L.marker([m.lat, m.lon]).addTo(markerLayer);

if (m.plotId) {
  marker.bindTooltip(m.plotId, {
    permanent: true,
    direction: "top",
    offset: [0, -10],
    className: "plot-label"
  });
}
    const plotButton = m.plotId
      ? `<button class="popup-plot-button" data-plot="${m.plotId}">${m.plotId} filtern</button>`
      : `<span class="small">Keine Plot-ID im Namen gefunden</span>`;
    marker.bindPopup(`<strong>${escapeHtml(m.name)}</strong><br>${plotButton}`);
    marker.on("popupopen", e => {
      const btn = e.popup.getElement()?.querySelector(".popup-plot-button");
      if (btn) btn.addEventListener("click", () => setPlotFilter(btn.dataset.plot));
    });
    marker.on("click", () => {
      if (m.plotId) showPlotInfo(m.plotId);
    });
    bounds.push([m.lat, m.lon]);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
}

function saveMapMarkers(markers) {
  localStorage.setItem(MAPS_KEY, JSON.stringify(markers || []));
}

function loadSavedMapMarkers() {
  try {
    const markers = JSON.parse(localStorage.getItem(MAPS_KEY) || "[]");
    if (markers.length) addMarkersToMap(markers);
  } catch (e) {
    console.warn("Saved map markers could not be loaded", e);
  }
}

function setPlotFilter(plotId) {
  if (!plotId) return;
  const explo = clean(plotId).slice(0, 3);
  state.explo = explo;
  state.plot = plotId;
  document.getElementById("exploFilter").value = explo;
  fillPlotSelect();
  document.getElementById("plotFilter").value = plotId;
  render();
  showPlotInfo(plotId);
}

function showPlotInfo(plotId) {
  const box = document.getElementById("plotInfo");
  if (!box) return;
  const notes = loadNotes();
  const id = `plot:${plotId}`;
  const saved = notes[id] || {};
  const species = speciesData
    .filter(d => (d.plot_ranks || []).some(p => p.Plot_ID === plotId && (!state.maxRank || Number(p.Rank_2021_2023) <= Number(state.maxRank))))
    .sort((a, b) => {
      const ra = (a.plot_ranks || []).find(p => p.Plot_ID === plotId)?.Rank_2021_2023 ?? 999;
      const rb = (b.plot_ranks || []).find(p => p.Plot_ID === plotId)?.Rank_2021_2023 ?? 999;
      return Number(ra) - Number(rb);
    });

  box.classList.remove("hidden");
  box.innerHTML = `
    <h3>${plotId}</h3>
    <p class="small">${species.length} Arten${state.maxRank ? ` bis Rank ${state.maxRank}` : ""}</p>
    <textarea id="plotNotesInput" class="edit-box" placeholder="Plot-Notizen...">${escapeHtml(saved.notes || "")}</textarea>
    <button id="savePlotNotes" type="button">Plot-Notizen speichern</button>
    <ol class="plot-species-list">
      ${species.map(d => {
        const r = (d.plot_ranks || []).find(p => p.Plot_ID === plotId);
        return `<li><strong>${r?.Rank_2021_2023 ?? "–"}</strong> ${escapeHtml(displaySpeciesName(d))}</li>`;
      }).join("")}
    </ol>
  `;
  document.getElementById("savePlotNotes").addEventListener("click", () => {
    const all = loadNotes();
    all[id] = { notes: document.getElementById("plotNotesInput").value, updated_at: new Date().toISOString() };
    saveNotes(all);
    alert("Plot-Notizen gespeichert.");
  });
}

async function exportAllLocalData() {
  const notes = loadNotes();
  const images = await getAllImages();
  const exportObject = {
    exported_at: new Date().toISOString(),
    app: "plant-field-app-final",
    notes,
    images
  };

  const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `plant_app_backup_${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert(`Backup exportiert: ${a.download}\n\nDie Datei liegt normalerweise im Downloads-Ordner.`);
}

function importAllLocalData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const imported = JSON.parse(e.target.result);
      const mergedNotes = { ...loadNotes(), ...(imported.notes || imported) };
      saveNotes(mergedNotes);
      if (imported.images) await importImages(imported.images);
      alert("Notizen/Bilder wurden importiert.");
    } catch (err) {
      alert("Import fehlgeschlagen. Die Datei konnte nicht gelesen werden.");
    }
  };
  reader.readAsText(file);
}

loadData();
