import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/db/client';
import { lovable } from '@/integrations/lovable';
// Local auth types — no external dependency
import { restoreSeedFromDb } from '@/utils/wallet-seed-db';

/** Maximum time (ms) to wait for auth before showing app anyway */
const AUTH_TIMEOUT_MS = 5000;

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Safety timeout: if auth never responds, stop loading after 5s
    timeoutRef.current = setTimeout(() => {
      if (!cancelled) {
        console.warn('[useAuth] Auth timed out after', AUTH_TIMEOUT_MS, 'ms');
        setLoading(false);
        setError('Authentication service is unreachable. Some features may be unavailable.');
      }
    }, AUTH_TIMEOUT_MS);

    // Get initial session
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setSession(session);
        setUser(session?.user ?? null);
        setError(null);
        // Auto-restore encrypted seed from DB if missing in localStorage
        if (session?.user) {
          restoreSeedFromDb(session.user.id).catch(console.warn);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[useAuth] getSession failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        }
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return;
        try {
          setSession(session);
          setUser(session?.user ?? null);
          setError(null);
          // Restore seed on every fresh sign-in
          if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
            restoreSeedFromDb(session.user.id).catch(console.warn);
          }
        } catch (err: unknown) {
          console.error('[useAuth] onAuthStateChange error:', err);
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const signUp = async (email: string, password: string, username?: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: {
          username: username || normalizedEmail.split('@')[0],
        },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signInWithGoogle = async () => {
    const result = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: window.location.origin,
    });
    return { data: result, error: result.error ?? null };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return {
    user,
    session,
    loading,
    error,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
  };
};
