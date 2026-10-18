// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {Base64} from '@openzeppelin/contracts/utils/Base64.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {FHE, euint64} from '@fhevm/solidity/lib/FHE.sol';
import {ZamaEthereumConfig} from '@fhevm/solidity/config/ZamaConfig.sol';
import {TokenAccessController} from './TokenAccessController.sol';
import {IListingInvalidator} from './interfaces/IProjectCollection.sol';
import {CanvasArt} from './CanvasArt.sol';

/// @notice Holder-controlled private preview and permanent public artwork reveal.
contract HiddenCanvasNFT is ERC721, ReentrancyGuard, ZamaEthereumConfig {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 20;
    string public constant RENDERER_VERSION = 'canvas-market-v1';
    string public constant SEALED_IMAGE_URI = 'http://127.0.0.1:5173/art/sealed.svg';

    enum Publication { SEALED, PUBLICATION_AUTHORIZED, PUBLISHED }
    struct Secret {
        TokenAccessController controller;
        euint64 encrypted;
        uint256 eligibleBlock;
        uint256 epoch;
        Publication publication;
        uint64 revealed;
    }

    address public immutable creator;
    uint256 public immutable mintPrice;
    uint256 public immutable activationDelayBlocks;
    address public marketplace;
    uint256 public totalSupply;
    uint256 public mintProceeds;
    mapping(uint256 => Secret) private secrets;

    event HiddenMinted(uint256 indexed tokenId, address indexed firstHolder, address controller);
    event PreviewActivated(uint256 indexed tokenId, address indexed holder, uint256 epoch);
    event PublicationAuthorized(uint256 indexed tokenId, bytes32 indexed handle);
    event Published(uint256 indexed tokenId, uint64 seed);
    event MintProceedsWithdrawn(address indexed creator, uint256 amount);

    error InvalidCreator();
    error InvalidPrice();
    error InvalidDelay();
    error WrongNetwork();
    error SupplyExhausted();
    error IncorrectPayment();
    error OnlyCreator();
    error MarketplaceAlreadySet();
    error MarketplaceNotApproved();
    error OnlyCurrentOwner();
    error WrongEpoch();
    error NotMature();
    error WrongPublicationState();
    error TokenIsListed();
    error NothingToWithdraw();
    error WithdrawalFailed();

    constructor(address creator_, uint256 mintPrice_, uint256 activationDelayBlocks_) ERC721('Hidden Canvas', 'HCANVAS') {
        if (block.chainid != 31337 && block.chainid != 11155111) revert WrongNetwork();
        if (creator_ == address(0)) revert InvalidCreator();
        if (mintPrice_ == 0) revert InvalidPrice();
        if (block.chainid == 11155111 && activationDelayBlocks_ != 96) revert InvalidDelay();
        creator = creator_;
        mintPrice = mintPrice_;
        activationDelayBlocks = activationDelayBlocks_;
    }

    function setMarketplace(address candidate) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (marketplace != address(0)) revert MarketplaceAlreadySet();
        if (candidate.code.length == 0 || !IListingInvalidator(candidate).isCollectionAllowed(address(this))) revert MarketplaceNotApproved();
        marketplace = candidate;
    }

    function mint() external payable nonReentrant returns (uint256 id) {
        if (totalSupply == MAX_SUPPLY) revert SupplyExhausted();
        if (msg.value != mintPrice) revert IncorrectPayment();
        id = ++totalSupply;
        mintProceeds += msg.value;
        Secret storage s = secrets[id];
        s.controller = new TokenAccessController();
        s.encrypted = FHE.randEuint64();
        FHE.allowThis(s.encrypted);
        FHE.allow(s.encrypted, address(s.controller));
        s.eligibleBlock = block.number + activationDelayBlocks;
        s.epoch = 1;
        _safeMint(msg.sender, id);
        emit HiddenMinted(id, msg.sender, address(s.controller));
    }

    function state(uint256 tokenId) external view returns (address owner, address controller, bytes32 handle, uint256 eligibleBlock, uint256 epoch, Publication publication, uint64 revealed) {
        owner = ownerOf(tokenId);
        Secret storage s = secrets[tokenId];
        return (owner, address(s.controller), FHE.toBytes32(s.encrypted), s.eligibleBlock, s.epoch, s.publication, s.revealed);
    }

    function activatePrivatePreview(uint256 tokenId, uint256 expectedEpoch) external {
        Secret storage s = secrets[tokenId];
        _eligible(tokenId, s, expectedEpoch);
        if (s.publication != Publication.SEALED) revert WrongPublicationState();
        s.controller.activate(msg.sender);
        emit PreviewActivated(tokenId, msg.sender, s.epoch);
    }

    function authorizePublicReveal(uint256 tokenId, uint256 expectedEpoch) external {
        Secret storage s = secrets[tokenId];
        _eligible(tokenId, s, expectedEpoch);
        if (s.publication != Publication.SEALED) revert WrongPublicationState();
        if (marketplace != address(0) && IListingInvalidator(marketplace).isListed(address(this), tokenId)) revert TokenIsListed();
        s.controller.revoke();
        s.publication = Publication.PUBLICATION_AUTHORIZED;
        FHE.makePubliclyDecryptable(s.encrypted);
        emit PublicationAuthorized(tokenId, FHE.toBytes32(s.encrypted));
    }

    function completeReveal(uint256 tokenId, uint64 clearSeed, bytes calldata proof) external {
        Secret storage s = secrets[tokenId];
        ownerOf(tokenId);
        if (s.publication != Publication.PUBLICATION_AUTHORIZED) revert WrongPublicationState();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(s.encrypted);
        FHE.checkSignatures(handles, abi.encode(clearSeed), proof);
        s.revealed = clearSeed;
        s.publication = Publication.PUBLISHED;
        emit Published(tokenId, clearSeed);
    }

    function canList(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        Publication stage = secrets[tokenId].publication;
        return stage == Publication.SEALED || stage == Publication.PUBLISHED;
    }

    function artworkHash(uint256 tokenId) external view returns (bytes32) {
        ownerOf(tokenId);
        Secret storage s = secrets[tokenId];
        if (s.publication != Publication.PUBLISHED) revert WrongPublicationState();
        return keccak256(abi.encode(RENDERER_VERSION, s.revealed));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        Secret storage s = secrets[tokenId];
        string memory label = string.concat('Hidden Canvas #', tokenId.toString());
        if (s.publication != Publication.PUBLISHED) {
            string memory phase = s.publication == Publication.SEALED ? 'sealed' : 'publication authorized; proof pending';
            return string.concat('data:application/json;base64,', Base64.encode(bytes(string.concat(
                '{"name":"', label, '","description":"Generative artwork; ', phase,
                '. Public content is pending verified reveal.","image":"', SEALED_IMAGE_URI,
                '","attributes":[{"trait_type":"Publication","value":"', phase, '"}]}'
            ))));
        }
        string memory image = string.concat('data:image/svg+xml;base64,', Base64.encode(bytes(CanvasArt.renderSvg(s.revealed))));
        return string.concat('data:application/json;base64,', Base64.encode(bytes(string.concat(
            '{"name":"', label, '","description":"Canvas Market deterministic painting, renderer ', RENDERER_VERSION,
            '. Public seed and traits were verified on-chain.","image":"', image,
            '","attributes":[{"trait_type":"Rarity","value":"', CanvasArt.rarity(s.revealed),
            '"},{"trait_type":"Palette","value":"', CanvasArt.paletteName(s.revealed),
            '"},{"trait_type":"Motion","value":"', CanvasArt.motionName(s.revealed),
            '"},{"trait_type":"Motifs","value":', CanvasArt.motifCount(s.revealed).toString(),
            '}],"seed":"', uint256(s.revealed).toString(), '","renderer":"', RENDERER_VERSION, '"}'
        ))));
    }

    function withdrawMintProceeds() external nonReentrant {
        if (msg.sender != creator) revert OnlyCreator();
        uint256 amount = mintProceeds;
        if (amount == 0) revert NothingToWithdraw();
        mintProceeds = 0;
        (bool ok,) = payable(creator).call{value: amount}('');
        if (!ok) revert WithdrawalFailed();
        emit MintProceedsWithdrawn(creator, amount);
    }

    function _eligible(uint256 tokenId, Secret storage s, uint256 expectedEpoch) private view {
        if (msg.sender != ownerOf(tokenId)) revert OnlyCurrentOwner();
        if (s.epoch != expectedEpoch) revert WrongEpoch();
        if (block.number < s.eligibleBlock) revert NotMature();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) {
            Secret storage s = secrets[tokenId];
            if (to != from) {
                if (s.publication == Publication.SEALED) s.controller.revoke();
                ++s.epoch;
                s.eligibleBlock = block.number + activationDelayBlocks;
            }
            if (marketplace != address(0)) IListingInvalidator(marketplace).invalidateFromCollection(tokenId);
        }
    }
}
