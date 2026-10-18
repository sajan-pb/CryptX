import { expect } from 'chai';
import { ethers } from 'hardhat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Hardhat tests run as CommonJS while the Vite package is ESM. Compile the actual
// frontend renderer source in memory so the parity test never copies its logic.
const source = readFileSync(join(__dirname, '../frontend/src/lib/art.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const frontend = {} as { renderSvg: (seed: bigint) => string };
new Function('exports', js)(frontend);

describe('CanvasArt canonical rendering', function () {
  it('matches exact frontend SVG bytes across zero, boundary and all motion types', async function () {
    const art = await (await ethers.getContractFactory('CanvasArtHarness')).deploy();
    await art.waitForDeployment();
    const seeds = [
      0n, 1n, (1n << 64n) - 1n,
      0x0100000000000000n, 0x8000010000000000n,
      0xcd00020000000000n, 0xf300030000000000n,
      0x7fffffffffffn,
    ];
    for (const seed of seeds) {
      expect(await art.renderSvg(seed), `seed ${seed}`).to.equal(frontend.renderSvg(seed));
    }
  });
});
