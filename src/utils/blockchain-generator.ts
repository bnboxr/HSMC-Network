// Utility formatting functions for blockchain data display

// Format address for display
export const formatAddress = (address: string, length: number = 8): string => {
  if (!address) return '';
  if (address.length <= length * 2 + 2) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
};

// Format hash for display
export const formatHash = (hash: string, length: number = 10): string => {
  if (!hash) return '';
  if (hash.length <= length * 2 + 2) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
};

// Format timestamp to relative time
export const formatRelativeTime = (timestamp: string | number): string => {
  const date = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// Format number with commas
export const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

// Format large numbers
export const formatLargeNumber = (num: number): string => {
  if (num >= 1000000000) return `${(num / 1000000000).toFixed(2)}B`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
  return num.toString();
};
