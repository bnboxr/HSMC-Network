/**
 * HSMC Mobile — Constants
 */

export const API_BASE_URL = 'http://localhost:3001';

export const NETWORKS = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',
} as const;

export const PRIVACY_LEVELS = {
  STANDARD: 'standard',
  SHIELDED: 'shielded',
} as const;

export const CURRENCIES = ['USD', 'EUR', 'RON'] as const;

export const AUTO_LOCK_TIMEOUTS = {
  '1min': 60_000,
  '5min': 300_000,
  '15min': 900_000,
  '1hour': 3_600_000,
  'Never': Infinity,
} as const;

export const DEFAULT_FEE = 0.001; // HSMC
export const MIN_PASSWORD_LENGTH = 8;
export const PBKDF2_ITERATIONS = 600000;

export const BIP44_PATH = "m/44'/60'/0'/0/0";

export const STORAGE_KEYS = {
  ENCRYPTED_SEED: '@hsmc/encrypted_seed',
  WALLET_ADDRESS: '@hsmc/wallet_address',
  STEALTH_ADDRESS: '@hsmc/stealth_address',
  AUTH_TOKEN: '@hsmc/auth_token',
  USER_ID: '@hsmc/user_id',
  BIOMETRIC_ENABLED: '@hsmc/biometric_enabled',
  NETWORK_MODE: '@hsmc/network_mode',
  CURRENCY: '@hsmc/currency',
  AUTO_LOCK_TIMEOUT: '@hsmc/auto_lock_timeout',
  PUSH_ENABLED: '@hsmc/push_enabled',
} as const;
