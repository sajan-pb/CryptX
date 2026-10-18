// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {IERC165} from '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {IListingInvalidator} from './interfaces/IProjectCollection.sol';

/// @notice Ten original visible sketches, minted during construction only.
contract SketchesNFT is ERC721 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 10;
    address public immutable creator;
    address public marketplace;
    string public metadataBaseURI;
    bytes32[10] private originalAssetHashes;

    error InvalidCreator();
    error InvalidMetadataURI();
    error InvalidAssetHash();
    error OnlyCreator();
    error MarketplaceAlreadySet();
    error MarketplaceNotApproved();

    constructor(address creator_, string memory metadataBaseURI_, bytes32[10] memory assetHashes) ERC721('Sketches', 'SKETCH') {
        if (creator_ == address(0)) revert InvalidCreator();
        if (bytes(metadataBaseURI_).length == 0) revert InvalidMetadataURI();
        creator = creator_;
        metadataBaseURI = metadataBaseURI_;
        for (uint256 i = 0; i < MAX_SUPPLY; i++) {
            if (assetHashes[i] == bytes32(0)) revert InvalidAssetHash();
            originalAssetHashes[i] = assetHashes[i];
            _safeMint(creator_, i + 1);
        }
    }

    function setMarketplace(address candidate) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (marketplace != address(0)) revert MarketplaceAlreadySet();
        if (candidate.code.length == 0 || !IListingInvalidator(candidate).isCollectionAllowed(address(this))) revert MarketplaceNotApproved();
        marketplace = candidate;
    }

    function totalSupply() external pure returns (uint256) { return MAX_SUPPLY; }
    function mintingClosed() external pure returns (bool) { return true; }

    function artworkHash(uint256 tokenId) external view returns (bytes32) {
        _requireOwned(tokenId);
        return originalAssetHashes[tokenId - 1];
    }

    function canList(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(metadataBaseURI, tokenId.toString(), '.json');
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && marketplace != address(0)) {
            // Includes self-transfers. An external callback failure reverts the ERC-721 transfer.
            IListingInvalidator(marketplace).invalidateFromCollection(tokenId);
        }
    }
}
