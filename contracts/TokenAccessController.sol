// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE} from '@fhevm/solidity/lib/FHE.sol';
import {ZamaEthereumConfig} from '@fhevm/solidity/config/ZamaConfig.sol';

/// @notice One controller per seed. Only its creating collection can change delegation.
contract TokenAccessController is ZamaEthereumConfig {
    address public immutable collection;
    address public activeHolder;
    error OnlyCollection();
    error AlreadyActive();

    constructor() { collection = msg.sender; }

    modifier onlyCollection() {
        if (msg.sender != collection) revert OnlyCollection();
        _;
    }

    function activate(address holder) external onlyCollection {
        if (activeHolder != address(0)) revert AlreadyActive();
        FHE.delegateUserDecryptionWithoutExpiration(holder, collection);
        activeHolder = holder;
    }

    function revoke() external onlyCollection {
        address holder = activeHolder;
        if (holder != address(0)) {
            // Deliberately propagate ACL failures: a transfer must fail atomically.
            FHE.revokeUserDecryptionDelegation(holder, collection);
            activeHolder = address(0);
        }
    }
}
