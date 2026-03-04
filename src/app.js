import { SecretNetworkClient } from "secretjs";

const CONTRACT_ADDRESS = "secret1vavc4azfjqkcs8rj0rkcl3v45c4ddu54jqfhhq";
const CHAIN_ID = "secret-4";
const LCD_URLS = [
  "https://rest.lavenderfive.com:443/secretnetwork",
  "https://secret.api.trivium.network:1317",
];
const VK_STORAGE_KEY = "redacted-club-vk";
const TOTAL_TOKENS = 1337;
const BASE = import.meta.env.BASE_URL;

const $ = (sel) => document.querySelector(sel);
const loading = $("#loading");
const loadingText = $("#loading-text");
const errorDiv = $("#error");
const emptyState = $("#empty");
const nftGrid = $("#nft-grid");
const resultCount = $("#result-count");
const totalCount = $("#total-count");
const btnConnect = $("#btn-connect");
const btnMyNfts = $("#btn-my-nfts");
const btnDisconnect = $("#btn-disconnect");
const addressBadge = $("#address-badge");
const addressText = $("#address-text");
const vkSetup = $("#vk-setup");
const btnSetVk = $("#btn-set-vk");
const filterList = $("#filter-list");
const btnClearFilters = $("#btn-clear-filters");
const searchInput = $("#search-input");
const modalOverlay = $("#modal-overlay");
const modalImage = $("#modal-image");
const modalName = $("#modal-name");
const modalId = $("#modal-id");
const modalTraits = $("#modal-traits");
const modalClose = $("#modal-close");
const sidebar = $("#sidebar");
const sidebarToggle = $("#sidebar-toggle");

let secretjs = null;
let myAddress = null;
let codeHash = null;
let metadata = {};
let hasMetadata = false;
let ownedTokens = new Set();
let showOnlyOwned = false;
let activeFilters = {};
let searchQuery = "";

const allTokenIds = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);

function show(el) {
  el.classList.add("visible");
}
function hide(el) {
  el.classList.remove("visible");
}
function showError(msg) {
  errorDiv.textContent = msg;
  show(errorDiv);
}
function truncateAddress(addr) {
  return addr.slice(0, 10) + "..." + addr.slice(-6);
}

function getStoredViewingKey(address) {
  try {
    const stored = JSON.parse(localStorage.getItem(VK_STORAGE_KEY) || "{}");
    return stored[address] || null;
  } catch {
    return null;
  }
}

function storeViewingKey(address, key) {
  try {
    const stored = JSON.parse(localStorage.getItem(VK_STORAGE_KEY) || "{}");
    stored[address] = key;
    localStorage.setItem(VK_STORAGE_KEY, JSON.stringify(stored));
  } catch (e) {
    console.warn("Failed to store viewing key:", e);
  }
}

function generateRandomKey() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Metadata ──

async function loadMetadata() {
  try {
    const resp = await fetch(`${BASE}metadata.json`);
    if (!resp.ok) throw new Error("not found");
    const data = await resp.json();
    metadata = data;
    hasMetadata = Object.keys(data).length > 0;
    if (hasMetadata) buildFilterUI();
  } catch {
    hasMetadata = false;
    filterList.innerHTML =
      '<div class="no-metadata-msg">' +
      "No metadata found. Run the fetch script to enable traits & filtering:" +
      "<code>node scripts/fetch-metadata.js</code>" +
      "</div>";
  }
}

function getTokenMeta(tokenId) {
  return metadata[tokenId] || { name: `Bunny #${tokenId}`, attributes: [] };
}

// ── Filter UI ──

function buildFilterUI() {
  const traitMap = {};
  for (const id of allTokenIds) {
    const meta = getTokenMeta(id);
    for (const attr of meta.attributes) {
      const type = attr.trait_type;
      const val = attr.value;
      if (!traitMap[type]) traitMap[type] = {};
      traitMap[type][val] = (traitMap[type][val] || 0) + 1;
    }
  }

  const sortedTypes = Object.keys(traitMap).sort();
  filterList.innerHTML = "";

  for (const type of sortedTypes) {
    const values = Object.entries(traitMap[type]).sort(
      ([, a], [, b]) => b - a
    );

    const group = document.createElement("div");
    group.className = "filter-group";

    const header = document.createElement("div");
    header.className = "filter-group-header";
    header.innerHTML = `<h3>${type}</h3><span class="chevron">▼</span>`;
    header.addEventListener("click", () => group.classList.toggle("collapsed"));

    const options = document.createElement("div");
    options.className = "filter-options";

    for (const [val, count] of values) {
      const label = document.createElement("label");
      label.className = "filter-option";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.traitType = type;
      cb.dataset.traitValue = val;
      cb.addEventListener("change", onFilterChange);

      const text = document.createTextNode(val);
      const countSpan = document.createElement("span");
      countSpan.className = "count";
      countSpan.textContent = count;

      label.append(cb, text, countSpan);
      options.appendChild(label);
    }

    group.append(header, options);
    filterList.appendChild(group);
  }
}

function onFilterChange() {
  activeFilters = {};
  const checkboxes = filterList.querySelectorAll("input:checked");
  for (const cb of checkboxes) {
    const type = cb.dataset.traitType;
    const val = cb.dataset.traitValue;
    if (!activeFilters[type]) activeFilters[type] = new Set();
    activeFilters[type].add(val);
  }

  const hasFilters = Object.keys(activeFilters).length > 0;
  btnClearFilters.classList.toggle("visible", hasFilters);
  renderGrid();
}

function clearFilters() {
  const checkboxes = filterList.querySelectorAll("input:checked");
  for (const cb of checkboxes) cb.checked = false;
  activeFilters = {};
  btnClearFilters.classList.remove("visible");
  renderGrid();
}

function tokenMatchesFilters(tokenId) {
  if (showOnlyOwned && !ownedTokens.has(String(tokenId))) return false;

  if (searchQuery) {
    const q = searchQuery;
    const id = String(tokenId);
    const name = getTokenMeta(tokenId).name.toLowerCase();
    if (!id.includes(q) && !name.includes(q)) return false;
  }

  const filterTypes = Object.keys(activeFilters);
  if (filterTypes.length === 0) return true;

  const meta = getTokenMeta(tokenId);
  const attrMap = {};
  for (const a of meta.attributes) {
    attrMap[a.trait_type] = a.value;
  }

  for (const type of filterTypes) {
    const allowed = activeFilters[type];
    if (!allowed.has(attrMap[type])) return false;
  }
  return true;
}

// ── Rendering ──

function renderGrid() {
  nftGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let count = 0;

  for (const tokenId of allTokenIds) {
    if (!tokenMatchesFilters(tokenId)) continue;
    fragment.appendChild(createCard(tokenId));
    count++;
  }

  if (count === 0) {
    show(emptyState);
  } else {
    hide(emptyState);
  }

  nftGrid.appendChild(fragment);
  resultCount.textContent = count;
}

function createCard(tokenId) {
  const meta = getTokenMeta(tokenId);
  const card = document.createElement("div");
  card.className = "nft-card";
  if (ownedTokens.has(String(tokenId))) card.classList.add("owned");

  const img = document.createElement("img");
  img.src = `${BASE}allBunnies/${tokenId}.webp`;
  img.alt = meta.name;
  img.loading = "lazy";
  img.onerror = () => {
    img.style.display = "none";
    const ph = document.createElement("div");
    ph.style.cssText =
      "width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--surface-hover);color:var(--text-muted);font-size:0.8rem;";
    ph.textContent = "Image not found";
    card.insertBefore(ph, card.firstChild);
  };

  const info = document.createElement("div");
  info.className = "card-info";

  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = meta.name;

  const id = document.createElement("span");
  id.className = "card-id";
  id.textContent = `#${tokenId}`;

  const badge = document.createElement("span");
  badge.className = "owned-badge";
  badge.textContent = "OWNED";

  info.append(name, badge, id);
  card.append(img, info);

  card.addEventListener("click", () => openModal(tokenId));
  return card;
}

// ── Modal ──

function openModal(tokenId) {
  const meta = getTokenMeta(tokenId);
  modalImage.src = `${BASE}allBunnies/${tokenId}.webp`;
  modalImage.alt = meta.name;
  modalName.textContent = meta.name;
  modalId.textContent = `#${tokenId}`;

  if (meta.attributes.length > 0) {
    const grid = document.createElement("div");
    grid.className = "traits-grid";
    for (const attr of meta.attributes) {
      const card = document.createElement("div");
      card.className = "trait-card";

      const type = document.createElement("div");
      type.className = "trait-type";
      type.textContent = attr.trait_type;

      const val = document.createElement("div");
      val.className = "trait-value";
      val.textContent = attr.value;

      card.append(type, val);
      grid.appendChild(card);
    }
    modalTraits.innerHTML = "";
    modalTraits.appendChild(grid);
  } else {
    modalTraits.innerHTML = '<div class="no-traits">No trait data available</div>';
  }

  show(modalOverlay);
  document.body.style.overflow = "hidden";
}

function closeModal() {
  hide(modalOverlay);
  document.body.style.overflow = "";
}

// ── Keplr / Wallet ──

async function waitForKeplr(timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (window.keplr && window.getOfflineSigner && window.getEnigmaUtils)
      return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!window.keplr;
}

async function createClientWithFallback(keplrOfflineSigner, address) {
  for (const url of LCD_URLS) {
    try {
      const client = new SecretNetworkClient({
        url,
        chainId: CHAIN_ID,
        wallet: keplrOfflineSigner,
        walletAddress: address,
        encryptionUtils: window.keplr.getEnigmaUtils(CHAIN_ID),
      });

      const hashResult =
        await client.query.compute.codeHashByContractAddress({
          contract_address: CONTRACT_ADDRESS,
        });

      codeHash =
        typeof hashResult === "string"
          ? hashResult
          : hashResult?.code_hash ||
            hashResult?.codeHash ||
            String(hashResult);
      return client;
    } catch (e) {
      console.warn(`Endpoint ${url} failed:`, e.message);
    }
  }
  throw new Error(
    "All Secret Network endpoints are unreachable. Please try again later."
  );
}

async function connectKeplr() {
  hide(errorDiv);

  const keplrReady = await waitForKeplr();
  if (!keplrReady) {
    showError(
      "Keplr wallet not detected. Please install the Keplr browser extension and refresh."
    );
    return;
  }

  show(loading);
  loadingText.textContent = "Connecting to Keplr...";

  try {
    await window.keplr.enable(CHAIN_ID);
  } catch {
    hide(loading);
    showError("Connection rejected. Please approve the Keplr request.");
    return;
  }

  try {
    const keplrOfflineSigner =
      window.keplr.getOfflineSignerOnlyAmino(CHAIN_ID);
    const accounts = await keplrOfflineSigner.getAccounts();
    myAddress = accounts[0].address;

    addressText.textContent = truncateAddress(myAddress);
    show(addressBadge);
    btnConnect.textContent = "Connected";
    btnConnect.disabled = true;
    btnDisconnect.style.display = "";
    btnMyNfts.style.display = "";

    loadingText.textContent = "Finding a working endpoint...";
    secretjs = await createClientWithFallback(keplrOfflineSigner, myAddress);
    hide(loading);

    const existingKey = getStoredViewingKey(myAddress);
    if (existingKey) {
      await loadOwnedNFTs(existingKey);
    } else {
      show(vkSetup);
    }
  } catch (e) {
    hide(loading);
    showError(e.message);
    console.error("Connection error:", e);
  }
}

async function setViewingKey() {
  hide(vkSetup);
  hide(errorDiv);
  show(loading);
  loadingText.textContent = "Approve the transaction in Keplr...";

  try {
    const viewingKey = generateRandomKey();

    const tx = await secretjs.tx.compute.executeContract(
      {
        contract_address: CONTRACT_ADDRESS,
        code_hash: codeHash,
        sender: myAddress,
        msg: { set_viewing_key: { key: viewingKey } },
      },
      { gasLimit: 50_000 }
    );

    if (tx.code !== 0)
      throw new Error(tx.rawLog || "Transaction failed on-chain");

    storeViewingKey(myAddress, viewingKey);
    loadingText.textContent = "Viewing key set! Loading your NFTs...";
    await loadOwnedNFTs(viewingKey);
  } catch (e) {
    hide(loading);
    console.error("Set viewing key error:", e);

    if (e.message?.includes("Request rejected")) {
      show(vkSetup);
      showError("Transaction rejected. You can try again when ready.");
    } else {
      showError(`Failed to set viewing key: ${e.message}`);
    }
  }
}

async function loadOwnedNFTs(viewingKey) {
  show(loading);
  hide(errorDiv);
  hide(vkSetup);
  loadingText.textContent = "Querying your NFTs...";

  try {
    const tokens = await queryAllTokens(viewingKey);
    ownedTokens = new Set(tokens);
    hide(loading);
    renderGrid();
  } catch (e) {
    hide(loading);
    console.error("Query error:", e);

    const msg = e.message || "";
    if (
      msg.includes("viewing key") ||
      msg.includes("Wrong viewing key") ||
      msg.includes("unauthorized")
    ) {
      localStorage.removeItem(VK_STORAGE_KEY);
      show(vkSetup);
      showError(
        "Viewing key is invalid or expired. Please create a new one."
      );
    } else {
      showError(`Failed to load NFTs: ${msg}`);
    }
  }
}

async function queryAllTokens(viewingKey) {
  const allTokens = [];
  let startAfter = null;
  const limit = 30;

  while (true) {
    const tokensQuery = {
      owner: myAddress,
      viewer: myAddress,
      viewing_key: viewingKey,
      limit,
    };
    if (startAfter) tokensQuery.start_after = startAfter;

    const result = await secretjs.query.compute.queryContract({
      contract_address: CONTRACT_ADDRESS,
      code_hash: codeHash,
      query: { tokens: tokensQuery },
    });

    const tokens =
      result?.token_list?.tokens || result?.tokens?.tokens || [];
    if (tokens.length === 0) break;

    allTokens.push(...tokens);
    loadingText.textContent = `Found ${allTokens.length} NFTs so far...`;
    if (tokens.length < limit) break;
    startAfter = tokens[tokens.length - 1];
  }

  return allTokens;
}

function disconnect() {
  secretjs = null;
  myAddress = null;
  codeHash = null;
  ownedTokens = new Set();
  showOnlyOwned = false;

  hide(addressBadge);
  hide(vkSetup);
  hide(errorDiv);
  btnConnect.textContent = "Connect Keplr";
  btnConnect.disabled = false;
  btnDisconnect.style.display = "none";
  btnMyNfts.style.display = "none";
  btnMyNfts.classList.remove("active");
  renderGrid();
}

function toggleMyNfts() {
  showOnlyOwned = !showOnlyOwned;
  btnMyNfts.classList.toggle("active", showOnlyOwned);
  btnMyNfts.textContent = showOnlyOwned ? "All NFTs" : "My NFTs";
  renderGrid();
}

// ── Init ──

async function init() {
  totalCount.textContent = TOTAL_TOKENS;
  show(loading);
  loadingText.textContent = "Loading collection...";

  await loadMetadata();

  hide(loading);
  renderGrid();
}

btnConnect.addEventListener("click", connectKeplr);
btnDisconnect.addEventListener("click", disconnect);
btnMyNfts.addEventListener("click", toggleMyNfts);
btnSetVk.addEventListener("click", setViewingKey);
btnClearFilters.addEventListener("click", clearFilters);

searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderGrid();
});

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

init();
