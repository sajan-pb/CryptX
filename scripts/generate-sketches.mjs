import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Original Canvas Market vector sketches. Distinct hand-authored path compositions, no third-party assets.
const pieces = [
  ['Quiet Terrace', 'A study of layered balconies and a single rising sun.', '#e0b990', '#344c48', '<path d="M72 360h498M102 344V200h80v144m36 0V145h112v199m32 0V229h130v115m30 0V167h55v177"/><path d="M80 403c84-50 142 24 229-22s140-46 241 7"/><circle cx="450" cy="105" r="44"/>'],
  ['Blue Vessel', 'A ceramic silhouette surrounded by drifting lines.', '#b7cbd0', '#344b5b', '<path d="M252 102h136m-115 0c12 90-37 90-67 167-38 99 27 201 114 201s152-102 114-201c-30-77-79-77-67-167"/><path d="M225 280c79 59 155-58 235 2M210 346c77 66 170-58 220 16"/><path d="M117 128c30 41 19 81-16 117m436-108c-34 36-30 78 12 108"/>'],
  ['Soft Current', 'Long river curves cross an open field.', '#d4c6ab', '#415d54', '<path d="M87 178c112-84 180 85 292 0s173-24 186 6M73 260c111-84 181 85 293 0s174-25 187 5M90 344c111-84 181 85 293 0s174-24 187 5M70 432c111-84 181 85 293 0s174-25 187 5"/><circle cx="145" cy="104" r="25"/>'],
  ['Night Orchard', 'Branches and small fruit under a square moon.', '#d9c8c1', '#5c4853', '<path d="M314 512V197m0 183c-89-21-130-93-136-181m136 135c100-28 153-96 160-192M314 262c-68-33-72-81-67-145m67 135c73-38 89-86 93-147"/><circle cx="178" cy="190" r="20"/><circle cx="468" cy="172" r="21"/><circle cx="241" cy="132" r="14"/><circle cx="408" cy="116" r="16"/><rect x="84" y="63" width="58" height="58"/>'],
  ['Window Rain', 'A city window with vertical rain and reflected light.', '#aebbc0', '#3d5060', '<rect x="154" y="95" width="328" height="419"/><path d="M318 95v419M154 282h328M74 155v100m28-130v140m430-116v117m27-81v97M184 488l150-126m6 126 117-107"/><path d="M96 547h452"/>'],
  ['Amber Steps', 'Staggered stairs climb toward an amber disc.', '#e6c8a5', '#6a5141', '<path d="M85 488h108v-92h91v-89h94v-88h97v-92h87"/><path d="M91 452h102m0-92h91m0-89h94m0-88h97"/><circle cx="508" cy="81" r="36"/><path d="M98 527h475"/>'],
  ['Desert Lantern', 'An angular lantern rests between dunes.', '#dfc5a4', '#564b48', '<path d="M105 474c79-128 151-111 212-35s142-42 220 28M291 377l-29-152 56-95 57 95-29 152zM262 225h113M291 377h55"/><circle cx="318" cy="209" r="18"/><path d="M317 129V79m-42 50 42-44 42 44"/>'],
  ['Paper Kites', 'Two small kites balance in a wide sky.', '#cbd0bd', '#4c6155', '<path d="m184 129 86 98-82 95-82-96zm279 80 71 79-69 79-69-80z"/><path d="M188 322c-38 64 44 72 4 127m273-82c-32 34 31 69-9 111M121 229h150m125 59h139"/><circle cx="82" cy="102" r="27"/>'],
  ['Three Arches', 'Repeated doorway curves frame an empty center.', '#d6ccc0', '#4f4e5c', '<path d="M86 493V211a85 85 0 0 1 170 0v282m48 0V154a85 85 0 0 1 170 0v339m45 0V235a54 54 0 0 1 108 0v258"/><path d="M68 493h550M279 98v390"/><circle cx="388" cy="343" r="33"/>'],
  ['Coastal Lines', 'A quiet horizon, a sail and a repeating tide.', '#c4d0cc', '#425965', '<path d="M78 280h502M312 277V115l-111 161zm19-137 102 136H331zM80 360c55-29 109 29 164 0s109-29 164 0 109 29 164 0M80 422c55-29 109 29 164 0s109-29 164 0 109 29 164 0"/><circle cx="501" cy="130" r="38"/>'],
];
const output = new URL('../frontend/public/art/sketches/', import.meta.url);
const metadataOutput = new URL('../frontend/public/metadata/sketches/', import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(metadataOutput, { recursive: true });
const catalog = [];
for (let i = 0; i < pieces.length; i++) {
  const [name, description, paper, ink, drawing] = pieces[i];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-label="${name}"><rect width="640" height="640" fill="${paper}"/><g fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${drawing}</g><rect x="32" y="32" width="576" height="576" fill="none" stroke="${ink}" opacity=".35" stroke-width="2"/><text x="45" y="583" fill="${ink}" font-family="serif" font-size="14" letter-spacing="3">SKETCHES / ${String(i+1).padStart(2,'0')}</text></svg>`;
  const filename = `${String(i + 1).padStart(2, '0')}.svg`;
  const assetHash = `0x${createHash('sha256').update(Buffer.from(svg)).digest('hex')}`;
  await writeFile(new URL(filename, output), svg);
  const attributes = [{ trait_type: 'Medium', value: 'Original vector sketch' }, { trait_type: 'Series', value: 'Sketches 2026' }];
  catalog.push({ tokenId: i + 1, name, description, file: `/art/sketches/${filename}`, sha256: assetHash, attributes });
  await writeFile(new URL(`${i + 1}.json`, metadataOutput), JSON.stringify({ name, description, image: `http://127.0.0.1:5173/art/sketches/${filename}`, attributes, content_sha256: assetHash }, null, 2) + '\n');
}
await writeFile(new URL('catalog.json', output), JSON.stringify(catalog, null, 2) + '\n');
console.log('Generated 10 original sketches and exact-byte SHA-256 catalog.');
