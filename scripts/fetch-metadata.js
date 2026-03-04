import { SecretNetworkClient } from "secretjs";
import { writeFileSync } from "fs";

const CONTRACT_ADDRESS = "secret1vavc4azfjqkcs8rj0rkcl3v45c4ddu54jqfhhq";
const CHAIN_ID = "secret-4";
const LCD_URLS = [
  "https://rest.lavenderfive.com:443/secretnetwork",
  "https://secret.api.trivium.network:1317",
];
const TOTAL_TOKENS = 1337;
const BATCH_SIZE = 10;
const DELAY_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createReadonlyClient() {
  for (const url of LCD_URLS) {
    try {
      const client = new SecretNetworkClient({ url, chainId: CHAIN_ID });
      const codeHash =
        await client.query.compute.codeHashByContractAddress({
          contract_address: CONTRACT_ADDRESS,
        });
      const hash =
        typeof codeHash === "string"
          ? codeHash
          : codeHash?.code_hash || codeHash?.codeHash || String(codeHash);
      console.log(`Connected to ${url} — code hash: ${hash}`);
      return { client, codeHash: hash };
    } catch (e) {
      console.warn(`${url} failed: ${e.message}`);
    }
  }
  throw new Error("All endpoints unreachable");
}

async function fetchNftInfo(client, codeHash, tokenId) {
  const result = await client.query.compute.queryContract({
    contract_address: CONTRACT_ADDRESS,
    code_hash: codeHash,
    query: { nft_info: { token_id: String(tokenId) } },
  });
  return result?.nft_info || result;
}

async function main() {
  const { client, codeHash } = await createReadonlyClient();
  const metadata = {};
  let fetched = 0;
  let failures = 0;

  for (let start = 0; start < TOTAL_TOKENS; start += BATCH_SIZE) {
    const batch = [];
    for (let i = start; i < Math.min(start + BATCH_SIZE, TOTAL_TOKENS); i++) {
      batch.push(
        fetchNftInfo(client, codeHash, i)
          .then((info) => {
            const ext = info?.extension || info?.token_info?.extension || {};
            metadata[i] = {
              name: ext.name || `Bunny #${i}`,
              attributes: ext.attributes || [],
            };
          })
          .catch((e) => {
            console.warn(`Token ${i} failed: ${e.message}`);
            failures++;
            metadata[i] = { name: `Bunny #${i}`, attributes: [] };
          })
      );
    }

    await Promise.all(batch);
    fetched += batch.length;
    process.stdout.write(`\r  ${fetched}/${TOTAL_TOKENS} fetched (${failures} failures)`);
    if (start + BATCH_SIZE < TOTAL_TOKENS) await sleep(DELAY_MS);
  }

  console.log("\nWriting metadata.json...");
  writeFileSync(
    new URL("../public/metadata.json", import.meta.url),
    JSON.stringify(metadata, null, 2)
  );
  console.log(`Done. ${Object.keys(metadata).length} tokens saved to public/metadata.json`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
