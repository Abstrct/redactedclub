import { SecretNetworkClient } from "secretjs";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const OUT_PATH = join(PUBLIC_DIR, "metadata.json");
const URI_CACHE_PATH = join(__dirname, ".uri-cache.json");

const CONTRACT = "secret1vavc4azfjqkcs8rj0rkcl3v45c4ddu54jqfhhq";
const CHAIN_ID = "secret-4";
const LCD_URLS = [
  "https://secret.api.trivium.network:1317",
  "https://rest.lavenderfive.com:443/secretnetwork",
];
const TOTAL = 1337;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadJson(path) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  return {};
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

async function createClient(url) {
  const client = new SecretNetworkClient({ url, chainId: CHAIN_ID });
  const h = await client.query.compute.codeHashByContractAddress({
    contract_address: CONTRACT,
  });
  const codeHash =
    typeof h === "string" ? h : h?.code_hash || h?.codeHash || String(h);
  return { client, codeHash };
}

async function getTokenUri(client, codeHash, tokenId) {
  const r = await client.query.compute.queryContract({
    contract_address: CONTRACT,
    code_hash: codeHash,
    query: { nft_info: { token_id: String(tokenId) } },
  });
  return r?.nft_info?.token_uri || null;
}

async function fetchArweave(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

// Phase 1: collect all token_uris from the contract
async function collectUris() {
  const uriCache = loadJson(URI_CACHE_PATH);
  const missing = [];
  for (let i = 0; i < TOTAL; i++) {
    if (!uriCache[i]) missing.push(i);
  }

  if (missing.length === 0) {
    console.log(`All ${TOTAL} token URIs already cached.`);
    return uriCache;
  }

  console.log(
    `Phase 1: Fetching ${missing.length} token URIs from contract...`
  );

  const clients = [];
  for (const url of LCD_URLS) {
    try {
      clients.push(await createClient(url));
      console.log(`  Connected to ${url}`);
    } catch (e) {
      console.warn(`  ${url} failed: ${e.message}`);
    }
  }
  if (clients.length === 0) throw new Error("No LCD endpoints available");

  let done = TOTAL - missing.length;
  let failures = 0;
  const PARALLEL = Math.min(clients.length, 2);

  for (let idx = 0; idx < missing.length; idx += PARALLEL) {
    const chunk = missing.slice(idx, idx + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (tokenId, i) => {
        const { client, codeHash } = clients[i % clients.length];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const uri = await getTokenUri(client, codeHash, tokenId);
            if (uri) return { tokenId, uri };
            return null;
          } catch {
            if (attempt < 2) await sleep(2000 * (attempt + 1));
          }
        }
        return null;
      })
    );

    for (const r of results) {
      done++;
      if (r.status === "fulfilled" && r.value) {
        uriCache[r.value.tokenId] = r.value.uri;
      } else {
        failures++;
      }
    }

    if (done % 20 === 0 || idx + PARALLEL >= missing.length) {
      process.stdout.write(
        `\r  ${done}/${TOTAL} URIs (${failures} failures)   `
      );
      saveJson(URI_CACHE_PATH, uriCache);
    }

    await sleep(200);
  }

  console.log("");
  saveJson(URI_CACHE_PATH, uriCache);
  return uriCache;
}

// Phase 2: fetch metadata from Arweave
async function collectMetadata(uriCache) {
  const metadata = loadJson(OUT_PATH);
  const missing = [];
  for (let i = 0; i < TOTAL; i++) {
    if (metadata[i]?.attributes?.length > 0) continue;
    if (!uriCache[i]) continue;
    missing.push(i);
  }

  if (missing.length === 0) {
    console.log(`All metadata already fetched.`);
    return metadata;
  }

  console.log(`Phase 2: Fetching ${missing.length} metadata from Arweave...`);

  const PARALLEL = 25;
  let done = TOTAL - missing.length;
  let failures = 0;

  for (let i = 0; i < missing.length; i += PARALLEL) {
    const chunk = missing.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      chunk.map(async (tokenId) => {
        const data = await fetchArweave(uriCache[tokenId]);
        return { tokenId, data };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        const { tokenId, data } = r.value;
        metadata[tokenId] = {
          name: data.name || `Bunny #${tokenId}`,
          attributes: (data.attributes || []).filter(
            (a) => a.trait_type !== "Name"
          ),
        };
      } else {
        failures++;
      }
      done++;
    }

    if (done % 20 === 0 || i + PARALLEL >= missing.length) {
      process.stdout.write(
        `\r  ${done}/${TOTAL} metadata (${failures} failures)   `
      );
      saveJson(OUT_PATH, metadata);
    }
  }

  console.log("");
  saveJson(OUT_PATH, metadata);
  return metadata;
}

async function main() {
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const uriCache = await collectUris();
  const uriCount = Object.keys(uriCache).length;
  console.log(`\nHave ${uriCount}/${TOTAL} token URIs.\n`);

  const metadata = await collectMetadata(uriCache);
  const complete = Object.values(metadata).filter(
    (v) => v.attributes?.length > 0
  ).length;

  console.log(
    `\nDone! ${complete}/${TOTAL} tokens with full attributes in public/metadata.json`
  );
  if (complete < TOTAL) {
    console.log("Re-run to retry any missing tokens.");
  }
}

main().catch((e) => {
  console.error("\nFatal:", e);
  process.exit(1);
});
