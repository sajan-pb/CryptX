/** Canvas Market renderer version 1. All input arithmetic stays bigint until a value is <= 255. */
export const RENDERER_VERSION = 'canvas-market-v1';
export const UINT64_MAX = (1n << 64n) - 1n;
const palettes = [
  ['#283e3b', '#d1a886', '#eee3cf', '#829485'],
  ['#233950', '#d7b594', '#ece0cd', '#788ca1'],
  ['#463748', '#cf9b87', '#eee0d6', '#93768e'],
  ['#3c4833', '#ceb986', '#f0e5d3', '#8a9b73'],
  ['#523c32', '#c98f72', '#efe0c9', '#9d8169'],
  ['#293b47', '#b7a891', '#eee2d1', '#71949a'],
  ['#473f58', '#d1a69d', '#eee0df', '#857d9f'],
  ['#34504a', '#c7b08a', '#ece7d7', '#7a9b8b'],
] as const;
const mask = UINT64_MAX;
function next(value: bigint): bigint {
  let x = value;
  x ^= (x << 13n) & mask;
  x ^= x >> 7n;
  x ^= (x << 17n) & mask;
  return x & mask;
}
function byte(value: bigint, shift: bigint): number { return Number((value >> shift) & 255n); }
function bounded(value: bigint, maximum: number): number { return Number(value % BigInt(maximum)); }
export type Traits = { palette: string; motion: string; rarity: string; motifCount: number };

export function traits(seed: bigint): Traits {
  if (seed < 0n || seed > UINT64_MAX) throw new RangeError('seed is not uint64');
  const rarityByte = byte(seed, 56n);
  const rarity = rarityByte < 128 ? 'Common' : rarityByte < 205 ? 'Rare' : rarityByte < 243 ? 'Exceptional' : 'Singular';
  const paletteIndex = byte(seed, 48n) % palettes.length;
  const paletteNames = ['Moss', 'Tide', 'Dusk', 'Grove', 'Clay', 'Mist', 'Violet', 'Lagoon'];
  const motions = ['Drift', 'Orbit', 'Rise', 'Fold'];
  const motion = motions[byte(seed, 40n) % motions.length];
  const motifCount = 8 + (byte(seed, 32n) % 9);
  return { rarity, palette: paletteNames[paletteIndex], motion, motifCount };
}

/** Exact canonical SVG bytes for a published token. No browser canvas nondeterminism. */
export function renderSvg(seed: bigint): string {
  const t = traits(seed);
  const paletteIndex = byte(seed, 48n) % palettes.length;
  const [ink, accent, paper, mid] = palettes[paletteIndex];
  let state = seed === 0n ? 0x9e3779b97f4a7c15n : seed;
  const shapes: string[] = [];
  for (let i = 0; i < t.motifCount; i++) {
    state = next(state);
    const x = 45 + bounded(state, 550);
    state = next(state);
    const y = 45 + bounded(state, 550);
    state = next(state);
    const width = 35 + bounded(state, 130);
    state = next(state);
    const height = 25 + bounded(state, 125);
    state = next(state);
    const tilt = bounded(state, 110) - 55;
    const fill = i % 3 === 0 ? accent : i % 3 === 1 ? mid : ink;
    const opacity = (0.24 + (i % 5) * 0.13).toFixed(2);
    if (t.motion === 'Orbit') shapes.push(`<ellipse cx="${x}" cy="${y}" rx="${width}" ry="${height}" fill="none" stroke="${fill}" stroke-width="${4 + i % 9}" opacity="${opacity}" transform="rotate(${tilt} ${x} ${y})"/>`);
    else if (t.motion === 'Rise') shapes.push(`<path d="M ${x} ${y + height} Q ${x + width / 2} ${y - height} ${x + width} ${y}" fill="none" stroke="${fill}" stroke-width="${5 + i % 9}" stroke-linecap="round" opacity="${opacity}"/>`);
    else if (t.motion === 'Fold') shapes.push(`<path d="M ${x} ${y} L ${x + width} ${y + height / 2} L ${x} ${y + height} Z" fill="${fill}" opacity="${opacity}" transform="rotate(${tilt} ${x} ${y})"/>`);
    else shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${6 + i % 18}" fill="${fill}" opacity="${opacity}" transform="rotate(${tilt} ${x} ${y})"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-label="Canvas Market ${t.rarity} ${t.palette} ${t.motion}"><rect width="640" height="640" fill="${paper}"/><rect x="24" y="24" width="592" height="592" fill="none" stroke="${ink}" stroke-width="2" opacity=".3"/>${shapes.join('')}<path d="M 45 562 H 595" stroke="${ink}" stroke-width="2" opacity=".4"/><text x="47" y="590" fill="${ink}" font-size="13" font-family="serif" letter-spacing="3">HIDDEN CANVAS / ${RENDERER_VERSION}</text></svg>`;
}

export function imageUrl(seed: bigint): string { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSvg(seed))}`; }
