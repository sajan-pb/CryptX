import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Contract, ContractFactory, Interface, JsonRpcProvider, getAddress } from 'ethers';

const root = new URL('../', import.meta.url);
const names = ['SketchesNFT', 'HiddenCanvasNFT', 'NFTMarketplace', 'ArtworkLicenseRegistry'];

async function artifact(name) {
  return JSON.parse(await readFile(new URL(`artifacts/contracts/${name}.sol/${name}.json`, root), 'utf8'));
}

async function verifiedSketchHashes() {
  const catalog = JSON.parse(await readFile(new URL('frontend/public/art/sketches/catalog.json', root), 'utf8'));
  if (!Array.isArray(catalog) || catalog.length !== 10) throw new Error('Expected ten original sketches');
  const hashes = [];
  for (let i = 0; i < 10; i++) {
    const item = catalog[i];
    if (item.tokenId !== i + 1 || !/^\/art\/sketches\/\d\d\.svg$/.test(item.file)) throw new Error('Sketch catalog order or path changed');
    const bytes = await readFile(new URL(`frontend/public${item.file}`, root));
    const hash = `0x${createHash('sha256').update(bytes).digest('hex')}`;
    if (hash !== item.sha256) throw new Error('Sketch asset bytes do not match the catalog');
    hashes.push(hash);
  }
  return hashes;
}

async function main() {
  if (!process.argv[2]) throw new Error('Pass the downloaded public Sepolia marketplace manifest path');
  const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (manifest.kind !== 'canvas-market' || manifest.chainId !== 11155111 || manifest.activationDelayBlocks !== 96) throw new Error('Wrong manifest kind, chain or delay');
  const addresses = Object.fromEntries(['creator', 'sketches', 'hiddenCanvas', 'marketplace', 'licences'].map(key => [key, getAddress(manifest[key])]));
  if (!/^https?:\/\//.test(manifest.sketchMetadataBaseURI) || !manifest.sketchMetadataBaseURI.endsWith('/')) throw new Error('Invalid metadata base URL');
  const mintPrice = BigInt(manifest.mintPriceWei);
  const licenceFee = BigInt(manifest.licenceFeeWei);
  if (mintPrice <= 0n || licenceFee <= 0n) throw new Error('Fees must be positive');
  const hashes = await verifiedSketchHashes();
  const [sketchesArtifact, hiddenArtifact, marketArtifact, licenceArtifact] = await Promise.all(names.map(artifact));
  const provider = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111);
  try {
    if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error('Wrong RPC chain');
    const deployments = [
      ['sketchesDeployment', addresses.sketches, sketchesArtifact, [addresses.creator, manifest.sketchMetadataBaseURI, hashes]],
      ['hiddenDeployment', addresses.hiddenCanvas, hiddenArtifact, [addresses.creator, mintPrice, 96]],
      ['marketplaceDeployment', addresses.marketplace, marketArtifact, [addresses.sketches, addresses.hiddenCanvas]],
      ['licencesDeployment', addresses.licences, licenceArtifact, [addresses.sketches, addresses.hiddenCanvas, licenceFee]],
    ];
    for (const [step, address, compiled, args] of deployments) {
      const item = manifest.transactions?.[step];
      if (!item) throw new Error(`Missing ${step} receipt`);
      const [receipt, transaction, expected, code] = await Promise.all([
        provider.getTransactionReceipt(item.hash), provider.getTransaction(item.hash),
        new ContractFactory(compiled.abi, compiled.bytecode).getDeployTransaction(...args), provider.getCode(address),
      ]);
      if (!receipt || receipt.status !== 1 || !receipt.contractAddress || !transaction || transaction.to !== null ||
          getAddress(receipt.contractAddress) !== address || getAddress(transaction.from) !== addresses.creator ||
          receipt.blockNumber !== item.block || transaction.data !== expected.data || code === '0x') {
        throw new Error(`Invalid ${step} deployment`);
      }
    }
    for (const [step, address, compiled] of [
      ['linkSketches', addresses.sketches, sketchesArtifact],
      ['linkHidden', addresses.hiddenCanvas, hiddenArtifact],
    ]) {
      const item = manifest.transactions?.[step];
      if (!item) throw new Error(`Missing ${step} receipt`);
      const [receipt, transaction] = await Promise.all([provider.getTransactionReceipt(item.hash), provider.getTransaction(item.hash)]);
      if (!receipt || receipt.status !== 1 || !transaction ||
          getAddress(transaction.from) !== addresses.creator || receipt.blockNumber !== item.block) {
        throw new Error(`Invalid ${step} link`);
      }
      const linked = new Contract(address, compiled.abi, provider);
      const [before, after] = await Promise.all([
        linked.marketplace({ blockTag: receipt.blockNumber - 1 }), linked.marketplace({ blockTag: receipt.blockNumber }),
      ]);
      if (getAddress(before) !== '0x0000000000000000000000000000000000000000' ||
          getAddress(after) !== addresses.marketplace) throw new Error(`No ${step} on-chain transition`);
      // Direct calls must have exact calldata. Some MetaMask account modes route
      // an owner-authorized call through another contract; the state transition
      // and signed outer receipt remain the observable evidence in that case.
      if (transaction.to && getAddress(transaction.to) === address) {
        const expected = new Interface(compiled.abi).encodeFunctionData('setMarketplace', [addresses.marketplace]);
        if (transaction.data !== expected) throw new Error(`Unexpected ${step} call data`);
      }
    }
    const sketches = new Contract(addresses.sketches, sketchesArtifact.abi, provider);
    const hidden = new Contract(addresses.hiddenCanvas, hiddenArtifact.abi, provider);
    const market = new Contract(addresses.marketplace, marketArtifact.abi, provider);
    const licences = new Contract(addresses.licences, licenceArtifact.abi, provider);
    const [sketchSupply, sketchCreator, sketchMarket, hiddenCreator, hiddenMarket, hiddenPrice, delay, maxSupply, marketSketches, marketHidden, licenceSketches, licenceHidden, onchainLicenceFee] = await Promise.all([
      sketches.totalSupply(), sketches.creator(), sketches.marketplace(), hidden.creator(), hidden.marketplace(), hidden.mintPrice(),
      hidden.activationDelayBlocks(), hidden.MAX_SUPPLY(), market.sketches(), market.hiddenCanvas(),
      licences.sketches(), licences.hiddenCanvas(), licences.licenceFee(),
    ]);
    if (BigInt(sketchSupply) !== 10n || getAddress(sketchCreator) !== addresses.creator || getAddress(hiddenCreator) !== addresses.creator ||
        getAddress(sketchMarket) !== addresses.marketplace || getAddress(hiddenMarket) !== addresses.marketplace ||
        BigInt(hiddenPrice) !== mintPrice || BigInt(delay) !== 96n || BigInt(maxSupply) !== 20n ||
        getAddress(marketSketches) !== addresses.sketches || getAddress(marketHidden) !== addresses.hiddenCanvas ||
        getAddress(licenceSketches) !== addresses.sketches || getAddress(licenceHidden) !== addresses.hiddenCanvas ||
        BigInt(onchainLicenceFee) !== licenceFee) throw new Error('Linked contract state differs from manifest');
    for (let id = 1; id <= 10; id++) {
      const [owner, hash, uri] = await Promise.all([sketches.ownerOf(id), sketches.artworkHash(id), sketches.tokenURI(id)]);
      if (getAddress(owner) !== addresses.creator || hash !== hashes[id - 1] || uri !== `${manifest.sketchMetadataBaseURI}${id}.json`) {
        throw new Error(`Sketch ${id} mint or artwork differs from manifest`);
      }
    }
    const verified = { ...manifest, ...addresses, verifiedAtBlock: await provider.getBlockNumber() };
    await mkdir(new URL('deployments/', root), { recursive: true });
    await writeFile(new URL('deployments/sepolia-marketplace.json', root), `${JSON.stringify(verified, null, 2)}\n`, { flag: 'wx' });
    console.log('Verified and saved deployments/sepolia-marketplace.json');
  } finally { provider.destroy(); }
}

main().catch(() => {
  // Parsed input can be untrusted; never print its contents or RPC diagnostics.
  console.error('Marketplace manifest import failed. Check the public file, exact compiled build, Sepolia receipts, ten SVG assets and whether the destination already exists. No existing manifest was overwritten.');
  process.exitCode = 1;
});
