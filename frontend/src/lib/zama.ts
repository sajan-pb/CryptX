import type * as Relayer from '@zama-fhe/relayer-sdk/web';
import type { Eip1193Provider, Signer } from 'ethers';

let sdkLoad: Promise<typeof Relayer> | undefined;
export async function initializeBrowserSdk() {
  sdkLoad ??= (async () => {
    const sdk = await import('@zama-fhe/relayer-sdk/web');
    if (!await sdk.initSDK({ thread: 0, tfheParams: '/vendor/zama/tfhe_bg.wasm', kmsParams: '/vendor/zama/kms_lib_bg.wasm' })) {
      throw new Error('WASM initialization failed');
    }
    return sdk;
  })();
  return sdkLoad;
}

export async function freshInstance(ethereum: Eip1193Provider) {
  const sdk = await initializeBrowserSdk();
  // A fresh instance per request: no application plaintext or permit cache.
  return sdk.createInstance({ ...sdk.SepoliaConfig, network: ethereum });
}

export async function freshPreview(ethereum: Eip1193Provider, signer: Signer, address: string, controller: string, handle: string, onStage?: (stage: string) => void) {
  const instance = await freshInstance(ethereum);
  onStage?.('SDK ready; waiting for wallet signature');
  const keys = instance.generateKeypair();
  const start = Math.floor(Date.now() / 1000) - 30;
  const typed = instance.createDelegatedUserDecryptEIP712(keys.publicKey, [address], controller, start, 1);
  const signature = await signer.signTypedData(typed.domain, {
    DelegatedUserDecryptRequestVerification: [...typed.types.DelegatedUserDecryptRequestVerification],
  }, typed.message);
  onStage?.('Wallet signed; checking access and contacting the relayer');
  const result = await instance.delegatedUserDecrypt(
    [{ handle, contractAddress: address }], keys.privateKey, keys.publicKey,
    signature, [address], controller, await signer.getAddress(), start, 1, { timeout: 120000 },
  );
  const value = result[handle as `0x${string}`];
  if (typeof value !== 'bigint') throw new Error('Unexpected decrypted type');
  return value;
}

// Deliberately expose only a classification, never error payloads/permit data/plaintext.
export function classify(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let i = 0; i < 6 && current && typeof current === 'object'; i++) {
    const e = current as { name?: string; message?: string; code?: string | number; status?: number; bodyJson?: string; cause?: unknown };
    // The live relayer returns this explicit ACL label in an HTTP 400 body,
    // which the pinned SDK mislabels as an invalid response schema.
    if (e.name === 'RelayerV2ResponseInvalidBodyError' && e.status === 400 && typeof e.bodyJson === 'string') {
      try {
        const body = JSON.parse(e.bodyJson) as { error?: { label?: unknown } };
        if (body.error?.label === 'not_allowed_on_host_acl') return 'Explicit access rejection';
      } catch { /* An unknown response remains inconclusive. */ }
    }
    parts.push(String(e.message ?? ''), String(e.code ?? ''));
    current = e.cause;
  }
  const text = parts.join(' ').toLowerCase();
  if (/4001|action_rejected|user rejected|user denied/.test(text)) return 'Wallet request rejected. Nothing further was submitted.';
  if (/insufficient funds/.test(text)) return 'Insufficient Sepolia test ETH for this transaction.';
  if (/not authorized|not allowed|not delegated|permission denied/.test(text)) return 'Explicit access rejection';
  if (/timeout|timed out|abort/.test(text)) return 'Timeout — inconclusive; this does not prove access was denied.';
  if (/revert/.test(text)) return 'Transaction reverted. Refresh state and check ownership, maturity and publication status.';
  return 'Request failed — inconclusive. Check the network and retry after propagation.';
}
