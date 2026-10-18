import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const out = new URL('frontend/src/abi/', root);
await mkdir(out, { recursive: true });

for (const name of ['SketchesNFT', 'HiddenCanvasNFT', 'NFTMarketplace', 'ArtworkLicenseRegistry']) {
  const source = new URL(`artifacts/contracts/${name}.sol/${name}.json`, root);
  const artifact = JSON.parse(await readFile(source, 'utf8'));
  if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || artifact.bytecode === '0x') {
    throw new Error(`Compile ${name} before syncing its frontend artifact`);
  }
  await writeFile(new URL(`${name}.json`, out), `${JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode }, null, 2)}\n`);
}

const catalog = JSON.parse(await readFile(new URL('frontend/public/art/sketches/catalog.json', root), 'utf8'));
if (!Array.isArray(catalog) || catalog.length !== 10) throw new Error('Expected ten original Sketches assets');
await mkdir(new URL('frontend/src/market/', root), { recursive: true });
await writeFile(new URL('frontend/src/market/catalog.json', root), `${JSON.stringify(catalog, null, 2)}\n`);
let deployment = null;
try { deployment = JSON.parse(await readFile(new URL('deployments/sepolia-marketplace.json', root), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(new URL('frontend/src/abi/sepolia-marketplace.json', root), `${JSON.stringify(deployment, null, 2)}\n`);

console.log('Synchronized marketplace contracts, original art catalog and verified deployment manifest.');
