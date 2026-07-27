/**
 * HSMC Mobile — Push Notification Service
 * Uses Firebase Cloud Messaging (FCM) for Android and APNs for iOS.
 * Notification types: transaction alerts, staking rewards, price alerts, network status.
 */

import { Platform } from 'react-native';

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'transaction_sent'
  | 'transaction_received'
  | 'staking_reward'
  | 'price_alert'
  | 'network_status'
  | 'unstake_complete';

export interface PushNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  timestamp: string;
  read: boolean;
}

// ─── Local Notification Queue ───────────────────────────────────────────────

let notificationQueue: PushNotification[] = [];
let notificationListeners: Array<(notification: PushNotification) => void> = [];

/** Register a listener for incoming notifications */
export function onNotification(callback: (notification: PushNotification) => void): () => void {
  notificationListeners.push(callback);
  return () => {
    notificationListeners = notificationListeners.filter(l => l !== callback);
  };
}

/** Add a notification to the queue and notify listeners */
export function addNotification(notification: PushNotification): void {
  notificationQueue = [notification, ...notificationQueue].slice(0, 100); // Keep last 100
  for (const listener of notificationListeners) {
    listener(notification);
  }
}

/** Mark a notification as read */
export function markNotificationRead(id: string): void {
  notificationQueue = notificationQueue.map(n =>
    n.id === id ? { ...n, read: true } : n
  );
}

/** Get all notifications (most recent first) */
export function getNotifications(): PushNotification[] {
  return [...notificationQueue];
}

/** Get unread count */
export function getUnreadCount(): number {
  return notificationQueue.filter(n => !n.read).length;
}

/** Clear all notifications */
export function clearNotifications(): void {
  notificationQueue = [];
}

// ─── Notification Helper Functions ──────────────────────────────────────────

let notificationIdCounter = 0;

function generateId(): string {
  notificationIdCounter++;
  return `hsmc-notif-${Date.now()}-${notificationIdCounter}`;
}

/** Create and dispatch a transaction sent notification */
export function notifyTransactionSent(amount: number, toAddress: string, txHash: string): void {
  const shortAddr = toAddress.slice(0, 6) + '...' + toAddress.slice(-4);
  addNotification({
    id: generateId(),
    type: 'transaction_sent',
    title: 'Transaction Sent',
    body: `Sent ${amount.toFixed(4)} HSMC to ${shortAddr}`,
    data: { tx_hash: txHash, to_address: toAddress, amount: String(amount) },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

/** Create and dispatch a transaction received notification */
export function notifyTransactionReceived(amount: number, fromAddress: string, txHash: string): void {
  const shortAddr = fromAddress.slice(0, 6) + '...' + fromAddress.slice(-4);
  addNotification({
    id: generateId(),
    type: 'transaction_received',
    title: 'Transaction Received',
    body: `Received ${amount.toFixed(4)} HSMC from ${shortAddr}`,
    data: { tx_hash: txHash, from_address: fromAddress, amount: String(amount) },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

/** Create and dispatch a staking reward notification */
export function notifyStakingReward(amount: number, poolName: string): void {
  addNotification({
    id: generateId(),
    type: 'staking_reward',
    title: 'Staking Reward',
    body: `Earned ${amount.toFixed(4)} HSMC from ${poolName}`,
    data: { amount: String(amount), pool_name: poolName },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

/** Create and dispatch a price alert notification */
export function notifyPriceAlert(price: number, change24h: number, direction: 'up' | 'down'): void {
  const emoji = direction === 'up' ? '📈' : '📉';
  addNotification({
    id: generateId(),
    type: 'price_alert',
    title: `${emoji} HSMC Price Alert`,
    body: `HSMC is now $${price.toFixed(4)} (${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}% 24h)`,
    data: { price: String(price), change_24h: String(change24h) },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

/** Create and dispatch a network status notification */
export function notifyNetworkStatus(status: string, message: string): void {
  addNotification({
    id: generateId(),
    type: 'network_status',
    title: `Network: ${status}`,
    body: message,
    data: { status, message },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

// ─── FCM Token Management ───────────────────────────────────────────────────

let fcmToken: string | null = null;

/** Register for push notifications (platform-specific) */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    // In a real React Native app, this would use @react-native-firebase/messaging
    // For now, we simulate token registration

    if (Platform.OS === 'android') {
      // registerDeviceForRemoteMessages via Firebase messaging
      fcmToken = `fcm-android-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    } else if (Platform.OS === 'ios') {
      // requestPermission via Firebase messaging
      fcmToken = `apns-ios-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    } else {
      fcmToken = `token-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    console.log('[Notifications] Registered with token:', fcmToken);
    return fcmToken;
  } catch (error) {
    console.error('[Notifications] Failed to register:', error);
    return null;
  }
}

/** Get the current push notification token */
export function getFCMToken(): string | null {
  return fcmToken;
}

/** Unregister from push notifications */
export async function unregisterPushNotifications(): Promise<void> {
  fcmToken = null;
  console.log('[Notifications] Unregistered');
}

// ─── Price Alert Configuration ──────────────────────────────────────────────

export interface PriceAlertConfig {
  abovePrice?: number;
  belowPrice?: number;
  changePercentUp?: number;
  changePercentDown?: number;
  enabled: boolean;
}

let priceAlertConfig: PriceAlertConfig = { enabled: false };

export function setPriceAlertConfig(config: PriceAlertConfig): void {
  priceAlertConfig = config;
}

export function getPriceAlertConfig(): PriceAlertConfig {
  return { ...priceAlertConfig };
}

/** Check if a price update should trigger an alert */
export function checkPriceAlert(
  currentPrice: number,
  previousPrice: number
): { triggered: boolean; direction?: 'up' | 'down' } {
  if (!priceAlertConfig.enabled) return { triggered: false };

  const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

  if (priceAlertConfig.abovePrice && currentPrice > priceAlertConfig.abovePrice) {
    return { triggered: true, direction: 'up' };
  }
  if (priceAlertConfig.belowPrice && currentPrice < priceAlertConfig.belowPrice) {
    return { triggered: true, direction: 'down' };
  }
  if (priceAlertConfig.changePercentUp && changePercent > priceAlertConfig.changePercentUp) {
    return { triggered: true, direction: 'up' };
  }
  if (priceAlertConfig.changePercentDown && changePercent < -priceAlertConfig.changePercentDown) {
    return { triggered: true, direction: 'down' };
  }

  return { triggered: false };
}
