// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {CanvasArt} from '../CanvasArt.sol';

contract CanvasArtHarness {
    function renderSvg(uint64 seed) external pure returns (string memory) {
        return CanvasArt.renderSvg(seed);
    }
}
