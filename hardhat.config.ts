import '@fhevm/hardhat-plugin';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import '@typechain/hardhat';
import type { HardhatUserConfig } from 'hardhat/config';

const compilerSettings = {
  optimizer: { enabled: true, runs: 800 },
  evmVersion: 'cancun' as const,
  metadata: { bytecodeHash: 'none' as const },
};

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    compilers: [{ version: '0.8.27', settings: compilerSettings }],
    overrides: {
      'contracts/CanvasArt.sol': { version: '0.8.27', settings: { ...compilerSettings, viaIR: true } },
      'contracts/HiddenCanvasNFT.sol': { version: '0.8.27', settings: { ...compilerSettings, viaIR: true } },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  typechain: { outDir: 'types', target: 'ethers-v6' },
};
export default config;
