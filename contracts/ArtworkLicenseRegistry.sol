// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {IProjectCollection} from './interfaces/IProjectCollection.sol';

/// @notice Educational, non-transferable licence receipts for the two project collections.
contract ArtworkLicenseRegistry is ReentrancyGuard {
    string public constant TERMS = "Canvas Market demo licence v1. The named licensee may reproduce and display the identified artwork in commercial projects, non-exclusively, with attribution to its collection creator. The licence cannot be transferred or sublicensed. NFT ownership, copyright and project trademarks do not transfer. This Sepolia receipt is an educational record; legal enforceability is not guaranteed.";
    uint256 public constant TERMS_VERSION = 1;

    struct Receipt {
        address licensee;
        address collection;
        uint256 tokenId;
        uint256 termsVersion;
        bytes32 termsHash;
        bytes32 contentHash;
        uint256 issuedAt;
    }

    address public immutable sketches;
    address public immutable hiddenCanvas;
    uint256 public immutable licenceFee;
    uint256 public nextReceiptId = 1;
    mapping(uint256 => Receipt) public receipts;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public receiptFor;
    mapping(address => uint256[]) private ownedReceipts;
    mapping(address => uint256) public creatorProceeds;

    event LicenceIssued(uint256 indexed receiptId, address indexed licensee, address indexed collection, uint256 tokenId, bytes32 contentHash, bytes32 termsHash);
    event LicenceProceedsWithdrawn(address indexed creator, uint256 amount);

    error InvalidCollections();
    error InvalidFee();
    error CollectionNotAllowed();
    error IncorrectPayment();
    error AlreadyLicensed();
    error InvalidCreator();
    error NothingToWithdraw();
    error WithdrawalFailed();

    constructor(address sketches_, address hiddenCanvas_, uint256 licenceFee_) {
        if (sketches_ == address(0) || hiddenCanvas_ == address(0) || sketches_ == hiddenCanvas_ || sketches_.code.length == 0 || hiddenCanvas_.code.length == 0) revert InvalidCollections();
        if (licenceFee_ == 0) revert InvalidFee();
        sketches = sketches_;
        hiddenCanvas = hiddenCanvas_;
        licenceFee = licenceFee_;
    }

    function termsHash() public pure returns (bytes32) { return keccak256(bytes(TERMS)); }

    function licenseCount(address licensee) external view returns (uint256) { return ownedReceipts[licensee].length; }

    function licenseReceiptIdAt(address licensee, uint256 index) external view returns (uint256) {
        return ownedReceipts[licensee][index];
    }

    function obtainLicence(address collection, uint256 tokenId) external payable nonReentrant returns (uint256 receiptId) {
        if (collection != sketches && collection != hiddenCanvas) revert CollectionNotAllowed();
        if (msg.value != licenceFee) revert IncorrectPayment();
        if (receiptFor[msg.sender][collection][tokenId] != 0) revert AlreadyLicensed();

        // Hidden Canvas reverts here until its seed has a verified public reveal.
        bytes32 contentHash = IProjectCollection(collection).artworkHash(tokenId);
        address licensor = IProjectCollection(collection).creator();
        if (licensor == address(0)) revert InvalidCreator();

        receiptId = nextReceiptId++;
        bytes32 hash = termsHash();
        receipts[receiptId] = Receipt(msg.sender, collection, tokenId, TERMS_VERSION, hash, contentHash, block.timestamp);
        receiptFor[msg.sender][collection][tokenId] = receiptId;
        ownedReceipts[msg.sender].push(receiptId);
        creatorProceeds[licensor] += msg.value;
        emit LicenceIssued(receiptId, msg.sender, collection, tokenId, contentHash, hash);
    }

    function withdrawLicenceProceeds() external nonReentrant {
        uint256 amount = creatorProceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        creatorProceeds[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}('');
        if (!ok) revert WithdrawalFailed();
        emit LicenceProceedsWithdrawn(msg.sender, amount);
    }
}
