# Run CryptX on a new Mac or another computer

CryptX is a local React/Vite website for an **existing Ethereum Sepolia deployment**. The four NFT-marketplace contracts, NFTs, owners, listings, licences and proceeds live on Sepolia, not in this folder or on the local web server. Moving the project does **not** require deploying again or minting again. The included `deployments/sepolia-marketplace.json` holds public contract addresses and lets a fresh browser find the existing deployment.

## 1. Transfer the project

Copy the complete `BlockChain` folder to the new computer, including `contracts/`, `scripts/`, `frontend/`, `deployments/`, both `package.json` files and both `package-lock.json` files. A Finder copy, AirDrop or a ZIP is fine. `node_modules/`, `frontend/node_modules/`, `artifacts/`, `types/`, `frontend/dist/` and `frontend/public/vendor/` are generated and may be left out to reduce the transfer size; the setup below recreates them. Do **not** send `.env`, private keys, MetaMask recovery phrases or wallet export files with the folder. There is no need to transfer a browser's local storage.

The public deployment manifest is essential: without `deployments/sepolia-marketplace.json`, the marketplace starts with a deployment/import screen instead of loading the existing project automatically.

## 2. Install the runtime

Install Node.js **22.23.3** and npm (the project pins Node in `.nvmrc`; its lockfiles were made with npm 10). On a fresh Mac, install [nvm using its official instructions](https://github.com/nvm-sh/nvm#installing-and-updating) if it is missing:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

Close Terminal, open it again, and confirm `command -v nvm` prints `nvm`. If it does not, follow the official macOS troubleshooting section linked above to load nvm in your shell. On macOS or Linux with nvm available, open Terminal in the transferred folder and run:

```sh
cd /path/to/BlockChain
nvm install 22.23.3
nvm use 22.23.3
node --version
npm --version
```

On Windows, install Node 22.23.3 through a Windows-compatible Node manager or installer, open PowerShell in the project folder, and run the `npm` commands below. `nvm` for Unix is a macOS/Linux tool, so do not run the Unix `nvm` instructions unchanged in PowerShell.

## 3. Install, compile and start

From the **project root**, run these commands in order. An internet connection is needed to download the pinned npm packages on a fresh machine.

```sh
npm ci
npm --prefix frontend ci
npm run compile
npm --prefix frontend run dev
```

Leave this Terminal window open while using the website. The frontend's `dev` command first copies compiled marketplace ABIs, the public deployment manifest and the Zama browser assets into the frontend, then starts Vite. The server is pinned to **`127.0.0.1:5173`** and fails clearly if port 5173 is occupied. This exact port matters because the already-deployed Sketches metadata and sealed Hidden Canvas image contain `127.0.0.1:5173` URLs.

Open **`http://127.0.0.1:5173/`** on that same computer to view CryptX. You can browse public art and listings without a wallet. For signed actions, install MetaMask in the browser, select **Ethereum Sepolia (chain ID 11155111)**, and connect it from the site. Use a throwaway Sepolia wallet with faucet-funded test ETH for gas and payments. To act as an existing owner on a new computer, use MetaMask's own secure account migration or recovery process; the project never needs you to paste a private key into a file, terminal or chat. A different wallet may browse and buy but does not become the original owner's account.

If the page opens but shows no collections, confirm that `deployments/sepolia-marketplace.json` was copied, then restart `npm --prefix frontend run dev` so its sync step copies that manifest. If `npm run compile` fails, check the Node version and whether `npm ci` completed. If the browser cannot reach Sepolia, check the internet connection and MetaMask network first.

To check the local port on macOS/Linux while the server is running:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN
curl -I http://127.0.0.1:5173/
```

The first command shows a listening process; the second should return an HTTP success status. `127.0.0.1` means *this computer*, and the server exists only while the Terminal process runs. Stop your own Vite process with **Ctrl+C**. If port 5173 is already occupied, stop the other process you own before starting CryptX; Vite will not silently switch to 5174.

Optional verification from the project root:

```sh
npm test
npm run typecheck
npm --prefix frontend run build
```

For browser tests, first install Playwright's Chromium with `cd frontend && npx playwright install chromium`, then run `npm test` inside `frontend/`. These checks are useful after edits; they are not required just to view the existing Sepolia site.

## Why no Sepolia API key or `.env` is needed

An **RPC URL** is an address that accepts blockchain requests; it is not necessarily a secret or a paid API key. CryptX's public read-only marketplace requests use `https://ethereum-sepolia-rpc.publicnode.com`, configured in `frontend/src/market/chain.ts`. Its Hardhat configuration uses the same public RPC as a fallback. MetaMask provides the wallet connection and keeps its signing key inside the extension; CryptX sends unsigned transaction requests to MetaMask, and the wallet asks you to approve them. The Zama browser SDK uses its packaged Sepolia configuration for encrypted-artwork requests. Thus you did use a Sepolia RPC, but you did **not** have to sign up for a separate paid provider or hand the project an exported wallet key. A public RPC can still be slow, rate-limited or temporarily unavailable.

There is no required `.env` file. These process environment variables are supported only for optional future Hardhat CLI use:

| Variable | Current use |
| --- | --- |
| `SEPOLIA_RPC_URL` | Optional `hardhat.config.ts` process environment override for CLI operations. The public RPC fallback works without it. A root `.env` file is not automatically loaded by this repo. |
| `DEPLOYER_PRIVATE_KEY` | Optional Hardhat CLI account. The existing deployment and website used MetaMask, so it is unnecessary here. Never paste a real key into the frontend or share it. |

The creator address came from the deploying MetaMask wallet. The deployed contract itself enforces the 96-block delay; neither value needs an environment setting.

`VITE_*` frontend environment values are included in public browser code. Do not put any wallet secret or private API credential there. Sepolia ETH pays **testnet transaction gas**; an RPC URL only connects software to the chain and does not replace gas.

## Limits when sharing with someone else

Each person can run the copied source locally on their own computer at `127.0.0.1:5173` and read the same Sepolia contracts. However, `127.0.0.1` on a phone or another person's computer points to *that device*, not to your Mac. The website is **not publicly hosted** merely because the contracts are public. The deployed Sketches contract fixes a local metadata base URL, generated Sketches metadata fixes local image URLs, and Hidden Canvas fixes a local sealed-image URL. Publicly revealed Hidden Canvas metadata is generated on-chain. A third-party marketplace cannot reliably fetch the local URLs, and simply uploading the current frontend would not repair URLs stored in already-deployed contracts. Production hosting and third-party metadata compatibility would require permanent public artwork URLs and a new deployment or compatible migration plan.

The current project is an educational Sepolia demo, not an audited production marketplace. See [the full walkthrough](PROJECT_WALKTHROUGH.md) for contract behavior and [the verified deployment](../deployments/sepolia-marketplace.json) for public addresses.
