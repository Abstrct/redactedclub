import { SecretNetworkClient } from "secretjs";

const CONTRACT_ADDRESS = "secret1vavc4azfjqkcs8rj0rkcl3v45c4ddu54jqfhhq";
const CHAIN_ID = "secret-4";
const LCD_URLS = [
  "https://rest.lavenderfive.com:443/secretnetwork",
  "https://secret.api.trivium.network:1317",
];
const VK_STORAGE_KEY = "redacted-club-vk";

const $ = (sel) => document.querySelector(sel);
const hero = $("#hero");
const loading = $("#loading");
const loadingText = $("#loading-text");
const errorDiv = $("#error");
const emptyState = $("#empty");
const statusBar = $("#status-bar");
const nftGrid = $("#nft-grid");
const nftCount = $("#nft-count");
const btnConnect = $("#btn-connect");
const btnConnectHero = $("#btn-connect-hero");
const btnDisconnect = $("#btn-disconnect");
const addressBadge = $("#address-badge");
const addressText = $("#address-text");
const vkSetup = $("#vk-setup");
const btnSetVk = $("#btn-set-vk");

let secretjs = null;
let myAddress = null;
let codeHash = null;

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
function hideAll() {
  hide(errorDiv);
  hide(emptyState);
  hide(statusBar);
  hide(loading);
  hide(vkSetup);
  nftGrid.innerHTML = "";
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

async function waitForKeplr(timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (window.keplr && window.getOfflineSigner && window.getEnigmaUtils) {
      return true;
    }
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
      console.log(`Connected to ${url}, code hash: ${codeHash}`);
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
  hideAll();
  hero.style.display = "none";

  const keplrReady = await waitForKeplr();
  if (!keplrReady) {
    hero.style.display = "";
    showError(
      "Keplr wallet not detected. Please install the Keplr browser extension and refresh the page."
    );
    return;
  }

  show(loading);
  loadingText.textContent = "Connecting to Keplr...";

  try {
    await window.keplr.enable(CHAIN_ID);
  } catch {
    hide(loading);
    hero.style.display = "";
    showError(
      "Connection rejected. Please approve the Keplr request and try again."
    );
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

    loadingText.textContent = "Finding a working network endpoint...";
    secretjs = await createClientWithFallback(keplrOfflineSigner, myAddress);

    hide(loading);

    const existingKey = getStoredViewingKey(myAddress);
    if (existingKey) {
      await loadNFTs(existingKey);
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
  hideAll();
  show(loading);
  loadingText.textContent = "Approve the transaction in Keplr...";

  try {
    const viewingKey = generateRandomKey();

    const tx = await secretjs.tx.compute.executeContract(
      {
        contract_address: CONTRACT_ADDRESS,
        code_hash: codeHash,
        sender: myAddress,
        msg: {
          set_viewing_key: {
            key: viewingKey,
          },
        },
      },
      { gasLimit: 50_000 }
    );

    if (tx.code !== 0) {
      throw new Error(tx.rawLog || "Transaction failed on-chain");
    }

    storeViewingKey(myAddress, viewingKey);
    loadingText.textContent = "Viewing key set! Loading your NFTs...";
    await loadNFTs(viewingKey);
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

async function loadNFTs(viewingKey) {
  show(loading);
  hide(errorDiv);
  hide(emptyState);
  hide(statusBar);
  hide(vkSetup);
  nftGrid.innerHTML = "";

  loadingText.textContent = "Querying your NFTs...";

  try {
    const allTokens = await queryAllTokens(viewingKey);

    hide(loading);

    if (allTokens.length === 0) {
      show(emptyState);
      return;
    }

    nftCount.textContent = allTokens.length;
    show(statusBar);
    renderNFTs(allTokens);
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
    if (startAfter) {
      tokensQuery.start_after = startAfter;
    }

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

function renderNFTs(tokens) {
  const fragment = document.createDocumentFragment();

  const sorted = [...tokens].sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  for (const tokenId of sorted) {
    const card = document.createElement("div");
    card.className = "nft-card";

    const img = document.createElement("img");
    const base = import.meta.env.BASE_URL;
    img.src = `${base}allBunnies/${tokenId}.webp`;
    img.alt = `Redacted Club #${tokenId}`;
    img.loading = "lazy";
    img.onerror = () => {
      img.style.display = "none";
      const placeholder = document.createElement("div");
      placeholder.style.cssText =
        "width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--surface-hover);color:var(--text-muted);font-size:0.85rem;";
      placeholder.textContent = "Image not found";
      card.insertBefore(placeholder, card.firstChild);
    };

    const info = document.createElement("div");
    info.className = "card-info";

    const name = document.createElement("span");
    name.className = "card-name";
    name.textContent = "Bunny";

    const id = document.createElement("span");
    id.className = "card-id";
    id.textContent = `#${tokenId}`;

    info.appendChild(name);
    info.appendChild(id);
    card.appendChild(img);
    card.appendChild(info);
    fragment.appendChild(card);
  }

  nftGrid.appendChild(fragment);
}

function disconnect() {
  secretjs = null;
  myAddress = null;
  codeHash = null;

  hideAll();
  hide(addressBadge);
  btnConnect.textContent = "Connect Keplr";
  btnConnect.disabled = false;
  btnDisconnect.style.display = "none";
  hero.style.display = "";
}

btnConnect.addEventListener("click", connectKeplr);
btnConnectHero.addEventListener("click", connectKeplr);
btnDisconnect.addEventListener("click", disconnect);
btnSetVk.addEventListener("click", setViewingKey);
