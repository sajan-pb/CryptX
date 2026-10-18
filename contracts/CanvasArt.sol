// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';

/// @notice Canonical renderer for Hidden Canvas v1. Keep in lockstep with frontend/src/lib/art.ts.
library CanvasArt {
    using Strings for uint256;

    struct Geometry { uint256 x; uint256 y; uint256 width; uint256 height; int256 tilt; }
    struct Colors { string ink; string accent; string paper; string mid; }

    string internal constant VERSION = 'canvas-market-v1';

    function rarity(uint64 seed) internal pure returns (string memory) {
        uint256 value = uint256(seed) >> 56;
        if (value < 128) return 'Common';
        if (value < 205) return 'Rare';
        if (value < 243) return 'Exceptional';
        return 'Singular';
    }

    function paletteName(uint64 seed) internal pure returns (string memory) {
        uint256 value = ((uint256(seed) >> 48) & 255) % 8;
        if (value == 0) return 'Moss';
        if (value == 1) return 'Tide';
        if (value == 2) return 'Dusk';
        if (value == 3) return 'Grove';
        if (value == 4) return 'Clay';
        if (value == 5) return 'Mist';
        if (value == 6) return 'Violet';
        return 'Lagoon';
    }

    function motionName(uint64 seed) internal pure returns (string memory) {
        uint256 value = ((uint256(seed) >> 40) & 255) % 4;
        if (value == 0) return 'Drift';
        if (value == 1) return 'Orbit';
        if (value == 2) return 'Rise';
        return 'Fold';
    }

    function motifCount(uint64 seed) internal pure returns (uint256) {
        return 8 + (((uint256(seed) >> 32) & 255) % 9);
    }

    function palette(uint64 seed) internal pure returns (string memory ink, string memory accent, string memory paper, string memory mid) {
        uint256 value = ((uint256(seed) >> 48) & 255) % 8;
        if (value == 0) return ('#283e3b', '#d1a886', '#eee3cf', '#829485');
        if (value == 1) return ('#233950', '#d7b594', '#ece0cd', '#788ca1');
        if (value == 2) return ('#463748', '#cf9b87', '#eee0d6', '#93768e');
        if (value == 3) return ('#3c4833', '#ceb986', '#f0e5d3', '#8a9b73');
        if (value == 4) return ('#523c32', '#c98f72', '#efe0c9', '#9d8169');
        if (value == 5) return ('#293b47', '#b7a891', '#eee2d1', '#71949a');
        if (value == 6) return ('#473f58', '#d1a69d', '#eee0df', '#857d9f');
        return ('#34504a', '#c7b08a', '#ece7d7', '#7a9b8b');
    }

    function renderSvg(uint64 seed) internal pure returns (string memory svg) {
        Colors memory colors;
        (colors.ink, colors.accent, colors.paper, colors.mid) = palette(seed);
        svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-label="Canvas Market ',
            rarity(seed), ' ', paletteName(seed), ' ', motionName(seed), '"><rect width="640" height="640" fill="', colors.paper,
            '"/><rect x="24" y="24" width="592" height="592" fill="none" stroke="', colors.ink, '" stroke-width="2" opacity=".3"/>'
        );
        uint64 state = seed == 0 ? 0x9e3779b97f4a7c15 : seed;
        uint256 count = motifCount(seed);
        uint256 motion = ((uint256(seed) >> 40) & 255) % 4;
        for (uint256 i = 0; i < count; i++) {
            Geometry memory g;
            (g, state) = _geometry(state);
            string memory fill = i % 3 == 0 ? colors.accent : i % 3 == 1 ? colors.mid : colors.ink;
            svg = string.concat(svg, _shape(motion, i, g, fill));
        }
        return string.concat(svg, '<path d="M 45 562 H 595" stroke="', colors.ink,
            '" stroke-width="2" opacity=".4"/><text x="47" y="590" fill="', colors.ink,
            '" font-size="13" font-family="serif" letter-spacing="3">HIDDEN CANVAS / ', VERSION, '</text></svg>');
    }

    function _geometry(uint64 state) private pure returns (Geometry memory g, uint64 nextState) {
        state = _next(state);
        g.x = 45 + uint256(state) % 550;
        state = _next(state);
        g.y = 45 + uint256(state) % 550;
        state = _next(state);
        g.width = 35 + uint256(state) % 130;
        state = _next(state);
        g.height = 25 + uint256(state) % 125;
        state = _next(state);
        g.tilt = int256(uint256(state) % 110) - 55;
        return (g, state);
    }

    function _next(uint64 value) private pure returns (uint64) {
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        return value;
    }

    function _shape(uint256 motion, uint256 index, Geometry memory g, string memory fill) private pure returns (string memory) {
        string memory opacity = _opacity(index);
        if (motion == 1) {
            string memory a = string.concat('<ellipse cx="', g.x.toString(), '" cy="', g.y.toString(), '" rx="', g.width.toString(), '" ry="', g.height.toString());
            string memory b = string.concat('" fill="none" stroke="', fill, '" stroke-width="', (4 + index % 9).toString(), '" opacity="', opacity);
            return string.concat(a, b, '" transform="rotate(', Strings.toStringSigned(g.tilt), ' ', g.x.toString(), ' ', g.y.toString(), ')"/>');
        }
        if (motion == 2) {
            string memory a = string.concat('<path d="M ', g.x.toString(), ' ', (g.y + g.height).toString(), ' Q ', _half(2 * g.x + g.width));
            string memory b = string.concat(' ', Strings.toStringSigned(int256(g.y) - int256(g.height)), ' ', (g.x + g.width).toString(), ' ', g.y.toString());
            return string.concat(a, b, '" fill="none" stroke="', fill, '" stroke-width="', (5 + index % 9).toString(),
                '" stroke-linecap="round" opacity="', opacity, '"/>');
        }
        if (motion == 3) {
            string memory a = string.concat('<path d="M ', g.x.toString(), ' ', g.y.toString(), ' L ', (g.x + g.width).toString(), ' ', _half(2 * g.y + g.height));
            string memory b = string.concat(' L ', g.x.toString(), ' ', (g.y + g.height).toString(), ' Z" fill="', fill, '" opacity="', opacity);
            return string.concat(a, b, '" transform="rotate(', Strings.toStringSigned(g.tilt), ' ', g.x.toString(), ' ', g.y.toString(), ')"/>');
        }
        string memory a = string.concat('<rect x="', g.x.toString(), '" y="', g.y.toString(), '" width="', g.width.toString(),
            '" height="', g.height.toString(), '" rx="', (6 + index % 18).toString());
        string memory b = string.concat('" fill="', fill, '" opacity="', opacity, '" transform="rotate(', Strings.toStringSigned(g.tilt));
        return string.concat(a, b, ' ', g.x.toString(), ' ', g.y.toString(), ')"/>');
    }

    function _half(uint256 doubled) private pure returns (string memory) {
        if (doubled % 2 == 0) return (doubled / 2).toString();
        return string.concat((doubled / 2).toString(), '.5');
    }

    function _opacity(uint256 index) private pure returns (string memory) {
        uint256 value = index % 5;
        if (value == 0) return '0.24';
        if (value == 1) return '0.37';
        if (value == 2) return '0.50';
        if (value == 3) return '0.63';
        return '0.76';
    }
}
