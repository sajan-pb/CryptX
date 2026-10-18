import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isAddress, parseEther, type TransactionResponse } from 'ethers';
import verifiedManifest from '../abi/sepolia-marketplace.json';
import { imageUrl, traits } from '../lib/art';
import { classify, freshInstance, freshPreview } from '../lib/zama';
import {
  checkedDraft, checkedManifest, connectedWallet, confirmed, contracts, deployMarket, readProvider,
  walletProvider, type MarketDraft, type MarketManifest, type Wallet,
} from './chain';
import { amount, readMarket, short, type CollectionKey, type MarketItem, type MarketSnapshot } from './model';
import './style.css';

type View = 'explore' | 'sketches' | 'hidden' | 'mine' | 'licences';
const storageKey = 'canvas-market:deployment';
const draftKey = 'canvas-market:deployment-draft';
const wallet = (window as Window & { ethereum?: Wallet }).ethereum;
const publicProvider = readProvider();

function savedManifest(): MarketManifest | undefined {
  try { return checkedManifest(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch {
    try { return checkedManifest(verifiedManifest); }
    catch { return undefined; }
  }
}

function savedDraft(): MarketDraft | undefined {
  try { return checkedDraft(JSON.parse(localStorage.getItem(draftKey) ?? 'null')); }
  catch { return undefined; }
}

function download(name: string, content: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href; link.download = name; link.click();
  URL.revokeObjectURL(href);
}

function marketError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const known = [
    'Install MetaMask to use this project', 'Switch MetaMask to Sepolia',
    'Connect MetaMask and load a deployment', 'Connect MetaMask first',
    'Wallet account changed', 'You no longer own this NFT',
    'Only the current owner can preview', 'Choose a positive Sepolia ETH price',
    'Listing changed. Refresh before buying.', 'Complete the public reveal before listing',
    'Ownership changed while decrypting. The private result was discarded.',
  ];
  if (known.includes(message)) return message;
  if (message.startsWith('Sketch ') && message.endsWith(' asset hash differs from the deployed collection')) return 'A deployed Sketch does not match its original artwork. Check the deployment manifest.';
  if (message.startsWith('Manifest does not match') || message.startsWith('This is not a Sepolia') || message.startsWith('Invalid deployment')) return 'The deployment file does not match this Sepolia project.';
  if (message.includes('still pending. Resume after it confirms.')) return 'A deployment transaction is still pending. Resume after it confirms.';
  if (message.endsWith('reverted. Resume to retry that step.')) return 'That deployment step reverted. Its draft entry was cleared; click Resume to retry it.';
  return classify(error);
}

function App() {
  const [manifest, setManifest] = useState<MarketManifest | undefined>(savedManifest);
  const [draft, setDraft] = useState<MarketDraft | undefined>(savedDraft);
  const [account, setAccount] = useState('');
  const [snapshot, setSnapshot] = useState<MarketSnapshot>();
  const [view, setView] = useState<View>('explore');
  const [selectedKey, setSelectedKey] = useState('');
  const [query, setQuery] = useState('');
  const [listedOnly, setListedOnly] = useState(false);
  const [price, setPrice] = useState('0.01');
  const [recipient, setRecipient] = useState('');
  const [privateSeed, setPrivateSeed] = useState<bigint>();
  const [status, setStatus] = useState('Connect MetaMask to trade on Sepolia.');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const scope = useRef('');
  const locked = useRef(false);
  const mounted = useRef(true);
  const invalidate = () => { generation.current++; setPrivateSeed(undefined); };

  const selected = snapshot?.items.find(item => item.key === selectedKey);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = snapshot?.items.filter(item =>
    (view === 'explore' ||
      (view === 'sketches' && item.collection === 'sketches') ||
      (view === 'hidden' && item.collection === 'hidden') ||
      (view === 'mine' && !!account && item.owner.toLowerCase() === account.toLowerCase())) &&
    (!listedOnly || !!item.listing) &&
    (!normalizedQuery || `${item.name} ${item.collection} ${item.tokenId}`.toLowerCase().includes(normalizedQuery))
  ) ?? [];

  useEffect(() => {
    mounted.current = true;
    const changed = () => { invalidate(); setAccount(''); setSnapshot(undefined); setStatus('Wallet changed. Connect again to continue.'); };
    wallet?.on?.('accountsChanged', changed);
    wallet?.on?.('chainChanged', changed);
    wallet?.on?.('disconnect', changed);
    return () => {
      mounted.current = false; generation.current++;
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) wallet?.removeListener?.(event, changed);
    };
  }, []);

  async function refresh(currentManifest = manifest, currentAccount = account) {
    if (!currentManifest) return;
    const captured = generation.current;
    const fresh = await readMarket(currentManifest, publicProvider, currentAccount || undefined);
    if (!mounted.current || captured !== generation.current) return;
    setSnapshot(fresh);
    const item = fresh.items.find(entry => entry.key === selectedKey);
    const nextScope = [currentAccount, currentManifest.hiddenCanvas, item?.key, item?.owner, item?.epoch, item?.publication].join(':');
    if (scope.current !== nextScope) { scope.current = nextScope; invalidate(); }
  }

  useEffect(() => {
    if (!manifest) return;
    refresh().catch(error => setStatus(marketError(error)));
    const timer = window.setInterval(() => refresh().catch(() => { invalidate(); setSnapshot(undefined); }), 12000);
    return () => window.clearInterval(timer);
  }, [manifest, account, selectedKey]);

  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await work(); }
    catch (error) { setStatus(marketError(error)); }
    finally { locked.current = false; setBusy(false); await refresh().catch(() => undefined); }
  }

  async function connect() {
    if (!wallet) throw new Error('Install MetaMask to use this project');
    setStatus('Waiting for wallet');
    const connected = await connectedWallet(wallet);
    invalidate(); setAccount(connected.account); setStatus('Connected to Sepolia.');
  }

  async function send(label: string, submit: () => Promise<TransactionResponse>) {
    if (!wallet || !account) throw new Error('Connect MetaMask first');
    const active = await connectedWallet(wallet);
    if (active.account.toLowerCase() !== account.toLowerCase()) throw new Error('Wallet account changed');
    setStatus(`${label}: waiting for wallet`);
    const response = await submit();
    setStatus(`${label}: transaction submitted → Confirming`);
    const receipt = await confirmed(response);
    invalidate();
    setStatus(`${label}: complete at Sepolia block ${receipt.blockNumber}.`);
    await refresh();
    return receipt;
  }

  async function withSigner() {
    if (!wallet || !manifest || !account) throw new Error('Connect MetaMask and load a deployment');
    const provider = await walletProvider(wallet);
    const signer = await provider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error('Wallet account changed');
    return contracts(manifest, signer);
  }

  async function importManifest(file: File) {
    const parsed = checkedManifest(JSON.parse(await file.text()));
    setStatus('Checking deployment against Sepolia');
    await readMarket(parsed, publicProvider);
    localStorage.setItem(storageKey, JSON.stringify(parsed));
    invalidate(); setManifest(parsed); setSelectedKey(''); setStatus('Deployment verified and loaded.');
  }

  async function deploy() {
    if (!wallet || !account) throw new Error('Connect Account A on Sepolia first');
    const { signer } = await connectedWallet(wallet);
    const metadataBaseURI = draft?.sketchMetadataBaseURI ?? new URL('/metadata/sketches/', location.origin).href;
    const result = await deployMarket(signer, metadataBaseURI, setStatus, next => {
      localStorage.setItem(draftKey, JSON.stringify(next));
      setDraft(next);
    }, draft);
    await readMarket(result, publicProvider);
    localStorage.setItem(storageKey, JSON.stringify(result));
    localStorage.removeItem(draftKey);
    setDraft(undefined);
    setManifest(result); setStatus('Project deployed and linked on Sepolia. Download its manifest.');
    download('sepolia-marketplace.json', result);
  }

  async function freshPrivatePreview(item: MarketItem) {
    if (!wallet || !manifest || !account || item.collection !== 'hidden' || !item.controller || !item.handle) throw new Error('Missing private preview context');
    if (item.owner.toLowerCase() !== account.toLowerCase()) throw new Error('Only the current owner can preview');
    const captured = generation.current;
    const provider = await walletProvider(wallet);
    const signer = await provider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error('Wallet account changed');
    setPrivateSeed(undefined);
    setStatus('Waiting for access');
    const value = await freshPreview(wallet, signer, manifest.hiddenCanvas, item.controller, item.handle, setStatus);
    const current = await contracts(manifest, provider).hidden.state(item.tokenId);
    const accounts = await wallet.request({ method: 'eth_accounts' }) as string[];
    if (captured !== generation.current || accounts[0]?.toLowerCase() !== account.toLowerCase() ||
        current.owner.toLowerCase() !== item.owner.toLowerCase() || BigInt(current.epoch) !== item.epoch ||
        BigInt(current.publication) !== 0n) {
      setStatus('Ownership changed while decrypting. The private result was discarded.');
      return;
    }
    setPrivateSeed(value);
    setStatus('Private preview ready. It is held only in this page memory.');
  }

  async function probeNonOwnerAccess(item: MarketItem) {
    if (!wallet || !manifest || !account || item.collection !== 'hidden' || !item.controller || !item.handle) throw new Error('Missing access probe context');
    if (item.owner.toLowerCase() === account.toLowerCase() || item.publication !== 'sealed') throw new Error('This probe is for a non-owner of a sealed NFT');
    const provider = await walletProvider(wallet);
    const signer = await provider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error('Wallet account changed');
    let requests = 0;
    let httpStatus: number | undefined;
    let stage = 'Preparing fresh access probe';
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      const isDecrypt = url.includes('/delegated-user-decrypt');
      if (isDecrypt) requests++;
      const response = await originalFetch(...args);
      if (isDecrypt) httpStatus = response.status;
      return response;
    };
    try {
      // Deliberately discard any plaintext if the access control unexpectedly fails.
      await freshPreview(wallet, signer, manifest.hiddenCanvas, item.controller, item.handle, next => { stage = next; setStatus(next); });
      const current = await contracts(manifest, provider).hidden.state(item.tokenId);
      const stillNonOwner = current.owner.toLowerCase() !== account.toLowerCase() && BigInt(current.publication) === 0n;
      setStatus(`${stillNonOwner ? 'Unexpected non-owner decryption success — no value displayed' : 'Token state changed during probe — inconclusive'}. ${requests} outbound decryption request(s)${httpStatus === undefined ? '' : `; relayer HTTP ${httpStatus}`}.`);
    } catch (error) {
      const result = classify(error);
      const outcome = result === 'Explicit access rejection' ? `${result} (${requests ? 'relayer contacted' : 'client ACL precheck only'})` : `${result} Stage: ${stage}.`;
      setStatus(`${outcome} ${requests} outbound decryption request(s)${httpStatus === undefined ? '' : `; relayer HTTP ${httpStatus}`}.`);
    } finally { window.fetch = originalFetch; }
  }

  async function completeReveal(item: MarketItem) {
    if (!wallet || !manifest || !item.handle) throw new Error('Missing reveal context');
    const provider = await walletProvider(wallet);
    const state = await contracts(manifest, provider).hidden.state(item.tokenId);
    if (BigInt(state.publication) !== 1n || state.handle !== item.handle) throw new Error('Reveal state changed');
    setStatus('Decrypting public seed and obtaining proof');
    const instance = await freshInstance(wallet);
    const result = await instance.publicDecrypt([item.handle]);
    const clear = result.clearValues[item.handle as `0x${string}`];
    if (typeof clear !== 'bigint') throw new Error('Public decryption returned an unexpected value');
    const { hidden } = await withSigner();
    setStatus('Finalizing public reveal');
    await send('Complete reveal', () => hidden.completeReveal(item.tokenId, clear, result.decryptionProof));
  }

  async function list(item: MarketItem) {
    if (!manifest || !account) throw new Error('Connect a wallet');
    const parsed = parseEther(price);
    if (parsed <= 0n) throw new Error('Choose a positive Sepolia ETH price');
    const collectionAddress = item.collection === 'sketches' ? manifest.sketches : manifest.hiddenCanvas;
    const { sketches, hidden, marketplace } = await withSigner();
    const collection = item.collection === 'sketches' ? sketches : hidden;
    if ((await collection.ownerOf(item.tokenId)).toLowerCase() !== account.toLowerCase()) throw new Error('You no longer own this NFT');
    if (item.publication === 'authorized') throw new Error('Complete the public reveal before listing');
    if ((await collection.getApproved(item.tokenId)).toLowerCase() !== manifest.marketplace.toLowerCase() &&
        !await collection.isApprovedForAll(account, manifest.marketplace)) {
      await send('Approve marketplace', () => collection.approve(manifest.marketplace, item.tokenId));
    }
    await send('List NFT', () => marketplace.list(collectionAddress, item.tokenId, parsed));
  }

  async function buy(item: MarketItem) {
    if (!manifest || !item.listing) throw new Error('This listing is no longer available');
    const collectionAddress = item.collection === 'sketches' ? manifest.sketches : manifest.hiddenCanvas;
    const { marketplace } = await withSigner();
    const current = await marketplace.listings(collectionAddress, item.tokenId);
    if (!current.active || BigInt(current.version) !== item.listing.version || BigInt(current.price) !== item.listing.price) {
      throw new Error('Listing changed. Refresh before buying.');
    }
    await send('Buy NFT', () => marketplace.buy(collectionAddress, item.tokenId, item.listing!.version, { value: item.listing!.price }));
  }

  function detail(item: MarketItem) {
    const isOwner = !!account && item.owner.toLowerCase() === account.toLowerCase();
    const remaining = item.eligibleBlock === undefined || !snapshot ? 0 : Math.max(0, Number(item.eligibleBlock) - snapshot.block);
    const collectionAddress = item.collection === 'sketches' ? manifest!.sketches : manifest!.hiddenCanvas;
    const mayLicense = item.collection === 'sketches' || item.publication === 'published';
    return <section className="detail" aria-label="NFT details">
      <button className="back" onClick={() => { invalidate(); setSelectedKey(''); }}>← Back to collection</button>
      <div className="detail-layout"><img className="detail-art" src={item.image} alt={item.name}/><div>
        <p className="eyebrow">{item.collection === 'sketches' ? 'SKETCHES' : 'HIDDEN CANVAS'} / #{item.tokenId}</p>
        <h2>{item.name}</h2><p>{item.description}</p>
        <dl><div><dt>Owner</dt><dd>{short(item.owner)}</dd></div><div><dt>Creator</dt><dd>{short(item.creator)}</dd></div><div><dt>Publication</dt><dd>{item.publication === 'authorized' ? 'Public authorization · proof pending' : item.publication === 'published' ? 'Published' : 'Sealed'}</dd></div>
          {item.collection === 'hidden' && item.publication === 'sealed' && <div><dt>Preview eligibility</dt><dd>{remaining ? `${remaining} blocks remaining` : 'Eligible'}</dd></div>}
          {item.rarity && <><div><dt>Rarity</dt><dd>{item.rarity}</dd></div><div><dt>Palette</dt><dd>{item.palette}</dd></div><div><dt>Motion</dt><dd>{item.motion}</dd></div><div><dt>Motifs</dt><dd>{item.motifCount}</dd></div></>}
        </dl>
        {item.listing && <div className="sale"><strong>{amount(item.listing.price)}</strong><span>Fixed price · listing #{item.listing.version.toString()}</span>{!isOwner && <button disabled={busy || !account} onClick={() => run(() => buy(item))}>Buy NFT</button>}</div>}
        {isOwner && <div className="action-box"><h3>Owner actions</h3>
          {item.listing ? <button disabled={busy} onClick={() => run(async () => { const { marketplace } = await withSigner(); await send('Cancel listing', () => marketplace.cancel(collectionAddress, item.tokenId)); })}>Cancel listing</button> : item.publication !== 'authorized' && <label>Listing price, Sepolia ETH<input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal"/><button disabled={busy} onClick={() => run(() => list(item))}>List for sale</button></label>}
          <label>Transfer to address<input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="0x…"/><button disabled={busy || !isAddress(recipient)} onClick={() => run(async () => { const { sketches, hidden } = await withSigner(); const collection = item.collection === 'sketches' ? sketches : hidden; await send('Transfer NFT', () => collection['safeTransferFrom(address,address,uint256)'](account, recipient, item.tokenId)); })}>Transfer NFT</button></label>
        </div>}
        {item.collection === 'hidden' && item.publication !== 'published' && <div className="action-box"><h3>{item.publication === 'authorized' ? 'Complete public reveal' : 'Hidden Canvas'}</h3><p>{item.publication === 'authorized' ? 'The seed is already public. Submit its verified proof to display the artwork for everyone.' : 'Only the eligible owner can preview. A previous holder may remember artwork they already saw.'}</p>
          {isOwner && item.publication === 'sealed' && <><button disabled={busy || !!remaining} onClick={() => run(async () => { const { hidden } = await withSigner(); await send('Activate private preview', () => hidden.activatePrivatePreview(item.tokenId, item.epoch)); })}>Activate private preview</button><button disabled={busy} onClick={() => run(() => freshPrivatePreview(item))}>Preview privately</button><button className="outline" disabled={busy || !!remaining || !!item.listing} onClick={() => { if (window.confirm('This transaction makes the seed permanently public immediately, even if proof completion is interrupted. Continue?')) run(async () => { const { hidden } = await withSigner(); await send('Reveal publicly — permanent', () => hidden.authorizePublicReveal(item.tokenId, item.epoch)); }); }}>Reveal publicly — permanent</button></>}
          {!isOwner && account && item.publication === 'sealed' && <details><summary>Access-control test probe</summary><p>This signs a fresh, real decryption request as a non-owner. A timeout is inconclusive. Any unexpected plaintext is discarded without display.</p><button disabled={busy} onClick={() => run(() => probeNonOwnerAccess(item))}>Run fresh access probe</button></details>}
          {item.publication === 'authorized' && <button disabled={busy || !account} onClick={() => run(() => completeReveal(item))}>Complete reveal</button>}
          {privateSeed !== undefined && selectedKey === item.key && <div className="private-preview"><small>PRIVATE PREVIEW · ONLY IN THIS PAGE</small><img src={imageUrl(privateSeed)} alt="Your private painting"/><p>{traits(privateSeed).rarity} · {traits(privateSeed).palette} · {traits(privateSeed).motion}</p><button className="text-button" onClick={() => setPrivateSeed(undefined)}>Hide preview</button></div>}
        </div>}
        <div className="action-box"><h3>Artwork licence</h3><p>A licence is separate from NFT ownership. It permits commercial display and reproduction with creator attribution under fixed demo terms.</p><p>Fee: {snapshot && amount(snapshot.licenceFee)} · Creator: {short(item.creator)}</p><button disabled={busy || !account || !mayLicense} onClick={() => run(async () => { const { licences } = await withSigner(); await send('Obtain artwork licence', () => licences.obtainLicence(collectionAddress, item.tokenId, { value: snapshot!.licenceFee })); })}>Obtain artwork licence</button>{!mayLicense && <small>Available after verified public reveal.</small>}</div>
      </div></div>
    </section>;
  }

  return <div className="market-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" href="/" aria-label="CryptX home">
          <img src="/cryptx-mark.svg" alt=""/><span>CryptX</span>
        </a>
        <label className="header-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 5 5"/></svg>
          <span className="sr-only">Search artwork</span>
          <input type="search" value={query} disabled={!manifest} placeholder="Search artworks and collections" onChange={event => {
            setQuery(event.target.value); invalidate(); setSelectedKey(''); setView('explore');
          }}/>
        </label>
        <nav aria-label="Main navigation">
          {(['explore', 'sketches', 'hidden', 'mine', 'licences'] as View[]).map(key =>
            <button key={key} className={view === key && !selected ? 'active' : ''} onClick={() => { invalidate(); setSelectedKey(''); setView(key); }}>
              {key === 'mine' ? 'My NFTs' : key === 'licences' ? 'Licences' : key === 'hidden' ? 'Hidden Canvas' : key === 'sketches' ? 'Sketches' : 'Explore'}
            </button>
          )}
        </nav>
        <div className="header-actions"><span className="network-pill"><i/>Sepolia</span><button className="wallet-button" disabled={busy || !wallet} onClick={() => run(connect)}>{account ? short(account) : 'Connect MetaMask'}</button></div>
      </div>
    </header>
    <main>
      <div className="status-strip" role="status" aria-live="polite"><span className={busy ? 'spinner' : 'status-dot'}/><span>{status}</span></div>
      {status === 'Switch MetaMask to Sepolia' && wallet && <button className="network-button" disabled={busy} onClick={() => run(async () => { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] }); await connect(); })}>Switch to Sepolia</button>}
      {!manifest ? <section className="onboarding">
        <p className="eyebrow">CRYPTX / SEPOLIA DEMONSTRATION</p>
        <h1>Collect art. Keep the secret. Choose the reveal.</h1>
        <p>Browse two original collections, or load the verified Sepolia deployment to trade with MetaMask.</p>
        <div className="onboarding-actions"><label>Import deployment manifest<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) run(() => importManifest(file)); }}/></label><button disabled={busy || !account} onClick={() => run(deploy)}>{draft ? 'Resume project deployment' : 'Deploy project with MetaMask'}</button></div>
        <p className="fine">Deployment requires six confirmed Sepolia transactions. The first transaction creates and seeds all ten Sketches. Save the manifest after deployment; interrupted transactions remain on-chain.</p>
        {draft && <ol>{Object.entries(draft.steps).map(([step, transaction]) => <li key={transaction.hash}>{step}: <a href={`https://sepolia.etherscan.io/tx/${transaction.hash}`} target="_blank" rel="noreferrer">{transaction.block ? `confirmed in block ${transaction.block}` : 'submitted · checking receipt'}</a></li>)}</ol>}
      </section> : <>
        {!selected && view === 'explore' && <>
          <section className="hero">
            <div className="hero-copy"><p className="eyebrow"><span className="live-pip"/> ORIGINAL ART · ON SEPOLIA</p><h1>Art beyond<br/><span>the surface.</span></h1><p>Discover ten original sketches and a collection of hidden paintings. Own the artwork, explore its story, and choose when to reveal what is inside.</p><div className="hero-actions"><button onClick={() => { invalidate(); setView('sketches'); }}>Explore artworks <span aria-hidden="true">↗</span></button><button className="secondary" onClick={() => { invalidate(); setView('hidden'); }}>Discover Hidden Canvas</button></div></div>
            <div className="hero-showcase" aria-hidden="true"><div className="hero-art hero-art-back"><img src="/art/sketches/04.svg" alt=""/></div><div className="hero-art hero-art-front"><img src="/art/sketches/01.svg" alt=""/><span>01 / 10 · SKETCHES</span></div></div>
          </section>
          <div className="collection-rail">
            <button onClick={() => { invalidate(); setView('sketches'); }}><img src="/art/sketches/02.svg" alt=""/><span><small>THE ORIGINALS</small><strong>Sketches</strong><em>10 artworks · Minting closed</em></span><b aria-hidden="true">↗</b></button>
            <button onClick={() => { invalidate(); setView('hidden'); }}><img src="/art/sealed.svg" alt=""/><span><small>THE GENERATIVE SERIES</small><strong>Hidden Canvas</strong><em>{snapshot?.hiddenSupply ?? '—'} / {snapshot?.hiddenMax ?? 20} minted · Minting live</em></span><b aria-hidden="true">↗</b></button>
          </div>
        </>}
        {!selected && view !== 'licences' && <div className="summary"><span><strong>10 items</strong> · Sketches minting closed</span><span><strong>{snapshot?.hiddenSupply ?? '—'} / {snapshot?.hiddenMax ?? 20}</strong> · Hidden Canvas minting live</span><span className="summary-block">Sepolia block {snapshot?.block ?? '—'}</span></div>}
        {view === 'licences' ? <section className="licences-page">
          <div className="page-heading"><p className="eyebrow">YOUR COLLECTION</p><h2>Licences &amp; proceeds</h2><p>Artwork licences and earnings are separate from NFT ownership.</p></div>
          {!account ? <p className="empty">Connect MetaMask to see your receipts and balances.</p> : <>
            <div className="balance-grid"><div><small>Sales</small><strong>{amount(snapshot?.balances?.sales ?? 0n)}</strong><button disabled={busy || !snapshot?.balances?.sales} onClick={() => run(async () => { const { marketplace } = await withSigner(); await send('Withdraw sale proceeds', () => marketplace.withdrawProceeds()); })}>Withdraw sales</button></div><div><small>Creator mint income</small><strong>{amount(snapshot?.balances?.mint ?? 0n)}</strong><button disabled={busy || !snapshot?.balances?.mint} onClick={() => run(async () => { const { hidden } = await withSigner(); await send('Withdraw mint proceeds', () => hidden.withdrawMintProceeds()); })}>Withdraw mint income</button></div><div><small>Creator licence income</small><strong>{amount(snapshot?.balances?.licences ?? 0n)}</strong><button disabled={busy || !snapshot?.balances?.licences} onClick={() => run(async () => { const { licences } = await withSigner(); await send('Withdraw licence proceeds', () => licences.withdrawLicenceProceeds()); })}>Withdraw licence income</button></div></div>
            <h3>Non-transferable receipts</h3>{snapshot?.receipts.length ? <div className="receipt-list">{snapshot.receipts.map(receipt => <article key={receipt.id.toString()}><strong>Licence #{receipt.id.toString()}</strong><span>{receipt.collection.toLowerCase() === manifest.sketches.toLowerCase() ? 'Sketches' : 'Hidden Canvas'} #{receipt.tokenId.toString()}</span><small>Issued {new Date(Number(receipt.issuedAt) * 1000).toLocaleString()} · Terms v{receipt.termsVersion.toString()}</small><code>Content {receipt.contentHash}</code></article>)}</div> : <p className="empty">No licences for this account yet.</p>}
            <details><summary>Fixed licence terms</summary><p>{snapshot?.terms}</p></details>
          </>}
        </section> : selected ? detail(selected) : <section className="gallery">
          <div className="section-heading"><div><p className="eyebrow">CURATED ON SEPOLIA</p><h2>{view === 'sketches' ? 'Sketches' : view === 'hidden' ? 'Hidden Canvas' : view === 'mine' ? 'My NFTs' : 'Explore the collections'}</h2><p>{view === 'hidden' ? 'Each work begins sealed. Its owner decides when to reveal it.' : view === 'sketches' ? 'Ten original artworks, minted once and ready to collect.' : view === 'mine' ? 'Artworks held by your connected wallet.' : 'Discover original and generative artwork.'}</p></div>{view === 'hidden' && <button disabled={busy || !account || !snapshot || snapshot.hiddenSupply >= snapshot.hiddenMax} onClick={() => run(async () => { const { hidden } = await withSigner(); await send('Mint Hidden Canvas', () => hidden.mint({ value: snapshot!.mintPrice })); })}>Mint Hidden Canvas · {snapshot && amount(snapshot.mintPrice)}</button>}</div>
          <div className="browse-tools"><span>{visible.length} {visible.length === 1 ? 'artwork' : 'artworks'}</span><label className="listing-toggle"><input type="checkbox" checked={listedOnly} onChange={event => setListedOnly(event.target.checked)}/> Listed only</label>{(normalizedQuery || listedOnly) && <button className="clear-filters" onClick={() => { setQuery(''); setListedOnly(false); }}>Clear filters</button>}</div>
          {visible.length ? <div className="card-grid">{visible.map(item => <button className="art-card" key={item.key} onClick={() => { invalidate(); setSelectedKey(item.key); }}><span className="card-image"><img src={item.image} alt={item.name}/><span className={`card-badge ${item.collection === 'hidden' && item.publication === 'sealed' ? 'sealed' : ''}`}>{item.collection === 'sketches' ? 'Original' : item.publication === 'authorized' ? 'Proof pending' : item.publication === 'sealed' ? 'Sealed' : 'Revealed'}</span></span><span className="card-body"><span className="card-meta">{item.collection === 'sketches' ? 'SKETCHES' : 'HIDDEN CANVAS'} · #{item.tokenId}</span><strong>{item.name}</strong><span className="card-bottom"><small>{item.listing ? 'FIXED PRICE' : 'STATUS'}</small><b>{item.listing ? amount(item.listing.price) : item.publication === 'authorized' ? 'Public proof pending' : item.collection === 'hidden' && item.publication === 'sealed' ? 'Sealed' : 'Not listed'}</b></span></span></button>)}</div> : <div className="empty">{view === 'mine' && !account ? 'Connect MetaMask to see your NFTs.' : normalizedQuery || listedOnly ? 'No artworks match these filters.' : 'No items to show yet.'}</div>}
        </section>}
        <footer><span><img src="/cryptx-mark.svg" alt=""/>CryptX · Sepolia art marketplace</span><button className="text-button" onClick={() => download('sepolia-marketplace.json', manifest)}>Download deployment manifest</button></footer>
      </>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
