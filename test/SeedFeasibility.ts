import { expect } from 'chai';
import { ethers, fhevm, network } from 'hardhat';
import { mine } from '@nomicfoundation/hardhat-network-helpers';
import type { Signer } from 'ethers';
import type { SeedFeasibility } from '../types';

async function fixture(delay = 3) {
  const [a, b, stranger] = await ethers.getSigners();
  const seed = await (await ethers.getContractFactory('SeedFeasibility')).deploy(delay);
  await seed.waitForDeployment();
  await (await seed.connect(a).mint()).wait();
  await (await seed.connect(b).mint()).wait();
  return { seed, a, b, stranger };
}

// New key pair, signature and SDK call every time. No application plaintext cache.
async function preview(seed: SeedFeasibility, id: number, signer: Signer, controllerId = id) {
  const s = await seed.state(id);
  const controller = (await seed.state(controllerId)).controller;
  const address = await seed.getAddress();
  const keys = fhevm.generateKeypair();
  const start = Math.floor(Date.now() / 1000) - 30;
  const typed = fhevm.createDelegatedUserDecryptEIP712(keys.publicKey, [address], controller, start, 1);
  const signature = await signer.signTypedData(typed.domain, {
    DelegatedUserDecryptRequestVerification: [...typed.types.DelegatedUserDecryptRequestVerification],
  }, typed.message);
  return fhevm.delegatedUserDecrypt(
    [{ handle: s.encrypted, contractAddress: address }], keys.privateKey, keys.publicKey,
    signature, [address], controller, await signer.getAddress(), start, 1,
  );
}

async function rejectsAccess(request: Promise<unknown>) {
  let error: unknown;
  try { await request; } catch (e) { error = e; }
  expect(error, 'expected an explicit authorization rejection').to.be.instanceOf(Error);
  expect((error as Error).message).to.match(/not authorized|not allowed|permission/i);
}

describe('Phase 1 — local mock feasibility (not live cryptography)', function () {
  before(function () { if (!fhevm.isMock) this.skip(); });

  it('repeatable A preview; rejects B and cross-token access; revokes A and enables B', async function () {
    const { seed, a, b } = await fixture();
    await mine(3);
    await seed.connect(a).activate(1, 1);
    await seed.connect(b).activate(2, 1);
    const first = await preview(seed, 1, a);
    expect(await preview(seed, 1, a)).to.deep.equal(first);
    await rejectsAccess(preview(seed, 1, b));
    await rejectsAccess(preview(seed, 2, a, 1));
    await seed.connect(a).transfer(1, b.address);
    await rejectsAccess(preview(seed, 1, a));
    await expect(seed.connect(a).activate(1, 1)).to.be.revertedWithCustomError(seed, 'OnlyOwner');
    await mine(3);
    await expect(seed.connect(b).activate(1, 1)).to.be.revertedWithCustomError(seed, 'WrongEpoch');
    await seed.connect(b).activate(1, 2);
    expect(await preview(seed, 1, b)).to.deep.equal(first);
    await rejectsAccess(preview(seed, 1, a));
  });

  it('never grants direct holder permission or exposes controller administration', async function () {
    const { seed, a, b } = await fixture();
    await mine(3);
    await seed.activate(1, 1);
    const s = await seed.state(1);
    const controller = await ethers.getContractAt('TokenAccessController', s.controller);
    await expect(controller.connect(b).activate(b.address)).to.be.revertedWithCustomError(controller, 'OnlyCollection');
    await expect(controller.connect(a).revoke()).to.be.revertedWithCustomError(controller, 'OnlyCollection');
    await rejectsAccess(fhevm.userDecryptEuint(5, s.encrypted, await seed.getAddress(), a));
  });

  it('enforces maturity for both activation and reveal at the exact block boundary', async function () {
    const { seed } = await fixture(8);
    const s = await seed.state(1);
    await expect(seed.activate(1, 1)).to.be.revertedWithCustomError(seed, 'NotMature');
    await expect(seed.authorize(1, 1)).to.be.revertedWithCustomError(seed, 'NotMature');
    const current = await ethers.provider.getBlockNumber();
    await mine(Number(s.eligibleBlock) - current - 1);
    const receipt = await (await seed.activate(1, 1)).wait();
    expect(receipt!.blockNumber).to.equal(Number(s.eligibleBlock));
  });

  it('requires owner authorization, binds proof, survives transfer and allows anyone to finalize', async function () {
    const { seed, a, b, stranger } = await fixture();
    await mine(3);
    const s = await seed.state(1);
    await rejectsAccess(fhevm.publicDecrypt([s.encrypted]));
    await expect(seed.connect(b).authorize(1, 1)).to.be.revertedWithCustomError(seed, 'OnlyOwner');
    await seed.activate(1, 1);
    const privateResult = await preview(seed, 1, a);
    await seed.authorize(1, 1);
    expect((await seed.state(1)).publication).to.equal(1);
    // Interruption recovery: subsequent unrelated account obtains the public proof.
    await seed.transfer(1, b.address);
    await expect(seed.connect(a).authorize(1, 2)).to.be.revertedWithCustomError(seed, 'OnlyOwner');
    const result = await fhevm.publicDecrypt([s.encrypted]);
    const value = result.clearValues[s.encrypted as `0x${string}`] as bigint;
    expect(value).to.equal(privateResult[s.encrypted as `0x${string}`]);
    await expect(seed.finalize(1, value, '0x')).to.be.reverted;
    await expect(seed.finalize(1, value ^ 1n, result.decryptionProof)).to.be.reverted;
    await seed.connect(b).authorize(2, 1);
    const other = await fhevm.publicDecrypt([(await seed.state(2)).encrypted]);
    await expect(seed.finalize(1, value, other.decryptionProof)).to.be.reverted;
    await seed.connect(stranger).finalize(1, value, result.decryptionProof);
    expect((await seed.state(1)).revealed).to.equal(value);
    expect((await seed.state(1)).publication).to.equal(2);
    await expect(seed.finalize(1, value, result.decryptionProof)).to.be.revertedWithCustomError(seed, 'WrongPublicationState');
    await expect(seed.connect(b).authorize(1, 2)).to.be.revertedWithCustomError(seed, 'WrongPublicationState');
    await seed.connect(b).transfer(1, a.address);
    expect((await seed.state(1)).publication).to.equal(2);
  });

  it('self-transfer preserves the ownership epoch, maturity and delegation', async function () {
    const { seed, a } = await fixture();
    await mine(3);
    await seed.activate(1, 1);
    const before = await seed.state(1);
    await seed.transfer(1, a.address);
    const after = await seed.state(1);
    expect(after.epoch).to.equal(before.epoch);
    expect(after.eligibleBlock).to.equal(before.eligibleBlock);
    await preview(seed, 1, a);
  });

  it('same-block revoke failure atomically prevents transfer', async function () {
    const { seed, a, b } = await fixture();
    await mine(3);
    await network.provider.send('evm_setAutomine', [false]);
    try {
      const nonce = await a.getNonce();
      const activate = await seed.activate(1, 1, { nonce, gasLimit: 1_000_000 });
      const transfer = await seed.transfer(1, b.address, { nonce: nonce + 1, gasLimit: 1_000_000 });
      await network.provider.send('evm_mine');
      expect((await ethers.provider.getTransactionReceipt(activate.hash))!.status).to.equal(1);
      expect((await ethers.provider.getTransactionReceipt(transfer.hash))!.status).to.equal(0);
      expect((await seed.state(1)).owner).to.equal(a.address);
    } finally {
      await network.provider.send('evm_setAutomine', [true]);
    }
    await seed.transfer(1, b.address);
    expect((await seed.state(1)).owner).to.equal(b.address);
    await rejectsAccess(preview(seed, 1, a));
  });
});
