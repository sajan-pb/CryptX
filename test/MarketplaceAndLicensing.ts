import { expect } from 'chai';
import { ethers, fhevm } from 'hardhat';
import { mine } from '@nomicfoundation/hardhat-network-helpers';
import type { Signer } from 'ethers';
import type { HiddenCanvasNFT } from '../types';

const mintPrice = ethers.parseEther('0.001');
const licenceFee = ethers.parseEther('0.0001');

async function fixture() {
  const [creator, buyer, stranger] = await ethers.getSigners();
  const hashes = Array.from({ length: 10 }, (_, i) => ethers.sha256(ethers.toUtf8Bytes(`original sketch ${i + 1}`)));
  const sketches = await (await ethers.getContractFactory('SketchesNFT')).deploy(creator.address, 'http://127.0.0.1:5173/metadata/sketches/', hashes);
  const hidden = await (await ethers.getContractFactory('HiddenCanvasNFT')).deploy(creator.address, mintPrice, 3);
  await Promise.all([sketches.waitForDeployment(), hidden.waitForDeployment()]);
  const market = await (await ethers.getContractFactory('NFTMarketplace')).deploy(await sketches.getAddress(), await hidden.getAddress());
  await market.waitForDeployment();
  await (await sketches.setMarketplace(await market.getAddress())).wait();
  await (await hidden.setMarketplace(await market.getAddress())).wait();
  const registry = await (await ethers.getContractFactory('ArtworkLicenseRegistry')).deploy(await sketches.getAddress(), await hidden.getAddress(), licenceFee);
  await registry.waitForDeployment();
  return { creator, buyer, stranger, sketches, hidden, market, registry, hashes };
}

async function previewHidden(hidden: HiddenCanvasNFT, tokenId: number, signer: Signer) {
  const state = await hidden.state(tokenId);
  const address = await hidden.getAddress();
  const keys = fhevm.generateKeypair();
  const start = Math.floor(Date.now() / 1000) - 30;
  const typed = fhevm.createDelegatedUserDecryptEIP712(keys.publicKey, [address], state.controller, start, 1);
  const signature = await signer.signTypedData(typed.domain, {
    DelegatedUserDecryptRequestVerification: [...typed.types.DelegatedUserDecryptRequestVerification],
  }, typed.message);
  const result = await fhevm.delegatedUserDecrypt(
    [{ handle: state.handle, contractAddress: address }], keys.privateKey, keys.publicKey,
    signature, [address], state.controller, await signer.getAddress(), start, 1,
  );
  return result[state.handle as `0x${string}`];
}

describe('Collections, shared marketplace and educational licences', function () {
  before(function () { if (!fhevm.isMock) this.skip(); });

  it('mints exactly ten sketches, protects listing versions, and credits sellers', async function () {
    const { creator, buyer, sketches, market, hashes } = await fixture();
    expect(await sketches.totalSupply()).to.equal(10);
    expect(await sketches.mintingClosed()).to.equal(true);
    expect(await sketches.ownerOf(1)).to.equal(creator.address);
    expect(await sketches.artworkHash(1)).to.equal(hashes[0]);
    expect(await sketches.tokenURI(1)).to.equal('http://127.0.0.1:5173/metadata/sketches/1.json');
    const collection = await sketches.getAddress();
    const price = ethers.parseEther('0.01');
    await expect(market.list(collection, 1, price)).to.be.revertedWithCustomError(market, 'NotApproved');
    await sketches.approve(await market.getAddress(), 1);
    await market.list(collection, 1, price);
    expect((await market.listings(collection, 1)).version).to.equal(1);
    await expect(market.connect(buyer).buy(collection, 1, 1, { value: price - 1n })).to.be.revertedWithCustomError(market, 'IncorrectPayment');
    await market.connect(buyer).buy(collection, 1, 1, { value: price });
    expect(await sketches.ownerOf(1)).to.equal(buyer.address);
    expect(await market.proceeds(creator.address)).to.equal(price);
    await sketches.connect(buyer).approve(await market.getAddress(), 1);
    await market.connect(buyer).list(collection, 1, price);
    const secondVersion = (await market.listings(collection, 1)).version;
    await market.connect(buyer).cancel(collection, 1);
    await market.connect(buyer).list(collection, 1, price);
    await expect(market.buy(collection, 1, secondVersion, { value: price })).to.be.revertedWithCustomError(market, 'StaleListing');
    await sketches.connect(buyer).transferFrom(buyer.address, creator.address, 1);
    expect((await market.listings(collection, 1)).active).to.equal(false);
    await expect(market.buy(collection, 1, (await market.listings(collection, 1)).version, { value: price })).to.be.revertedWithCustomError(market, 'StaleListing');
    await market.withdrawProceeds();
    expect(await market.proceeds(creator.address)).to.equal(0);
  });

  it('keeps Hidden Canvas sealed through sale and permits licensing only after verified reveal', async function () {
    const { creator, buyer, sketches, hidden, market, registry, hashes } = await fixture();
    await hidden.mint({ value: mintPrice });
    const hiddenAddress = await hidden.getAddress();
    const sealed = Buffer.from((await hidden.tokenURI(1)).split(',')[1], 'base64').toString('utf8');
    expect(sealed).to.include('sealed');
    expect(sealed).not.to.include('seed');
    expect(await hidden.totalSupply()).to.equal(1);
    await expect(registry.connect(buyer).obtainLicence(hiddenAddress, 1, { value: licenceFee })).to.be.revertedWithCustomError(hidden, 'WrongPublicationState');
    await hidden.approve(await market.getAddress(), 1);
    await market.list(hiddenAddress, 1, ethers.parseEther('0.02'));
    await mine(3);
    await expect(hidden.authorizePublicReveal(1, 1)).to.be.revertedWithCustomError(hidden, 'TokenIsListed');
    await market.cancel(hiddenAddress, 1);
    await hidden.activatePrivatePreview(1, 1);
    await expect(hidden.connect(buyer).authorizePublicReveal(1, 1)).to.be.revertedWithCustomError(hidden, 'OnlyCurrentOwner');
    const state = await hidden.state(1);
    await hidden.authorizePublicReveal(1, 1);
    expect((await hidden.state(1)).publication).to.equal(1);
    const pending = Buffer.from((await hidden.tokenURI(1)).split(',')[1], 'base64').toString('utf8');
    expect(pending).to.include('publication authorized; proof pending');
    expect(pending).not.to.include('seed');
    const result = await fhevm.publicDecrypt([state.handle]);
    const clear = result.clearValues[state.handle as `0x${string}`] as bigint;
    await expect(hidden.completeReveal(1, clear ^ 1n, result.decryptionProof)).to.be.reverted;
    await hidden.connect(buyer).completeReveal(1, clear, result.decryptionProof);
    expect((await hidden.state(1)).revealed).to.equal(clear);
    const published = JSON.parse(Buffer.from((await hidden.tokenURI(1)).split(',')[1], 'base64').toString('utf8'));
    expect(published.seed).to.equal(clear.toString());
    expect(published.image).to.match(/^data:image\/svg\+xml;base64,/);
    await expect(hidden.completeReveal(1, clear, result.decryptionProof)).to.be.revertedWithCustomError(hidden, 'WrongPublicationState');
    await expect(hidden.authorizePublicReveal(1, 1)).to.be.revertedWithCustomError(hidden, 'WrongPublicationState');

    const sketchesAddress = await sketches.getAddress();
    await registry.connect(buyer).obtainLicence(sketchesAddress, 1, { value: licenceFee });
    const sketchReceipt = await registry.receipts(1);
    expect(sketchReceipt.licensee).to.equal(buyer.address);
    expect(sketchReceipt.contentHash).to.equal(hashes[0]);
    expect(sketchReceipt.termsHash).to.equal(await registry.termsHash());
    await registry.connect(buyer).obtainLicence(hiddenAddress, 1, { value: licenceFee });
    const hiddenReceipt = await registry.receipts(2);
    expect(hiddenReceipt.contentHash).to.equal(await hidden.artworkHash(1));
    expect(hiddenReceipt.termsVersion).to.equal(1);
    expect(await registry.creatorProceeds(creator.address)).to.equal(2n * licenceFee);
    await expect(registry.connect(buyer).obtainLicence(hiddenAddress, 1, { value: licenceFee })).to.be.revertedWithCustomError(registry, 'AlreadyLicensed');
    await hidden.transferFrom(creator.address, buyer.address, 1);
    expect((await registry.receipts(2)).contentHash).to.equal(hiddenReceipt.contentHash);
    await registry.withdrawLicenceProceeds();
    expect(await registry.creatorProceeds(creator.address)).to.equal(0);
  });

  it('revokes private preview on an actual sealed marketplace sale and reactivates the buyer', async function () {
    const { creator, buyer, hidden, market } = await fixture();
    await hidden.mint({ value: mintPrice });
    await mine(3);
    await hidden.activatePrivatePreview(1, 1);
    const first = await previewHidden(hidden, 1, creator);
    await hidden.setApprovalForAll(buyer.address, true);
    await expect(hidden.connect(buyer).authorizePublicReveal(1, 1)).to.be.revertedWithCustomError(hidden, 'OnlyCurrentOwner');
    const collection = await hidden.getAddress();
    const price = ethers.parseEther('0.02');
    await hidden.approve(await market.getAddress(), 1);
    await market.list(collection, 1, price);
    await market.connect(buyer).buy(collection, 1, 1, { value: price });
    const afterSale = await hidden.state(1);
    expect(afterSale.owner).to.equal(buyer.address);
    expect(afterSale.epoch).to.equal(2);
    expect((await market.listings(collection, 1)).active).to.equal(false);
    try {
      await previewHidden(hidden, 1, creator);
      expect.fail('former owner decrypted after transfer');
    } catch (error) {
      expect(String(error)).to.match(/not authorized|not allowed|permission/i);
    }
    await expect(hidden.connect(buyer).activatePrivatePreview(1, 1)).to.be.revertedWithCustomError(hidden, 'WrongEpoch');
    await expect(hidden.connect(buyer).activatePrivatePreview(1, 2)).to.be.revertedWithCustomError(hidden, 'NotMature');
    await mine(3);
    await hidden.connect(buyer).activatePrivatePreview(1, 2);
    expect(await previewHidden(hidden, 1, buyer)).to.equal(first);
    expect(await market.proceeds(creator.address)).to.equal(price);
  });

  it('keeps preview owner-only for an approved operator and preserves it on self-transfer', async function () {
    const { creator, buyer, hidden, market } = await fixture();
    await hidden.mint({ value: mintPrice });
    await mine(3);
    await hidden.activatePrivatePreview(1, 1);
    const original = await previewHidden(hidden, 1, creator);
    await hidden.setApprovalForAll(buyer.address, true);
    await expect(hidden.connect(buyer).activatePrivatePreview(1, 1)).to.be.revertedWithCustomError(hidden, 'OnlyCurrentOwner');
    await expect(hidden.connect(buyer).authorizePublicReveal(1, 1)).to.be.revertedWithCustomError(hidden, 'OnlyCurrentOwner');
    try {
      await previewHidden(hidden, 1, buyer);
      expect.fail('approved operator decrypted private artwork');
    } catch (error) {
      expect(String(error)).to.match(/not authorized|not allowed|permission/i);
    }

    const collection = await hidden.getAddress();
    await hidden.approve(await market.getAddress(), 1);
    await market.list(collection, 1, ethers.parseEther('0.02'));
    const before = await hidden.state(1);
    await hidden.transferFrom(creator.address, creator.address, 1);
    const after = await hidden.state(1);
    expect(after.owner).to.equal(creator.address);
    expect(after.epoch).to.equal(before.epoch);
    expect(after.eligibleBlock).to.equal(before.eligibleBlock);
    expect((await market.listings(collection, 1)).active).to.equal(false);
    const controller = await ethers.getContractAt('TokenAccessController', after.controller);
    expect(await controller.activeHolder()).to.equal(creator.address);
    expect(await previewHidden(hidden, 1, creator)).to.equal(original);
  });

  it('enforces Hidden Canvas mint price, supply cap and creator-only proceeds', async function () {
    const { creator, buyer, hidden } = await fixture();
    await expect(hidden.mint({ value: mintPrice - 1n })).to.be.revertedWithCustomError(hidden, 'IncorrectPayment');
    for (let tokenId = 1; tokenId <= 20; tokenId++) {
      await hidden.connect(tokenId % 2 ? creator : buyer).mint({ value: mintPrice });
    }
    expect(await hidden.totalSupply()).to.equal(20);
    expect(await hidden.mintProceeds()).to.equal(20n * mintPrice);
    await expect(hidden.mint({ value: mintPrice })).to.be.revertedWithCustomError(hidden, 'SupplyExhausted');
    await expect(hidden.connect(buyer).withdrawMintProceeds()).to.be.revertedWithCustomError(hidden, 'OnlyCreator');
    await hidden.withdrawMintProceeds();
    expect(await hidden.mintProceeds()).to.equal(0);
  });

  it('preserves seller credit when a recipient rejects withdrawal', async function () {
    const [buyer] = await ethers.getSigners();
    const rejectingSeller = await (await ethers.getContractFactory('RejectEtherSeller')).deploy();
    const hashes = Array.from({ length: 10 }, (_, i) => ethers.sha256(ethers.toUtf8Bytes(`sketch ${i}`)));
    const sketches = await (await ethers.getContractFactory('SketchesNFT')).deploy(await rejectingSeller.getAddress(), 'http://127.0.0.1:5173/metadata/sketches/', hashes);
    const hidden = await (await ethers.getContractFactory('HiddenCanvasNFT')).deploy(buyer.address, mintPrice, 3);
    await Promise.all([sketches.waitForDeployment(), hidden.waitForDeployment()]);
    const market = await (await ethers.getContractFactory('NFTMarketplace')).deploy(await sketches.getAddress(), await hidden.getAddress());
    await market.waitForDeployment();
    await rejectingSeller.link(await sketches.getAddress(), await market.getAddress());
    await hidden.setMarketplace(await market.getAddress());
    const price = ethers.parseEther('0.01');
    await rejectingSeller.list(await sketches.getAddress(), await market.getAddress(), 1, price);
    await market.buy(await sketches.getAddress(), 1, 1, { value: price });
    expect(await market.proceeds(await rejectingSeller.getAddress())).to.equal(price);
    await expect(rejectingSeller.withdraw(await market.getAddress())).to.be.revertedWithCustomError(market, 'WithdrawalFailed');
    expect(await market.proceeds(await rejectingSeller.getAddress())).to.equal(price);
  });

  it('blocks a malicious ERC-721 receiver from buying another listing during callback', async function () {
    const { creator, sketches, market } = await fixture();
    const collection = await sketches.getAddress();
    const price = ethers.parseEther('0.01');
    await sketches.setApprovalForAll(await market.getAddress(), true);
    await market.list(collection, 1, price);
    await market.list(collection, 2, price);
    const attacker = await (await ethers.getContractFactory('ReenteringBuyer')).deploy(await market.getAddress());
    await attacker.waitForDeployment();
    await attacker.setTarget(collection, 2, 1, price);
    await creator.sendTransaction({ to: await attacker.getAddress(), value: price });
    await attacker.buy(collection, 1, 1, { value: price });
    expect(await attacker.reentryBlocked()).to.equal(true);
    expect(await sketches.ownerOf(1)).to.equal(await attacker.getAddress());
    expect(await sketches.ownerOf(2)).to.equal(creator.address);
    expect(await market.proceeds(creator.address)).to.equal(price);
  });
});
