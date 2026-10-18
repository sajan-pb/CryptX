// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface IListingInvalidator {
    function invalidateFromCollection(uint256 tokenId) external;
    function isListed(address collection, uint256 tokenId) external view returns (bool);
    function isCollectionAllowed(address collection) external view returns (bool);
}

interface IProjectCollection {
    function canList(uint256 tokenId) external view returns (bool);
    function artworkHash(uint256 tokenId) external view returns (bytes32);
    function creator() external view returns (address);
    function marketplace() external view returns (address);
}
