import {
  BrowserProvider, Contract, ContractFactory, JsonRpcProvider, getAddress, isAddress,
  type Eip1193Provider, type InterfaceAbi, type Signer, type TransactionReceipt, type TransactionResponse,
} from 'ethers';
import sketchesArtifact from '../abi/SketchesNFT.json';
import hiddenArtifact from '../abi/HiddenCanvasNFT.json';
import marketplaceArtifact from '../abi/NFTMarketplace.json';
import licencesArtifact from '../abi/ArtworkLicenseRegistry.json';
import catalog from './catalog.json';

export const CHAIN_ID = 11155111n;
export const PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const ACTIVATION_DELAY_BLOCKS = 96n;
export const DEFAULT_MINT_PRICE = 1_000_000_000_000_000n; // 0.001 Sepolia ETH.
export const DEFAULT_LICENCE_FEE = 100_000_000_000_000n; // 0.0001 Sepolia ETH.
export const sketchCatalog = catalog;

export type MarketManifest = {
  kind: 'canvas-market';
  chainId: 11155111;
  creator: string;
  sketches: string;
  hiddenCanvas: string;
  marketplace: string;
  licences: string;
  sketchMetadataBaseURI: string;
  mintPriceWei: string;
  licenceFeeWei: string;
  activationDelayBlocks: 96;
  transactions: Record<string, { hash: string; block: number }>;
};

type Step = 'sketchesDeployment' | 'hiddenDeployment' | 'marketplaceDeployment' | 'licencesDeployment' | 'linkSketches' | 'linkHidden';
type DraftStep = { hash: string; address?: string; block?: number };
export type MarketDraft = {
  kind: 'canvas-market-draft'; chainId: 11155111; creator: string; sketchMetadataBaseURI: string;
  steps: Partial<Record<Step, DraftStep>>;
};

export type Wallet = Eip1193Provider & {
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
};

export function checkedManifest(value: unknown): MarketManifest {
  if (!value || typeof value !== 'object') throw new Error('Missing marketplace manifest');
  const m = value as Partial<MarketManifest>;
  if (m.kind !== 'canvas-market' || m.chainId !== 11155111 || m.activationDelayBlocks !== 96) {
    throw new Error('This is not a supported CryptX Sepolia deployment');
  }
  for (const key of ['creator', 'sketches', 'hiddenCanvas', 'marketplace', 'licences'] as const) {
    if (!isAddress(m[key])) throw new Error(`Invalid ${key} address in manifest`);
  }
  if (!m.sketchMetadataBaseURI?.startsWith('http')) throw new Error('Invalid Sketches metadata URL');
  if (!m.mintPriceWei || !m.licenceFeeWei || BigInt(m.mintPriceWei) <= 0n || BigInt(m.licenceFeeWei) <= 0n) {
    throw new Error('Invalid mint or licence fee in manifest');
  }
  return m as MarketManifest;
}

export function checkedDraft(value: unknown): MarketDraft {
  if (!value || typeof value !== 'object') throw new Error('Missing deployment draft');
  const draft = value as Partial<MarketDraft>;
  if (draft.kind !== 'canvas-market-draft' || draft.chainId !== 11155111 || !isAddress(draft.creator) ||
      !draft.sketchMetadataBaseURI?.startsWith('http') || !draft.sketchMetadataBaseURI.endsWith('/') ||
      !draft.steps || typeof draft.steps !== 'object') throw new Error('Invalid deployment draft');
  for (const step of Object.values(draft.steps)) {
    if (!step || !/^0x[0-9a-fA-F]{64}$/.test(step.hash) ||
        (step.address !== undefined && !isAddress(step.address)) ||
        (step.block !== undefined && (!Number.isInteger(step.block) || step.block <= 0))) {
      throw new Error('Invalid transaction in deployment draft');
    }
  }
  return draft as MarketDraft;
}

export function readProvider() {
  return new JsonRpcProvider(PUBLIC_RPC, CHAIN_ID, { staticNetwork: true });
}

export async function walletProvider(ethereum: Wallet): Promise<BrowserProvider> {
  const chain = await ethereum.request({ method: 'eth_chainId' });
  if (BigInt(String(chain)) !== CHAIN_ID) throw new Error('Switch MetaMask to Sepolia');
  return new BrowserProvider(ethereum, undefined, { cacheTimeout: -1 });
}

export async function connectedWallet(ethereum: Wallet) {
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts[0]) throw new Error('No MetaMask account connected');
  const provider = await walletProvider(ethereum);
  return { provider, signer: await provider.getSigner(), account: getAddress(accounts[0]) };
}

export function contracts(manifest: MarketManifest, runner: JsonRpcProvider | BrowserProvider | Signer) {
  return {
    sketches: new Contract(manifest.sketches, sketchesArtifact.abi, runner),
    hidden: new Contract(manifest.hiddenCanvas, hiddenArtifact.abi, runner),
    marketplace: new Contract(manifest.marketplace, marketplaceArtifact.abi, runner),
    licences: new Contract(manifest.licences, licencesArtifact.abi, runner),
  };
}

export async function confirmed(response: TransactionResponse): Promise<TransactionReceipt> {
  const receipt = await response.wait();
  if (!receipt || receipt.status !== 1) throw new Error('The transaction did not confirm successfully');
  return receipt;
}

/** Public draft state permits safe resumption after a browser refresh or rejected later wallet step. */
export async function deployMarket(
  signer: Signer,
  metadataBaseURI: string,
  stage: (text: string) => void,
  onProgress?: (draft: MarketDraft) => void,
  resume?: MarketDraft,
): Promise<MarketManifest> {
  const provider = signer.provider;
  if (!provider || BigInt((await provider.getNetwork()).chainId) !== CHAIN_ID) throw new Error('Sepolia only');
  if (!/^https?:\/\//.test(metadataBaseURI) || !metadataBaseURI.endsWith('/')) throw new Error('Metadata URL must end in /');
  const creator = getAddress(await signer.getAddress());
  const hashes = sketchCatalog.map(item => item.sha256);
  if (hashes.length !== 10 || hashes.some(hash => !/^0x[0-9a-f]{64}$/.test(hash))) throw new Error('Invalid original sketch catalog');
  const draft: MarketDraft = resume ? checkedDraft(resume) : {
    kind: 'canvas-market-draft', chainId: 11155111, creator,
    sketchMetadataBaseURI: metadataBaseURI, steps: {},
  };
  if (getAddress(draft.creator) !== creator || draft.sketchMetadataBaseURI !== metadataBaseURI) throw new Error('Reconnect the original deployer and metadata URL to resume');
  const progress = () => onProgress?.({ ...draft, steps: { ...draft.steps } });
  progress();

  async function validateReceipt(step: Step, expectedAddress?: string, expectedData?: string) {
    const saved = draft.steps[step];
    if (!saved) throw new Error(`Missing ${step} transaction`);
    stage(`${step}: checking submitted transaction`);
    const receipt = await provider!.waitForTransaction(saved.hash, 1, 120000);
    if (!receipt) throw new Error(`${step} is still pending. Resume after it confirms.`);
    if (receipt.status !== 1) {
      delete draft.steps[step]; progress();
      throw new Error(`${step} reverted. Resume to retry that step.`);
    }
    if (expectedAddress && (!receipt.contractAddress || getAddress(receipt.contractAddress) !== getAddress(expectedAddress))) {
      throw new Error(`${step} deployed at an unexpected address`);
    }
    const tx = await provider!.getTransaction(saved.hash);
    if (!tx || getAddress(tx.from) !== creator || (expectedData && tx.data !== expectedData)) throw new Error(`${step} does not match the prepared deployment`);
    if (saved.block !== receipt.blockNumber) { draft.steps[step] = { ...saved, block: receipt.blockNumber }; progress(); }
    return receipt;
  }

  async function deployOne(step: Step, label: string, artifact: { abi: InterfaceAbi; bytecode: string }, args: unknown[]) {
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const expectedData = (await factory.getDeployTransaction(...args)).data;
    let saved = draft.steps[step];
    if (!saved) {
      stage(`${label}: waiting for wallet`);
      const contract = await factory.deploy(...args);
      const tx = contract.deploymentTransaction();
      if (!tx) throw new Error('No deployment transaction returned');
      saved = { hash: tx.hash, address: await contract.getAddress() };
      draft.steps[step] = saved; progress();
    }
    if (!saved.address) throw new Error(`${label} draft is missing its contract address`);
    await validateReceipt(step, saved.address, expectedData);
    if ((await provider!.getCode(saved.address)) === '0x') throw new Error(`${label} code is missing on Sepolia`);
    return getAddress(saved.address);
  }

  async function linkOne(step: Step, label: string, address: string, abi: InterfaceAbi, marketplace: string) {
    const contract = new Contract(address, abi, signer);
    const current = getAddress(await contract.marketplace());
    if (current === getAddress(marketplace)) {
      if (draft.steps[step]) await validateReceipt(step);
      return;
    }
    if (current !== '0x0000000000000000000000000000000000000000') throw new Error(`${label} is linked to a different marketplace`);
    if (!draft.steps[step]) {
      stage(`${label}: waiting for wallet`);
      const tx = await contract.setMarketplace(marketplace) as TransactionResponse;
      draft.steps[step] = { hash: tx.hash }; progress();
    }
    const receipt = await validateReceipt(step);
    const before = await contract.marketplace({ blockTag: receipt.blockNumber - 1 });
    const after = await contract.marketplace({ blockTag: receipt.blockNumber });
    if (getAddress(before) !== '0x0000000000000000000000000000000000000000' ||
        getAddress(after) !== getAddress(marketplace)) {
      throw new Error(`${label} link did not take effect`);
    }
  }

  const sketches = await deployOne('sketchesDeployment', 'Sketches', sketchesArtifact, [creator, metadataBaseURI, hashes]);
  const hidden = await deployOne('hiddenDeployment', 'Hidden Canvas', hiddenArtifact, [creator, DEFAULT_MINT_PRICE, ACTIVATION_DELAY_BLOCKS]);
  const marketplace = await deployOne('marketplaceDeployment', 'Marketplace', marketplaceArtifact, [sketches, hidden]);
  const licences = await deployOne('licencesDeployment', 'Licensing', licencesArtifact, [sketches, hidden, DEFAULT_LICENCE_FEE]);
  await linkOne('linkSketches', 'Link Sketches', sketches, sketchesArtifact.abi, marketplace);
  await linkOne('linkHidden', 'Link Hidden Canvas', hidden, hiddenArtifact.abi, marketplace);
  const transactions: MarketManifest['transactions'] = {};
  for (const step of ['sketchesDeployment', 'hiddenDeployment', 'marketplaceDeployment', 'licencesDeployment', 'linkSketches', 'linkHidden'] as Step[]) {
    const item = draft.steps[step];
    if (!item?.block) throw new Error(`Missing confirmed ${step} receipt`);
    transactions[step] = { hash: item.hash, block: item.block };
  }
  stage('Complete — six transactions confirmed');
  return checkedManifest({
    kind: 'canvas-market', chainId: 11155111, creator,
    sketches, hiddenCanvas: hidden, marketplace, licences,
    sketchMetadataBaseURI: metadataBaseURI,
    mintPriceWei: DEFAULT_MINT_PRICE.toString(), licenceFeeWei: DEFAULT_LICENCE_FEE.toString(),
    activationDelayBlocks: 96, transactions,
  });
}
