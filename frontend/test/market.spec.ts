import { expect, test } from '@playwright/test';

// Exercise the first-run path even after a verified Sepolia manifest is bundled.
test.beforeEach(async ({ page }) => {
  await page.route('**/src/abi/sepolia-marketplace.json*', route => route.fulfill({
    contentType: 'text/javascript', body: 'export default null;',
  }));
});

test('marketplace opens in an honest undeployed state', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('CryptX · Art on Sepolia');
  await expect(page.getByRole('heading', { name: /Collect art/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy project with MetaMask' })).toBeDisabled();
  await expect(page.getByText('Deployment requires six confirmed Sepolia transactions.')).toBeVisible();
  await expect(page.getByText('10 items · Sketches minting closed')).toHaveCount(0);
});

test('rejects a manifest from another chain without showing fabricated NFT state', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'wrong-chain.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'canvas-market', chainId: 1, activationDelayBlocks: 96 })),
  });
  await expect(page.getByRole('heading', { name: /Collect art/ })).toBeVisible();
  await expect(page.getByText('10 items · Sketches minting closed')).toHaveCount(0);
});

test('marketplace setup fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('wrong-chain wallet can switch to Sepolia before project deployment', async ({ page }) => {
  await page.addInitScript(() => {
    let chain = '0x1';
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x1000000000000000000000000000000000000001'];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = '0xaa36a7'; return null; }
        throw new Error('Unexpected test wallet request');
      }, on() {}, removeListener() {},
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  await expect(page.getByRole('button', { name: 'Switch to Sepolia' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await expect(page.getByRole('status')).toContainText('Connected to Sepolia.');
  await expect(page.getByRole('button', { name: 'Deploy project with MetaMask' })).toBeEnabled();
});
