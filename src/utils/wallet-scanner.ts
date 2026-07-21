/**
 * Multi-chain wallet scanner.
 * Given a BIP39/HSMC mnemonic, derives:
 *  - native HSMC address (project's SHA-256 derivation, see bip39-wallet.ts)
 *  - standard BIP44 EVM address (m/44'/60'/0'/0/0)
 * and queries REAL balances from:
 *  - HSMC: public.wallets table (local DB) — native chain
 *  - ETH mainnet, BSC, Polygon: public JSON-RPC endpoints (eth_getBalance)
 *
 * NO mocks. NO fake data. If a network is unreachable, it returns an error
 * string and the UI shows that explicitly.
 */
import { HDNodeWallet, Mnemonic, formatEther } from 'ethers';
import { supabase } from '@/integrations/db/client';
import { deriveAddress, mnemonicToSeed } from '@/utils/bip39-wallet';

export interface ChainBalance {
  chain: string;
  symbol: string;
  address: string;
  balance: string;          // human-readable
  raw: string;              // raw wei/native
  hasBalance: boolean;
  error?: string;
  explorerUrl?: string;
}

export interface ScanResult {
  hsmcAddress: string;
  evmAddress: string;
  chains: ChainBalance[];
  totalNetworksWithFunds: number;
}

const RPCS: { chain: string; symbol: string; url: string; explorer: (a: string) => string }[] = [
  { chain: 'Ethereum',  symbol: 'ETH',   url: 'https://eth.llamarpc.com',          explorer: a => `https://etherscan.io/address/${a}` },
  { chain: 'BNB Chain', symbol: 'BNB',   url: 'https://bsc-dataseed.binance.org',  explorer: a => `https://bscscan.com/address/${a}` },
  { chain: 'Polygon',   symbol: 'MATIC', url: 'https://polygon-rpc.com',           explorer: a => `https://polygonscan.com/address/${a}` },
  { chain: 'Arbitrum',  symbol: 'ETH',   url: 'https://arb1.arbitrum.io/rpc',      explorer: a => `https://arbiscan.io/address/${a}` },
  { chain: 'Optimism',  symbol: 'ETH',   url: 'https://mainnet.optimism.io',       explorer: a => `https://optimistic.etherscan.io/address/${a}` },
  { chain: 'Base',      symbol: 'ETH',   url: 'https://mainnet.base.org',          explorer: a => `https://basescan.org/address/${a}` },
];

/** Standard BIP44 EVM derivation (m/44'/60'/0'/0/0). Works for 12/15/18/21/24-word phrases. */
export function deriveEvmAddress(mnemonic: string): string {
  // For 25-word HSMC variant, use the first 24 words (the 25th is our checksum)
  const words = mnemonic.trim().split(/\s+/);
  const base = words.length === 25 ? words.slice(0, 24).join(' ') : mnemonic.trim();
  const mn = Mnemonic.fromPhrase(base);
  const node = HDNodeWallet.fromMnemonic(mn, "m/44'/60'/0'/0/0");
  return node.address;
}

async function rpcGetBalance(url: string, address: string, timeoutMs = 6000): Promise<bigint> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC error');
    return BigInt(json.result);
  } finally {
    clearTimeout(t);
  }
}

export async function scanWallet(mnemonic: string): Promise<ScanResult> {
  const hsmcAddress = await deriveAddress(mnemonic);
  let evmAddress = '';
  try {
    evmAddress = deriveEvmAddress(mnemonic);
  } catch (e) {
    console.warn('[Scanner] EVM derivation failed:', e);
  }

  const chains: ChainBalance[] = [];

  // 1. HSMC native — query DB
  try {
    const { data, error } = await supabase
      .from('wallets')
      .select('balance, staked_balance')
      .eq('address', hsmcAddress)
      .maybeSingle();
    if (error) throw error;
    const bal = Number(data?.balance ?? 0);
    const staked = Number(data?.staked_balance ?? 0);
    const total = bal + staked;
    chains.push({
      chain: 'HSMC Network',
      symbol: 'HSMC',
      address: hsmcAddress,
      balance: total.toLocaleString('en-US', { maximumFractionDigits: 8 }) + (staked > 0 ? ` (${staked.toFixed(2)} staked)` : ''),
      raw: String(total),
      hasBalance: total > 0,
    });
  } catch (e) {
    chains.push({
      chain: 'HSMC Network', symbol: 'HSMC', address: hsmcAddress,
      balance: '—', raw: '0', hasBalance: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. EVM chains — query public RPCs in parallel
  if (evmAddress) {
    const evmResults = await Promise.all(RPCS.map(async (rpc) => {
      try {
        const wei = await rpcGetBalance(rpc.url, evmAddress);
        const eth = formatEther(wei);
        return {
          chain: rpc.chain, symbol: rpc.symbol, address: evmAddress,
          balance: parseFloat(eth).toLocaleString('en-US', { maximumFractionDigits: 6 }),
          raw: wei.toString(),
          hasBalance: wei > 0n,
          explorerUrl: rpc.explorer(evmAddress),
        } as ChainBalance;
      } catch (e) {
        return {
          chain: rpc.chain, symbol: rpc.symbol, address: evmAddress,
          balance: '—', raw: '0', hasBalance: false,
          error: e instanceof Error ? e.message : 'Network unreachable',
          explorerUrl: rpc.explorer(evmAddress),
        } as ChainBalance;
      }
    }));
    chains.push(...evmResults);
  }

  return {
    hsmcAddress,
    evmAddress,
    chains,
    totalNetworksWithFunds: chains.filter(c => c.hasBalance).length,
  };
}
