/**
 * HSMC Mobile — Push & Local Notification Service
 *
 * Uses @notifee/react-native for real system notifications (Android channels,
 * iOS permissions) with a graceful fallback to an in-app notification queue.
 * Notification types: transaction alerts, staking rewards, price alerts,
 * network status, unstake completion.
 */

import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidColor } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

const NOTIFICATION_QUEUE_KEY = '@hsmc/notification_queue';
const PUSH_ENABLED_KEY = '@hsmc/push_enabled';

// ─── Local Notification Queue (in-app, persisted) ───────────────────────────

let notificationQueue: PushNotification[] = [];
let queueLoaded = false;
let notificationListeners: Array<(notification: PushNotification) => void> = [];

async function loadQueue(): Promise<void> {
  if (queueLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_QUEUE_KEY);
    if (raw) {
      notificationQueue = JSON.parse(raw) as PushNotification[];
    }
    queueLoaded = true;
  } catch {
    queueLoaded = true;
  }
}

async function persistQueue(): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATION_QUEUE_KEY, JSON.stringify(notificationQueue.slice(0, 100)));
  } catch {
    // Non-critical persistence failure
  }
}

/** Register a listener for incoming notifications */
export function onNotification(callback: (notification: PushNotification) => void): () => void {
  notificationListeners.push(callback);
  return () => {
    notificationListeners = notificationListeners.filter(l => l !== callback);
  };
}

/** Add a notification to the queue, dispatch to listeners and show a system toast. */
export async function addNotification(notification: PushNotification): Promise<void> {
  await loadQueue();
  notificationQueue = [notification, ...notificationQueue].slice(0, 100);
  await persistQueue();
  for (const listener of notificationListeners) {
    listener(notification);
  }
  await showSystemNotification(notification).catch(() => undefined);
}

/** Mark a notification as read */
export async function markNotificationRead(id: string): Promise<void> {
  notificationQueue = notificationQueue.map(n =>
    n.id === id ? { ...n, read: true } : n
  );
  await persistQueue();
}

/** Get all notifications (most recent first) */
export async function getNotifications(): Promise<PushNotification[]> {
  await loadQueue();
  return [...notificationQueue];
}

/** Get unread count */
export async function getUnreadCount(): Promise<number> {
  await loadQueue();
  return notificationQueue.filter(n => !n.read).length;
}

/** Clear all notifications */
export async function clearNotifications(): Promise<void> {
  notificationQueue = [];
  await persistQueue();
}

// ─── System notifications via Notifee ───────────────────────────────────────

let channelCreated = false;

async function ensureChannel(): Promise<string> {
  if (channelCreated) return 'hsmc-default';
  await notifee.createChannel({
    id: 'hsmc-default',
    name: 'HSMC Wallet Alerts',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
  channelCreated = true;
  return 'hsmc-default';
}

async function isPushEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(PUSH_ENABLED_KEY);
  return raw !== 'false';
}

/** Display a system notification (works on Android 8+ via channels). */
export async function showSystemNotification(notification: PushNotification): Promise<void> {
  const enabled = await isPushEnabled();
  if (!enabled) return;
  await notifee.requestPermission();
  const channelId = Platform.OS === 'android' ? await ensureChannel() : undefined;
  await notifee.displayNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    data: notification.data || {},
    android: {
      channelId: channelId || 'hsmc-default',
      importance: AndroidImportance.HIGH,
      color: AndroidColor.parseColor('#6C5CE7'),
      pressAction: { id: 'default' },
      smallIcon: 'ic_launcher',
    },
  });
}

/** Set whether system push notifications are enabled (Settings). */
export async function setPushEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(PUSH_ENABLED_KEY, String(enabled));
}

/** Remove an in-app / system notification by id. */
export async function removeNotification(id: string): Promise<void> {
  notificationQueue = notificationQueue.filter(n => n.id !== id);
  await persistQueue();
  await notifee.cancelNotification(id).catch(() => undefined);
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
  void addNotification({
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
  void addNotification({
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
  void addNotification({
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
  void addNotification({
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
  void addNotification({
    id: generateId(),
    type: 'network_status',
    title: `Network: ${status}`,
    body: message,
    data: { status, message },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

/** Create and dispatch an unstake-complete notification */
export function notifyUnstakeComplete(amount: number, availableAt: string): void {
  void addNotification({
    id: generateId(),
    type: 'unstake_complete',
    title: 'Unstake Complete',
    body: `${amount.toFixed(4)} HSMC is available in your balance.`,
    data: { amount: String(amount), available_at: availableAt },
    timestamp: new Date().toISOString(),
    read: false,
  });
}

// ─── Registration ───────────────────────────────────────────────────────────

/**
 * Initialize the notification system: request permissions and create the
 * Android channel. Returns the notification token (device registration id).
 */
export async function registerForPushNotifications(): Promise<string> {
  const settings = await notifee.requestPermission();
  if (Platform.OS === 'android') {
    await ensureChannel();
  }
  const token = `hsmc-device-${Platform.OS}-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  console.log('[Notifications] Registered device token:', token);
  return token;
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
