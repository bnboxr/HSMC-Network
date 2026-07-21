/**
 * Real browser Push Notifications via Notification API
 * Requests permission on login, sends native OS notifications
 * Triggers: incoming transactions, new blocks
 */
import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/db/client';

export const usePushNotifications = () => {
  const { user } = useAuth();
  const permissionRef = useRef<NotificationPermission>('default');
  // Track addresses already notified to avoid duplicates across re-renders
  const notifiedRef = useRef<Set<string>>(new Set());

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') {
      permissionRef.current = 'granted';
      return true;
    }
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    permissionRef.current = result;
    return result === 'granted';
  }, []);

  const sendNativeNotification = useCallback((
    title: string,
    body: string,
    icon?: string,
    tag?: string,
  ) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, {
        body,
        icon: icon || '/favicon.ico',
        tag: tag || title,
        badge: '/favicon.ico',
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {
      // Silently fail in restricted environments (e.g. service workers)
    }
  }, []);

  // Request permission on login
  useEffect(() => {
    if (!user) return;
    requestPermission();
  }, [user, requestPermission]);

  // Subscribe to DB notifications table — per-user alerts
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`push-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n = payload.new as { id: string; title: string; message: string; type: string };
          if (notifiedRef.current.has(n.id)) return;
          notifiedRef.current.add(n.id);
          sendNativeNotification(n.title, n.message, '/favicon.ico', n.id);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, sendNativeNotification]);

  // Subscribe to incoming transactions for user's wallets
  useEffect(() => {
    if (!user) return;

    // Fetch user's wallet addresses first
    let walletAddresses: string[] = [];
    supabase
      .from('wallets')
      .select('address')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) walletAddresses = data.map(w => w.address);
      });

    const channel = supabase
      .channel(`push-tx-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        (payload) => {
          const tx = payload.new as {
            id: string; hash: string; to_address: string;
            from_address: string; amount: number; status: string;
          };
          // Only notify when this user is the recipient
          if (!walletAddresses.includes(tx.to_address)) return;
          if (notifiedRef.current.has(tx.id)) return;
          notifiedRef.current.add(tx.id);

          sendNativeNotification(
            '💸 HSMC Received',
            `You received ${tx.amount.toFixed(4)} HSMC\nFrom: ${tx.from_address.slice(0, 16)}...`,
            '/favicon.ico',
            `tx-${tx.id}`,
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, sendNativeNotification]);

  // Subscribe to new blocks — broadcast to all users
  useEffect(() => {
    const channel = supabase
      .channel('push-blocks')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'blocks' },
        (payload) => {
          const b = payload.new as { id: string; block_number: number; miner_address: string; transactions_count: number };
          if (notifiedRef.current.has(`block-${b.id}`)) return;
          notifiedRef.current.add(`block-${b.id}`);

          if (Notification.permission === 'granted') {
            sendNativeNotification(
              '⛏️ New Block Mined',
              `Block #${b.block_number} — ${b.transactions_count} tx(s)\nMiner: ${b.miner_address.slice(0, 16)}...`,
              '/favicon.ico',
              `block-${b.id}`,
            );
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sendNativeNotification]);

  return { requestPermission, sendNativeNotification };
};
