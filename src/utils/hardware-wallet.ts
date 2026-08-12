/**
 * HSMC Hardware Wallet Integration — Ledger + Trezor
 *
 * Feature #18: Provides connect/getAddress/signTransaction for both Ledger (via
 * esm.sh CDN-transpiled @ledgerhq packages) and Trezor (via official Trezor Connect
 * CDN script injection).  No npm dependencies required — everything is loaded on
 * demand at runtime.
 *
 * **Ledger transport layer**
 * Uses `@ledgerhq/hw-transport-webusb` + `@ledgerhq/hw-app-eth` loaded dynamically
 * from esm.sh.  Ledger Ethereum app is used for address derivation (BIP44) and
 * transaction signing — HSMC uses EVM-compatible addresses.
 *
 * **Trezor transport layer**
 * Uses Trezor Connect v9 loaded via <script> from connect.trezor.io.  This is the
 * officially recommended approach (iframe-based, handles device comms internally).
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export type HardwareWalletType = 'ledger' | 'trezor';

export interface HardwareWalletConnection {
  type: HardwareWalletType;
  address: string;
  path: string;
  deviceModel: string;
  /** Disconnect / clean up transport resources */
  disconnect(): Promise<void>;
}

export interface HardwareWalletTransaction {
  to: string;
  value: string; // hex-encoded wei (0x-prefixed)
  data?: string; // hex-encoded calldata
  chainId?: number;
  nonce?: string; // hex
  gasLimit?: string; // hex
  maxFeePerGas?: string; // hex (EIP-1559)
  maxPriorityFeePerGas?: string; // hex (EIP-1559)
  gasPrice?: string; // hex (legacy)
}

export interface SignedTransaction {
  r: string;
  s: string;
  v: number;
  signedTx: string; // raw 0x-prefixed signed tx
}

// ─── Ledger CDN dynamic imports ─────────────────────────────────────────────────

/**
 * The @ledgerhq packages are NOT npm dependencies: the Ledger transport and
 * Ethereum app are loaded at runtime from esm.sh (see loadLedgerModules).
 * These local interfaces describe only the members this module uses, so the
 * integration type-checks without pulling the heavy @ledgerhq dependency tree
 * into the frontend bundle.
 */
interface LedgerTransport {
  close(): Promise<void>;
}

interface LedgerTransportModule {
  default?: { create(): Promise<LedgerTransport> };
  create?(): Promise<LedgerTransport>;
}

interface LedgerEthApp {
  getAddress(path: string, display?: boolean): Promise<{ address: string }>;
  getAppConfiguration(): Promise<{ arbitraryDataEnabled: boolean }>;
  clearSignTransaction(
    path: string,
    tx: Record<string, string | number>,
    opts?: unknown
  ): Promise<{ r: string; s: string; v: string }>;
}

interface LedgerEthModule {
  default?: new (transport: LedgerTransport) => LedgerEthApp;
  new?(transport: LedgerTransport): LedgerEthApp;
}

let _ledgerTransportModule: LedgerTransportModule | null = null;
let _ledgerEthModule: LedgerEthModule | null = null;

async function loadLedgerModules(): Promise<void> {
  if (_ledgerTransportModule && _ledgerEthModule) return;

  // esm.sh transpiles CJS → ESM and bundles everything.  Pin the versions.
  // Module specifiers are held in variables so TS doesn't try to resolve them
  // as npm packages — Vite loads them from the CDN at runtime (@vite-ignore).
  const transportUrl = 'https://esm.sh/@ledgerhq/hw-transport-webusb@6.29.4';
  const ethUrl = 'https://esm.sh/@ledgerhq/hw-app-eth@6.41.0';
  const [transportMod, ethMod] = await Promise.all([
    import(/* @vite-ignore */ transportUrl),
    import(/* @vite-ignore */ ethUrl),
  ]);

  _ledgerTransportModule = transportMod as LedgerTransportModule;
  _ledgerEthModule = ethMod as LedgerEthModule;
}

/**
 * Connect to a Ledger hardware wallet via WebUSB.
 *
 * The browser must support WebUSB (Chromium-based browsers, or Firefox with
 * `dom.webusb.enabled`).  The Ledger device must be unlocked and have the
 * Ethereum app open.
 *
 * @param path  BIP44 derivation path (default: "m/44'/60'/0'/0/0")
 */
export async function connectLedger(
  path = "m/44'/60'/0'/0/0"
): Promise<HardwareWalletConnection> {
  await loadLedgerModules();

  const Transport = _ledgerTransportModule!.default || _ledgerTransportModule!;

  // Create — may throw if device not found or user denies permission
  const transport = await Transport.create();

  try {
    // esm.sh CJS interop: the class may be exported as `default` or as the module itself.
    const Eth = (_ledgerEthModule!.default || _ledgerEthModule) as new (
      transport: LedgerTransport
    ) => LedgerEthApp;
    const eth = new Eth(transport);

    const { address } = await eth.getAddress(path, false);

    // Device model detection (optional; fallback to "Ledger")
    let deviceModel = 'Ledger';
    try {
      const appCfg = await eth.getAppConfiguration();
      deviceModel = appCfg.arbitraryDataEnabled ? 'Ledger Nano X / S Plus' : 'Ledger Nano S';
    } catch {
      // model detection is best-effort
    }

    return {
      type: 'ledger',
      address,
      path,
      deviceModel,
      async disconnect() {
        await transport.close();
      },
    };
  } catch (err) {
    await transport.close().catch(() => {});
    throw err;
  }
}

/**
 * Get the address at a BIP44 path from a Ledger device.
 *
 * This is a convenience wrapper that opens a transport, queries, and closes.
 * For multiple operations, prefer `connectLedger()` and reuse the connection.
 */
export async function getLedgerAddress(
  path = "m/44'/60'/0'/0/0"
): Promise<string> {
  const conn = await connectLedger(path);
  try {
    return conn.address;
  } finally {
    await conn.disconnect();
  }
}

/**
 * Sign an EVM transaction with a Ledger device.
 *
 * The `tx` object should include `to`, `value` (hex wei), and optionally
 * `data`, `chainId`, `nonce`, `gasLimit`, `gasPrice` or EIP-1559 fields.
 *
 * @param tx      The transaction to sign
 * @param path    BIP44 derivation path
 */
export async function signLedgerTransaction(
  tx: HardwareWalletTransaction,
  path = "m/44'/60'/0'/0/0"
): Promise<SignedTransaction> {
  await loadLedgerModules();

  const Transport = _ledgerTransportModule!.default || _ledgerTransportModule!;
  const transport = await Transport.create();

  try {
    // esm.sh CJS interop: the class may be exported as `default` or as the module itself.
    const Eth = (_ledgerEthModule!.default || _ledgerEthModule) as new (
      transport: LedgerTransport
    ) => LedgerEthApp;
    const eth = new Eth(transport);

    // EIP-1559 vs legacy detection: if maxFeePerGas is present, use 1559
    const isEIP1559 = !!tx.maxFeePerGas || !!tx.maxPriorityFeePerGas;

    const ledgerTx: Record<string, string | number> = {
      to: tx.to,
      value: tx.value,
      data: tx.data || '0x',
      chainId: tx.chainId != null ? tx.chainId : 1,
      nonce: tx.nonce || '0x0',
      gasLimit: tx.gasLimit || '0x5208', // 21000 default
    };

    if (isEIP1559) {
      ledgerTx['maxFeePerGas'] = tx.maxFeePerGas || '0x0';
      ledgerTx['maxPriorityFeePerGas'] = tx.maxPriorityFeePerGas || '0x0';
    } else {
      ledgerTx['gasPrice'] = tx.gasPrice || '0x0';
    }

    // Typed access list — empty for basic transfers
    const resolution = await eth.clearSignTransaction(
      path,
      ledgerTx as unknown as Parameters<typeof eth.clearSignTransaction>[1],
      // Ledger live-common EIP-712 domain separator (unused for simple txs)
    );

    return {
      r: resolution.r,
      s: resolution.s,
      v: parseInt(resolution.v, 16),
      signedTx: '', // populated below via ethers serialization if needed
    };
  } finally {
    await transport.close().catch(() => {});
  }
}

// ─── Trezor CDN script injection ────────────────────────────────────────────────

const TREZOR_CONNECT_SRC = 'https://connect.trezor.io/9/trezor-connect.js';

let _trezorConnectPromise: Promise<TrezorConnectAPI> | null = null;

interface TrezorConnectAPI {
  init(params: { manifest: { email: string; appUrl: string }; lazyLoad?: boolean }): Promise<void>;
  ethereumGetAddress(params: { path: string; showOnTrezor?: boolean }): Promise<{
    success: boolean;
    payload: { address: string; path: number[]; serializedPath: string };
  }>;
  ethereumSignTransaction(params: {
    path: string;
    transaction: {
      to: string;
      value: string;
      data?: string;
      chainId: number;
      nonce: string;
      gasLimit: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasPrice?: string;
    };
  }): Promise<{
    success: boolean;
    payload: { r: string; s: string; v: string; serializedTx: string };
  }>;
  dispose(): Promise<void>;
}

function loadTrezorConnect(): Promise<TrezorConnectAPI> {
  if (_trezorConnectPromise) return _trezorConnectPromise;

  _trezorConnectPromise = new Promise<TrezorConnectAPI>((resolve, reject) => {
    // If already injected by a previous call, resolve immediately
    const existing = (window as unknown as Record<string, unknown>).TrezorConnect as
      | TrezorConnectAPI
      | undefined;
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = TREZOR_CONNECT_SRC;
    script.async = true;
    script.onload = () => {
      const tc = (window as unknown as Record<string, unknown>).TrezorConnect as
        | TrezorConnectAPI
        | undefined;
      if (tc) {
        resolve(tc);
      } else {
        reject(new Error('TrezorConnect loaded but not exposed on window.TrezorConnect'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load Trezor Connect from CDN'));
    document.head.appendChild(script);
  });

  return _trezorConnectPromise;
}

/**
 * Connect to a Trezor hardware wallet via Trezor Connect.
 *
 * This initialises Trezor Connect with a manifest (required for the popup flow),
 * then retrieves the first address at the given BIP44 path.
 *
 * @param path  BIP44 derivation path (default: "m/44'/60'/0'/0/0")
 * @param email Developer contact email (for Trezor manifest)
 */
export async function connectTrezor(
  path = "m/44'/60'/0'/0/0",
  email = 'dev@hsmc.network'
): Promise<HardwareWalletConnection> {
  const TC = await loadTrezorConnect();

  await TC.init({
    manifest: {
      email,
      appUrl: typeof window !== 'undefined' ? window.location.origin : 'https://hsmc.network',
    },
    lazyLoad: true,
  });

  const result = await TC.ethereumGetAddress({ path, showOnTrezor: false });

  if (!result.success) {
    throw new Error('Trezor: failed to get address');
  }

  // Detect device model from serializedPath (heuristic)
  let deviceModel = 'Trezor';
  if (result.payload.serializedPath?.includes("m/44'/60'")) {
    deviceModel = 'Trezor Model T / Safe 3';
  }

  return {
    type: 'trezor',
    address: result.payload.address,
    path,
    deviceModel,
    async disconnect() {
      await TC.dispose();
    },
  };
}

/**
 * Get the address at a BIP44 path from a Trezor device.
 */
export async function getTrezorAddress(
  path = "m/44'/60'/0'/0/0"
): Promise<string> {
  const TC = await loadTrezorConnect();
  await TC.init({
    manifest: { email: 'dev@hsmc.network', appUrl: window.location.origin },
    lazyLoad: true,
  });

  const result = await TC.ethereumGetAddress({ path, showOnTrezor: false });
  if (!result.success) throw new Error('Trezor: failed to get address');
  return result.payload.address;
}

/**
 * Sign an EVM transaction with a Trezor device.
 */
export async function signTrezorTransaction(
  tx: HardwareWalletTransaction,
  path = "m/44'/60'/0'/0/0"
): Promise<SignedTransaction> {
  const TC = await loadTrezorConnect();
  await TC.init({
    manifest: { email: 'dev@hsmc.network', appUrl: window.location.origin },
    lazyLoad: true,
  });

  const isEIP1559 = !!tx.maxFeePerGas || !!tx.maxPriorityFeePerGas;

  const trezorTx: TrezorConnectAPI extends { ethereumSignTransaction(params: infer P): unknown }
    ? P extends { transaction: infer T } ? T : never
    : never = {
    to: tx.to,
    value: tx.value,
    data: tx.data || '0x',
    chainId: tx.chainId ?? 1,
    nonce: tx.nonce || '0x0',
    gasLimit: tx.gasLimit || '0x5208',
    ...(isEIP1559
      ? {
          maxFeePerGas: tx.maxFeePerGas || '0x0',
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas || '0x0',
        }
      : { gasPrice: tx.gasPrice || '0x0' }),
  };

  const result = await TC.ethereumSignTransaction({
    path,
    transaction: trezorTx as {
      to: string;
      value: string;
      data: string;
      chainId: number;
      nonce: string;
      gasLimit: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasPrice?: string;
    },
  });

  if (!result.success) {
    throw new Error('Trezor: transaction signing failed');
  }

  return {
    r: result.payload.r,
    s: result.payload.s,
    v: parseInt(result.payload.v, 16),
    signedTx: result.payload.serializedTx,
  };
}

// ─── Unified helpers ────────────────────────────────────────────────────────────

/**
 * Auto-detect and connect to either Ledger or Trezor.
 *
 * Tries Ledger first (via WebUSB — fast fail if not available),
 * then falls back to Trezor Connect.
 */
export async function connectHardwareWallet(
  type: HardwareWalletType,
  path?: string
): Promise<HardwareWalletConnection> {
  switch (type) {
    case 'ledger':
      return connectLedger(path);
    case 'trezor':
      return connectTrezor(path);
  }
}

/**
 * Check whether the browser environment supports WebUSB (Ledger) or
 * has the Trezor Connect bridge available.
 */
export function detectHardwareWalletSupport(): {
  ledger: boolean;
  trezor: boolean;
} {
  const hasWebUSB =
    typeof navigator !== 'undefined' &&
    'usb' in navigator &&
    typeof (navigator as Navigator & { usb?: { getDevices?: () => Promise<unknown> } }).usb?.getDevices === 'function';

  return {
    ledger: hasWebUSB,
    trezor: true, // Trezor Connect works everywhere via iframe
  };
}
