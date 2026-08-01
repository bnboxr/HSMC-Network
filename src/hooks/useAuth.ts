import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/db/client';
// lovable integration removed — using local auth only
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

    // Get initial session — wrap in try/catch because supabase.auth may throw synchronously
    try {
      supabase.auth.getSession()
        .then(({ data: { session } }) => {
          if (cancelled) return;
          setSession(session);
          setUser(session?.user ?? null);
          setError(null);
          if (session?.user) {
            restoreSeedFromDb(session.user.id).catch(console.warn);
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.warn('[useAuth] getSession failed (API unreachable or auth not available):', err);
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }
        });
    } catch (syncErr: unknown) {
      // supabase.auth getter throws synchronously (local mode — auth not available)
      if (!cancelled) {
        console.warn('[useAuth] Auth not available (local mode):', syncErr);
        setError('Auth service not available — using local wallet only.');
        setLoading(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    }

    // Listen for auth changes — also wrap in try/catch
    let subscription: { unsubscribe: () => void } = { unsubscribe: () => {} };
    try {
      const authResult = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (cancelled) return;
          try {
            setSession(session);
            setUser(session?.user ?? null);
            setError(null);
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
      subscription = authResult.data.subscription;
    } catch (_syncErr) {
      // local mode — no auth listener available
      console.warn('[useAuth] onAuthStateChange not available (local mode).');
    }

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const signUp = async (email: string, password: string, username?: string) => {
    try {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { data: null, error: msg };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { data, error };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { data: null, error: msg };
    }
  };

  const signInWithGoogle = async () => {
    // Google OAuth not available in local mode — use seed phrase wallet instead
    console.info('[useAuth] Google OAuth not available (local mode). Use seed phrase wallet.');
    return { data: null, error: 'Google OAuth not available in local mode' };
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      return { error };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
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
