import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from './useAuth';
import { toast } from '@/hooks/use-toast';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
  data: unknown;
  user_id: string | null;
}

export const useNotifications = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchNotifications = async () => {
      const query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (user) {
        query.or(`user_id.eq.${user.id},user_id.is.null`);
      } else {
        query.is('user_id', null);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching notifications:', error);
      } else {
        setNotifications(data || []);
        setUnreadCount(data?.filter((n) => !n.read).length || 0);
      }
    };

    fetchNotifications();

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotification = payload.new as Notification;
          if (newNotification.user_id === null || newNotification.user_id === user?.id) {
            setNotifications((prev) => [newNotification, ...prev]);
            setUnreadCount((prev) => prev + 1);
            toast({ title: newNotification.title, description: newNotification.message });
          }
        }
      )
      .subscribe();

    const blocksChannel = supabase
      .channel('blocks-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'blocks' }, (payload) => {
        const block = payload.new as { block_number: number; hash: string };
        toast({ title: '⛏️ New Block Mined!', description: `Block #${block.block_number} has been added to the chain` });
      })
      .subscribe();

    const txChannel = supabase
      .channel('transactions-notifications')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, (payload) => {
        const tx = payload.new as { status: string; hash: string; amount: number; to_address: string };
        if (tx.status === 'confirmed' && user) {
          const projectId = import.meta.env.VITE_PROJECT_ID;
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) return;
            fetch(`https://${projectId}.hsmc.network/functions/v1/advanced-notifications`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
                apikey: import.meta.env.VITE_API_KEY,
              },
              body: JSON.stringify({ type: 'tx_confirmed', data: { tx_hash: tx.hash, user_id: user.id, amount: tx.amount, to_address: tx.to_address } }),
            }).catch(console.error);
          });
          toast({ title: '✅ Transaction Confirmed!', description: `Transaction ${tx.hash.slice(0, 10)}... confirmed on-chain` });
        }
      })
      .subscribe();

    const stakingInterval = setInterval(async () => {
      if (!user) return;
      const projectId = import.meta.env.VITE_PROJECT_ID;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      fetch(`https://${projectId}.hsmc.network/functions/v1/advanced-notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_API_KEY },
        body: JSON.stringify({ type: 'check_staking_rewards', data: {} }),
      }).catch(console.error);
    }, 10 * 60 * 1000);

    const consensusChannel = supabase
      .channel('consensus-notifications')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'network_stats' }, async (payload) => {
        const oldState = (payload.old as { consensus_state?: string })?.consensus_state;
        const newState = (payload.new as { consensus_state?: string })?.consensus_state;
        if (oldState && newState && oldState !== newState && user) {
          const projectId = import.meta.env.VITE_PROJECT_ID;
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          fetch(`https://${projectId}.hsmc.network/functions/v1/advanced-notifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_API_KEY },
            body: JSON.stringify({ type: 'consensus_change', data: { old_state: oldState, new_state: newState } }),
          }).catch(console.error);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(blocksChannel);
      supabase.removeChannel(txChannel);
      supabase.removeChannel(consensusChannel);
      clearInterval(stakingInterval);
    };
  }, [user]);

  const markAsRead = async (notificationId: string) => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const markAllAsRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const deleteNotification = async (notificationId: string) => {
    if (!user) return;
    const { error } = await supabase.from('notifications').delete().eq('id', notificationId).eq('user_id', user.id);
    if (!error) {
      const removed = notifications.find(n => n.id === notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      if (removed && !removed.read) setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification };
};
