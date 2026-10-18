import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
await cp(
  fileURLToPath(new URL('frontend/node_modules/@zama-fhe/relayer-sdk/bundle/', root)),
  fileURLToPath(new URL('frontend/public/vendor/zama/', root)),
  { recursive: true },
);
console.log('Synchronized local Zama browser assets.');
