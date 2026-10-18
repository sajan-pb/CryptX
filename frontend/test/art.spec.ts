import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { renderSvg, traits, UINT64_MAX } from '../src/lib/art';

test('uint64 artwork stays deterministic at full width and rarity boundaries', async () => {
  const highest = renderSvg(UINT64_MAX);
  expect(highest).toEqual(renderSvg(UINT64_MAX));
  expect(highest).not.toEqual(renderSvg(UINT64_MAX - 1n));
  expect(() => renderSvg(UINT64_MAX + 1n)).toThrow(RangeError);
  expect(traits(127n << 56n).rarity).toBe('Common');
  expect(traits(128n << 56n).rarity).toBe('Rare');
  expect(traits(205n << 56n).rarity).toBe('Exceptional');
  expect(traits(243n << 56n).rarity).toBe('Singular');
});

test('ten original sketch catalog hashes the exact local asset bytes', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/art/sketches/catalog.json', import.meta.url), 'utf8'));
  expect(catalog).toHaveLength(10);
  for (const [index, item] of catalog.entries()) {
    expect(item.tokenId).toBe(index + 1);
    const bytes = await readFile(new URL(`../public${item.file}`, import.meta.url));
    expect(`0x${createHash('sha256').update(bytes).digest('hex')}`).toBe(item.sha256);
    expect(bytes.toString('utf8')).toContain('<svg');
  }
});

test('all ten Sketches metadata links and the sealed placeholder resolve locally', async ({ request }) => {
  const catalog = JSON.parse(await readFile(new URL('../public/art/sketches/catalog.json', import.meta.url), 'utf8'));
  for (const item of catalog) {
    const metadataResponse = await request.get(`/metadata/sketches/${item.tokenId}.json`);
    expect(metadataResponse.ok()).toBe(true);
    const metadata = await metadataResponse.json();
    expect(metadata.content_sha256).toBe(item.sha256);
    expect(metadata.name).toBe(item.name);
    const artResponse = await request.get(metadata.image);
    expect(artResponse.ok()).toBe(true);
    expect(`0x${createHash('sha256').update(await artResponse.body()).digest('hex')}`).toBe(item.sha256);
  }
  const sealed = await request.get('/art/sealed.svg');
  expect(sealed.ok()).toBe(true);
  expect(await sealed.text()).toContain('HIDDEN CANVAS · SEALED');
});
