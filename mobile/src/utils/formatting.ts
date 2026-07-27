/**
 * HSMC Mobile — Formatting Utilities
 */

/** Format HSMC balance with 4 decimal places */
export function formatBalance(balance: number, decimals = 4): string {
  return balance.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format USD value */
export function formatUSD(value: number): string {
  return '$' + value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Shorten an address for display */
export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/** Format a date for display */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Format percentage change */
export function formatPercentChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

/** Validate an HSMC address format */
export function isValidAddress(address: string): boolean {
  // HSMC addresses: 0x... (EVM-compatible) or HSMCst... (stealth)
  if (address.startsWith('0x') && address.length === 42) return true;
  if (address.startsWith('HSMCst') && address.length === 70) return true;
  return false;
}
