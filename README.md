# CryptX

CryptX is a dark-mode NFT marketplace built for Ethereum Sepolia. It displays ten fixed **Sketches** NFTs and a mintable **Hidden Canvas** collection whose owners can privately preview encrypted artwork before choosing permanent public reveal. The app also supports fixed-price sales, creator proceeds and separate artwork-licence receipts.

The four marketplace contracts are already deployed on Sepolia. The public addresses and deployment receipts are in [`deployments/sepolia-marketplace.json`](deployments/sepolia-marketplace.json). Opening the site does **not** deploy contracts or mint tokens. Existing contract names and the `canvas-market` manifest identifier are part of that deployment and remain unchanged by the CryptX frontend name.

## Run locally

Use Node **22.23.3** and npm 10. In a new Terminal at the project root:

```sh
nvm install 22.23.3
nvm use 22.23.3
npm ci
npm --prefix frontend ci
npm run compile
npm --prefix frontend run dev
```

Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)**. Keep the Terminal running while using the site. Public artwork and listings load without a wallet. For minting, buying, selling, previewing or licensing, connect MetaMask on Sepolia and use faucet-funded test ETH. The project does not need an exported wallet key. Port **5173** is required because some URLs stored by the deployed NFTs point to that local port.

For copying the project to another computer, Windows notes, port troubleshooting and an explanation of the Sepolia RPC, read [setup on a new device](docs/SETUP_NEW_DEVICE.md). For the contracts and user flows, read the [project walkthrough](docs/PROJECT_WALKTHROUGH.md).

For the full file-by-file explanation, deployment history, run/stop commands and questions and answers, open the [complete project handbook (PDF)](CryptX_Complete_Project_Guide.pdf).

## Deployed contracts

| Contract | Address |
| --- | --- |
| Sketches | [`0xE98bEd0943A1fc22296E1bBfafca30660a3b6508`](https://sepolia.etherscan.io/address/0xE98bEd0943A1fc22296E1bBfafca30660a3b6508) |
| Hidden Canvas | [`0x8a2d41319C8bF12Cc86a10C2499d195a9dF47a84`](https://sepolia.etherscan.io/address/0x8a2d41319C8bF12Cc86a10C2499d195a9dF47a84) |
| Marketplace | [`0xc6209DBeF278159DAeb383414C34266D65ec1252`](https://sepolia.etherscan.io/address/0xc6209DBeF278159DAeb383414C34266D65ec1252) |
| Artwork licensing | [`0x8a465728f97EEc5062Ed57E46B5659Cfbd7d9E13`](https://sepolia.etherscan.io/address/0x8a465728f97EEc5062Ed57E46B5659Cfbd7d9E13) |

Sketches has exactly ten NFTs and no public mint. Hidden Canvas can mint up to twenty NFTs. A newly minted or transferred Hidden Canvas NFT must wait **96 Sepolia blocks** before its current owner can activate private preview. An owner can permanently authorize public reveal; a separate proof-completion transaction publishes verified on-chain SVG artwork and traits. The marketplace handles non-escrow fixed-price listings and seller withdrawals. The licensing registry issues non-transferable receipts tied to an artwork hash; a licence does not transfer NFT ownership.

The earlier `SeedFeasibility.sol` contract is retained as source for the initial privacy experiment and its tests. It is not an ERC-721 or part of the CryptX website.

## Build and check

```sh
npm test
npm run typecheck
npm --prefix frontend run build
```

Browser tests need Playwright Chromium once: run `cd frontend`, then `npx playwright install chromium` and `npm test`. The frontend build synchronizes compiled marketplace ABIs, the public manifest, original Sketches catalog and local Zama browser assets. Compile after changing Solidity.

## Network, privacy and limits

CryptX uses the public Sepolia RPC configured in `frontend/src/market/chain.ts` for blockchain reads. MetaMask holds the signing key and asks for approval before transactions or private-decryption signatures. No `.env` file is required to run this site. Never place a private key or secret provider token in frontend `VITE_*` variables, which are public in the browser.

The site runs locally, not on a public host. Sketches metadata and the sealed Hidden Canvas placeholder contain `127.0.0.1:5173` URLs fixed at deployment. They work on a computer running this project at that port, but are not reliable metadata URLs for third-party NFT sites. Publicly revealed Hidden Canvas SVG metadata is generated on-chain. The contracts are educational, unaudited and not production-ready.

The project is MIT-licensed under [LICENSE](LICENSE). Source adapted from [Zama's Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template) retains its [BSD 3-Clause Clear notice](ZAMA_TEMPLATE_LICENSE). Third-party dependencies retain their own licences.
