// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC721} from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import {IERC165} from '@openzeppelin/contracts/utils/introspection/IERC165.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {IProjectCollection} from './interfaces/IProjectCollection.sol';

/// @notice Non-escrow fixed-price sales for the two immutable project collections.
contract NFTMarketplace is ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        uint256 version;
        bool active;
    }

    address public immutable sketches;
    address public immutable hiddenCanvas;
    mapping(address => mapping(uint256 => Listing)) public listings;
    mapping(address => mapping(uint256 => uint256)) public listingVersion;
    mapping(address => uint256) public proceeds;

    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price, uint256 version);
    event Cancelled(address indexed collection, uint256 indexed tokenId, uint256 version);
    event Sold(address indexed collection, uint256 indexed tokenId, address indexed seller, address buyer, uint256 price, uint256 version);
    event Invalidated(address indexed collection, uint256 indexed tokenId, uint256 version);
    event ProceedsWithdrawn(address indexed seller, uint256 amount);

    error InvalidCollections();
    error CollectionNotAllowed();
    error CollectionNotLinked();
    error NotOwner();
    error NotApproved();
    error NotListable();
    error InvalidPrice();
    error NotListingSeller();
    error StaleListing();
    error SelfPurchase();
    error IncorrectPayment();
    error NothingToWithdraw();
    error WithdrawalFailed();

    constructor(address sketches_, address hiddenCanvas_) {
        if (sketches_ == address(0) || hiddenCanvas_ == address(0) || sketches_ == hiddenCanvas_ || sketches_.code.length == 0 || hiddenCanvas_.code.length == 0) revert InvalidCollections();
        if (!IERC165(sketches_).supportsInterface(type(IERC721).interfaceId) || !IERC165(hiddenCanvas_).supportsInterface(type(IERC721).interfaceId)) revert InvalidCollections();
        sketches = sketches_;
        hiddenCanvas = hiddenCanvas_;
    }

    function isCollectionAllowed(address collection) public view returns (bool) {
        return collection == sketches || collection == hiddenCanvas;
    }

    function isListed(address collection, uint256 tokenId) external view returns (bool) {
        return listings[collection][tokenId].active;
    }

    function list(address collection, uint256 tokenId, uint256 price) external nonReentrant returns (uint256 version) {
        _validateCollection(collection);
        if (price == 0) revert InvalidPrice();
        if (!IProjectCollection(collection).canList(tokenId)) revert NotListable();
        if (IERC721(collection).ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (!_approved(collection, tokenId, msg.sender)) revert NotApproved();
        version = ++listingVersion[collection][tokenId];
        listings[collection][tokenId] = Listing(msg.sender, price, version, true);
        emit Listed(collection, tokenId, msg.sender, price, version);
    }

    function cancel(address collection, uint256 tokenId) external nonReentrant {
        _validateCollection(collection);
        Listing memory listing = listings[collection][tokenId];
        if (!listing.active || listing.seller != msg.sender) revert NotListingSeller();
        delete listings[collection][tokenId];
        uint256 version = ++listingVersion[collection][tokenId];
        emit Cancelled(collection, tokenId, version);
    }

    function buy(address collection, uint256 tokenId, uint256 expectedVersion) external payable nonReentrant {
        _validateCollection(collection);
        Listing memory listing = listings[collection][tokenId];
        if (!listing.active || listing.version != expectedVersion) revert StaleListing();
        if (msg.sender == listing.seller) revert SelfPurchase();
        if (msg.value != listing.price) revert IncorrectPayment();
        if (IERC721(collection).ownerOf(tokenId) != listing.seller || !_approved(collection, tokenId, listing.seller)) revert StaleListing();
        if (!IProjectCollection(collection).canList(tokenId)) revert NotListable();

        // State and seller credit precede both ERC-721 and receiver callbacks.
        delete listings[collection][tokenId];
        ++listingVersion[collection][tokenId];
        proceeds[listing.seller] += listing.price;
        IERC721(collection).safeTransferFrom(listing.seller, msg.sender, tokenId);
        emit Sold(collection, tokenId, listing.seller, msg.sender, listing.price, expectedVersion);
    }

    function invalidateFromCollection(uint256 tokenId) external {
        if (!isCollectionAllowed(msg.sender)) revert CollectionNotAllowed();
        delete listings[msg.sender][tokenId];
        uint256 version = ++listingVersion[msg.sender][tokenId];
        emit Invalidated(msg.sender, tokenId, version);
    }

    function withdrawProceeds() external nonReentrant {
        uint256 amount = proceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        proceeds[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}('');
        if (!ok) revert WithdrawalFailed();
        emit ProceedsWithdrawn(msg.sender, amount);
    }

    function _validateCollection(address collection) private view {
        if (!isCollectionAllowed(collection)) revert CollectionNotAllowed();
        if (IProjectCollection(collection).marketplace() != address(this)) revert CollectionNotLinked();
    }

    function _approved(address collection, uint256 tokenId, address owner) private view returns (bool) {
        return IERC721(collection).getApproved(tokenId) == address(this) || IERC721(collection).isApprovedForAll(owner, address(this));
    }
}
