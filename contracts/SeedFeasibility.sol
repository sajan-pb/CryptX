// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, euint64} from '@fhevm/solidity/lib/FHE.sol';
import {ZamaEthereumConfig} from '@fhevm/solidity/config/ZamaConfig.sol';
import {TokenAccessController} from './TokenAccessController.sol';

/// @notice Phase 1 experiment, NOT the ERC-721 collection or marketplace.
contract SeedFeasibility is ZamaEthereumConfig {
    enum Publication { SEALED, PUBLICATION_AUTHORIZED, PUBLISHED }
    struct Seed {
        address owner;
        TokenAccessController controller;
        euint64 encrypted;
        uint256 eligibleBlock;
        uint256 epoch;
        Publication publication;
        uint64 revealed;
    }
    mapping(uint256 => Seed) private seeds;
    uint256 public totalSupply;
    uint256 public immutable activationDelayBlocks;
    error WrongNetwork();
    error InvalidDelay();
    error OnlyOwner();
    error NotMature();
    error WrongEpoch();
    error WrongPublicationState();
    error InvalidRecipient();
    error SupplyExhausted();

    constructor(uint256 delay) {
        if (block.chainid != 31337 && block.chainid != 11155111) revert WrongNetwork();
        if (block.chainid == 11155111 && delay != 96) revert InvalidDelay();
        activationDelayBlocks = delay;
    }

    function mint() external returns (uint256 id) {
        if (totalSupply == 20) revert SupplyExhausted();
        id = ++totalSupply;
        Seed storage s = seeds[id];
        s.owner = msg.sender;
        s.controller = new TokenAccessController();
        s.encrypted = FHE.randEuint64();
        FHE.allowThis(s.encrypted);
        FHE.allow(s.encrypted, address(s.controller));
        s.eligibleBlock = block.number + activationDelayBlocks;
        s.epoch = 1;
    }

    function state(uint256 id) external view returns (Seed memory) { return seeds[id]; }

    function activate(uint256 id, uint256 expectedEpoch) external {
        Seed storage s = seeds[id];
        _eligible(s, expectedEpoch);
        if (s.publication != Publication.SEALED) revert WrongPublicationState();
        s.controller.activate(msg.sender);
    }

    function transfer(uint256 id, address to) external {
        Seed storage s = seeds[id];
        if (msg.sender != s.owner) revert OnlyOwner();
        if (to == address(0) || to == address(this) || to == address(s.controller)) revert InvalidRecipient();
        if (to == s.owner) return; // Self-transfer preserves maturity and active delegation.
        s.controller.revoke();
        s.owner = to;
        s.epoch++;
        s.eligibleBlock = block.number + activationDelayBlocks;
    }

    function authorize(uint256 id, uint256 expectedEpoch) external {
        Seed storage s = seeds[id];
        _eligible(s, expectedEpoch);
        if (s.publication != Publication.SEALED) revert WrongPublicationState();
        s.controller.revoke();
        s.publication = Publication.PUBLICATION_AUTHORIZED;
        FHE.makePubliclyDecryptable(s.encrypted);
    }

    function finalize(uint256 id, uint64 clearSeed, bytes calldata proof) external {
        Seed storage s = seeds[id];
        if (s.publication != Publication.PUBLICATION_AUTHORIZED) revert WrongPublicationState();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(s.encrypted);
        FHE.checkSignatures(handles, abi.encode(clearSeed), proof);
        s.revealed = clearSeed;
        s.publication = Publication.PUBLISHED;
    }

    function _eligible(Seed storage s, uint256 expectedEpoch) private view {
        if (msg.sender != s.owner) revert OnlyOwner();
        if (s.epoch != expectedEpoch) revert WrongEpoch();
        if (block.number < s.eligibleBlock) revert NotMature();
    }
}
