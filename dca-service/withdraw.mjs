/**
 * Withdraw all tokens from Panorama Wallet back to MetaMask EOA
 * Run: node withdraw.mjs
 */
import CryptoJS from 'crypto-js';
import { createThirdwebClient, prepareTransaction, prepareContractCall, sendAndConfirmTransaction, getContract } from 'thirdweb';
import { defineChain } from 'thirdweb/chains';
import { privateKeyToAccount } from 'thirdweb/wallets';
import { smartWallet } from 'thirdweb/wallets';
import { transfer, balanceOf } from 'thirdweb/extensions/erc20';

const ENCRYPTION_KEY = 'default-key-change-in-production';
const ENCRYPTED_KEY = 'U2FsdGVkX1/wsrlsnrx6ngns7U51p2rVUjMcQxY/ZbS/1bWMET8ATnkCls8CiFujFjyFw3rxhC5ZNBP+LdxtXcjg6aVqdO2HjFapwmKaTIye4pdRsn082FEvSRPY+t4i';

const SMART_ACCOUNT  = '0x17bc2ABfF68Fb0D5570392C4920A805888Bd6C44';
const RECIPIENT      = '0xd6F31c5e32EE78A257A32cB6469BaB3F9fbd7561'; // MetaMask EOA

// ERC20 tokens to withdraw
const TOKENS = {
  base: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  avalanche: [
    { symbol: 'sAVAX', address: '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE', decimals: 18 },
  ],
};

// Decrypt session key
const bytes = CryptoJS.AES.decrypt(ENCRYPTED_KEY, ENCRYPTION_KEY);
const sessionKey = bytes.toString(CryptoJS.enc.Utf8);
if (!sessionKey) throw new Error('Failed to decrypt session key');

const client = createThirdwebClient({ secretKey: process.env.THIRDWEB_SECRET_KEY });

async function getSmartAccount(chainId) {
  const chain = defineChain(chainId);
  const personalAccount = privateKeyToAccount({ client, privateKey: sessionKey });
  const wallet = smartWallet({ chain, gasless: false });
  return wallet.connect({ client, personalAccount });
}

async function withdrawERC20(smartAccount, chain, token) {
  const contract = getContract({ client, chain, address: token.address });
  const bal = await balanceOf({ contract, address: smartAccount.address });
  if (bal === 0n) {
    console.log(`  [skip] ${token.symbol}: saldo zero`);
    return;
  }
  console.log(`  [tx] Transferindo ${Number(bal) / 10 ** token.decimals} ${token.symbol} → ${RECIPIENT}`);
  const tx = transfer({ contract, to: RECIPIENT, amountWei: bal });
  const receipt = await sendAndConfirmTransaction({ transaction: tx, account: smartAccount });
  console.log(`  [ok] ${token.symbol} TX: ${receipt.transactionHash}`);
}

async function withdrawNative(smartAccount, chain, leaveForGas = 0n) {
  const rpc = chain.id === 8453
    ? 'https://mainnet.base.org'
    : 'https://api.avax.network/ext/bc/C/rpc';

  const resp = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [smartAccount.address, 'latest'], id: 1 }),
  });
  const { result } = await resp.json();
  const bal = BigInt(result);

  // Estimate gas for a native transfer (~21000 gas, generous gwei)
  const gasReserve = leaveForGas || 500000000000000n; // 0.0005 ETH/AVAX fallback reserve
  const toSend = bal > gasReserve ? bal - gasReserve : 0n;

  if (toSend === 0n) {
    console.log(`  [skip] native: saldo insuficiente apos reserva de gas (${Number(bal) / 1e18} disponivel)`);
    return;
  }
  console.log(`  [tx] Transferindo ${Number(toSend) / 1e18} native → ${RECIPIENT}`);
  const tx = prepareTransaction({ client, chain, to: RECIPIENT, value: toSend });
  const receipt = await sendAndConfirmTransaction({ transaction: tx, account: smartAccount });
  console.log(`  [ok] native TX: ${receipt.transactionHash}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('=== Panorama Wallet Withdrawal ===');
console.log(`From: ${SMART_ACCOUNT}`);
console.log(`To:   ${RECIPIENT}`);
console.log('');

// 1. Base chain (chainId 8453) — apenas ETH restante
console.log('[Base chain]');
try {
  const baseChain = defineChain(8453);
  const baseAccount = await getSmartAccount(8453);
  // ERC20s já foram transferidos — pula direto para o ETH nativo
  // Reserva mínima de 0.00008 ETH para gas do bundle
  await withdrawNative(baseAccount, baseChain, 80000000000000n);
} catch (e) {
  console.error('[Base] Erro:', e.message);
}

console.log('');

// 2. Avalanche — AVAX restante (0.00072, tenta mandar)
console.log('[Avalanche chain]');
try {
  const avaxChain = defineChain(43114);
  const avaxAccount = await getSmartAccount(43114);
  // Reserva mínima 0.0005 AVAX para gas
  await withdrawNative(avaxAccount, avaxChain, 500000000000000n);
} catch (e) {
  console.error('[Avalanche] Erro:', e.message);
}

console.log('');
console.log('=== Concluido ===');
