import { formatEther, type JsonRpcProvider } from 'ethers';
import { imageUrl, traits } from '../lib/art';
import { contracts, sketchCatalog, type MarketManifest } from './chain';

export type CollectionKey = 'sketches' | 'hidden';
export type Publication = 'sealed' | 'authorized' | 'published';

export type MarketItem = {
  key: string;
  collection: CollectionKey;
  tokenId: number;
  name: string;
  description: string;
  image: string;
  owner: string;
  creator: string;
  publication: Publication;
  rarity?: string;
  palette?: string;
  motion?: string;
  motifCount?: number;
  listing?: { seller: string; price: bigint; version: bigint };
  epoch?: bigint;
  eligibleBlock?: bigint;
  controller?: string;
  handle?: string;
  revealed?: bigint;
};

export type LicenceReceipt = {
  id: bigint;
  licensee: string;
  collection: string;
  tokenId: bigint;
  termsVersion: bigint;
  termsHash: string;
  contentHash: string;
  issuedAt: bigint;
};

export type MarketSnapshot = {
  block: number;
  hiddenSupply: number;
  hiddenMax: number;
  items: MarketItem[];
  creator: string;
  mintPrice: bigint;
  licenceFee: bigint;
  terms: string;
  balances?: { sales: bigint; mint: bigint; licences: bigint };
  receipts: LicenceReceipt[];
};

export function amount(value: bigint) { return `${formatEther(value)} Sepolia ETH`; }
export function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

async function readListing(market: ReturnType<typeof contracts>['marketplace'], collection: string, tokenId: number, owner: string) {
  const listing = await market.listings(collection, tokenId);
  if (!listing.active || String(listing.seller).toLowerCase() !== owner.toLowerCase()) return undefined;
  return { seller: String(listing.seller), price: BigInt(listing.price), version: BigInt(listing.version) };
}

async function readSketch(manifest: MarketManifest, provider: JsonRpcProvider, tokenId: number): Promise<MarketItem> {
  const { sketches, marketplace } = contracts(manifest, provider);
  const asset = sketchCatalog[tokenId - 1];
  const [owner, hash] = await Promise.all([sketches.ownerOf(tokenId), sketches.artworkHash(tokenId)]);
  if (String(hash).toLowerCase() !== asset.sha256.toLowerCase()) throw new Error(`Sketch ${tokenId} asset hash differs from the deployed collection`);
  return {
    key: `sketches:${tokenId}`, collection: 'sketches', tokenId, name: asset.name,
    description: asset.description, image: new URL(asset.file, location.origin).href,
    owner, creator: manifest.creator, publication: 'published',
    listing: await readListing(marketplace, manifest.sketches, tokenId, owner),
  };
}

async function readHidden(manifest: MarketManifest, provider: JsonRpcProvider, tokenId: number): Promise<MarketItem> {
  const { hidden, marketplace } = contracts(manifest, provider);
  const state = await hidden.state(tokenId);
  const publication = Number(state.publication) === 2 ? 'published' : Number(state.publication) === 1 ? 'authorized' : 'sealed';
  const revealed = publication === 'published' ? BigInt(state.revealed) : undefined;
  const publicTraits = revealed === undefined ? undefined : traits(revealed);
  return {
    key: `hidden:${tokenId}`, collection: 'hidden', tokenId,
    name: `Hidden Canvas #${tokenId}`,
    description: publication === 'published' ? 'A verified generative painting.' : publication === 'authorized' ? 'The seed is already public; proof completion is pending.' : 'A sealed generative painting. Previous holders may have seen it privately.',
    image: revealed === undefined ? new URL('/art/sealed.svg', location.origin).href : imageUrl(revealed),
    owner: state.owner, creator: manifest.creator, publication,
    rarity: publicTraits?.rarity, palette: publicTraits?.palette, motion: publicTraits?.motion, motifCount: publicTraits?.motifCount,
    epoch: BigInt(state.epoch), eligibleBlock: BigInt(state.eligibleBlock),
    controller: state.controller, handle: state.handle,
    revealed,
    listing: await readListing(marketplace, manifest.hiddenCanvas, tokenId, state.owner),
  };
}

async function readInGroups<T>(ids: number[], read: (id: number) => Promise<T>) {
  const result: T[] = [];
  for (let i = 0; i < ids.length; i += 4) result.push(...await Promise.all(ids.slice(i, i + 4).map(read)));
  return result;
}

export async function readMarket(manifest: MarketManifest, provider: JsonRpcProvider, account?: string): Promise<MarketSnapshot> {
  const { sketches, hidden, marketplace, licences } = contracts(manifest, provider);
  const [network, block, sketchSupply, hiddenSupply, hiddenMax, creator, mintPrice, licenceFee, terms] = await Promise.all([
    provider.getNetwork(), provider.getBlockNumber(), sketches.totalSupply(), hidden.totalSupply(), hidden.MAX_SUPPLY(),
    sketches.creator(), hidden.mintPrice(), licences.licenceFee(), licences.TERMS(),
  ]);
  if (network.chainId !== 11155111n) throw new Error('Read provider is not on Sepolia');
  if (BigInt(sketchSupply) !== 10n || BigInt(hiddenMax) !== 20n || String(creator).toLowerCase() !== manifest.creator.toLowerCase()) {
    throw new Error('Manifest does not match the expected project contracts');
  }
  if (BigInt(mintPrice).toString() !== manifest.mintPriceWei || BigInt(licenceFee).toString() !== manifest.licenceFeeWei) {
    throw new Error('Manifest fee details do not match Sepolia');
  }
  const sketchItems = await readInGroups(Array.from({ length: 10 }, (_, i) => i + 1), id => readSketch(manifest, provider, id));
  const hiddenItems = await readInGroups(Array.from({ length: Number(hiddenSupply) }, (_, i) => i + 1), id => readHidden(manifest, provider, id));
  let balances: MarketSnapshot['balances'];
  const receipts: LicenceReceipt[] = [];
  if (account) {
    const [sales, mint, licensing, count] = await Promise.all([
      marketplace.proceeds(account), hidden.mintProceeds(), licences.creatorProceeds(account), licences.licenseCount(account),
    ]);
    balances = { sales: BigInt(sales), mint: account.toLowerCase() === manifest.creator.toLowerCase() ? BigInt(mint) : 0n, licences: BigInt(licensing) };
    for (let i = 0n; i < BigInt(count); i++) {
      const id = await licences.licenseReceiptIdAt(account, i);
      const receipt = await licences.receipts(id);
      receipts.push({ id: BigInt(id), licensee: receipt.licensee, collection: receipt.collection, tokenId: BigInt(receipt.tokenId), termsVersion: BigInt(receipt.termsVersion), termsHash: receipt.termsHash, contentHash: receipt.contentHash, issuedAt: BigInt(receipt.issuedAt) });
    }
  }
  return { block, hiddenSupply: Number(hiddenSupply), hiddenMax: Number(hiddenMax), items: [...sketchItems, ...hiddenItems], creator: String(creator), mintPrice: BigInt(mintPrice), licenceFee: BigInt(licenceFee), terms: String(terms), balances, receipts };
}
