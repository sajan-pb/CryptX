// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC721Receiver} from '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import {IERC721} from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import {SketchesNFT} from '../SketchesNFT.sol';
import {NFTMarketplace} from '../NFTMarketplace.sol';

contract RejectEtherSeller is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function link(SketchesNFT sketches, NFTMarketplace market) external {
        sketches.setMarketplace(address(market));
    }

    function list(IERC721 collection, NFTMarketplace market, uint256 tokenId, uint256 price) external {
        collection.approve(address(market), tokenId);
        market.list(address(collection), tokenId, price);
    }

    function withdraw(NFTMarketplace market) external { market.withdrawProceeds(); }

    receive() external payable { revert('recipient rejects ETH'); }
}

contract ReenteringBuyer is IERC721Receiver {
    NFTMarketplace public immutable market;
    address public targetCollection;
    uint256 public targetToken;
    uint256 public targetVersion;
    uint256 public targetPrice;
    bool public reentryBlocked;

    constructor(NFTMarketplace market_) { market = market_; }

    function setTarget(address collection, uint256 tokenId, uint256 version, uint256 price) external {
        targetCollection = collection;
        targetToken = tokenId;
        targetVersion = version;
        targetPrice = price;
    }

    function buy(address collection, uint256 tokenId, uint256 version) external payable {
        market.buy{value: msg.value}(collection, tokenId, version);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        try market.buy{value: targetPrice}(targetCollection, targetToken, targetVersion) {
            reentryBlocked = false;
        } catch {
            reentryBlocked = true;
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
