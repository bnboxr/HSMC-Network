/**
 * Root route — login hub
 *
 * - Authenticated (Supabase session OR seed present) → /app
 * - Not authenticated → show login options:
 *   1. "🔐 Login with Biometric" (if WebAuthn supported)
 *   2. "Continue with Seed Phrase" → /onboarding
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Activity, Shield, Key, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import WebAuthnLogin from '@/components/WebAuthnLogin';

const LOADING_TIMEOUT_MS = 5000;

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  const safeNavigate = (path: string) => {
    try { navigate(path, { replace: true }); } catch { /* router not ready yet */ }
  };

  useEffect(() => {
    if (loading) {
      timeoutRef.current = setTimeout(() => {
        console.warn('[Index] Loading timed out, showing login options');
        setShowLogin(true);
      }, LOADING_TIMEOUT_MS);
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Check for any auth
    const hasSeed =
      !!localStorage.getItem('hsmc_encrypted_seed') ||
      Object.keys(localStorage).some(k => k.startsWith('hsmc_encrypted_seed_'));

    if (user || hasSeed) {
      safeNavigate('/app');
    } else {
      setShowLogin(true);
    }
  }, [user, loading, navigate]);

  const handleBiometricSuccess = (_token: string, _userData: { id: string; email: string }) => {
    // Store tokens for the app to use
    localStorage.setItem('hsmc_webauthn_token', _token);
    localStorage.setItem('hsmc_webauthn_user', JSON.stringify(_userData));
    safeNavigate('/app');
  };

  // Show loading spinner until we know what to do
  if (!showLogin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show login hub
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, hsl(var(--primary) / 0.06), transparent)' }}
        />
        <div className="absolute inset-0 dot-grid-bg opacity-60" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          {/* Logo / Brand */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center backdrop-blur-sm">
              <Activity className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-black mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
              HSMC Network
            </h1>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Privacy-preserving blockchain. Your keys, your coins, your privacy.
            </p>
          </div>

          {/* Login options */}
          <div className="glass-panel p-6 rounded-xl space-y-4">
            {/* ── Biometric Login ─────────────────────────────────────────── */}
            <WebAuthnLogin
              onSuccess={handleBiometricSuccess}
            />

            {/* ── Divider ────────────────────────────────────────────────── */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-3 text-muted-foreground">or</span>
              </div>
            </div>

            {/* ── Seed Phrase Login ───────────────────────────────────────── */}
            <Button
              variant="hero"
              size="lg"
              className="w-full gap-2 py-6 text-base"
              onClick={() => safeNavigate('/onboarding')}
            >
              <Key className="w-5 h-5" />
              Continue with Seed Phrase
            </Button>

            <p className="text-xs text-muted-foreground/60 text-center pt-1">
              No email. No password. Your seed phrase is your account.
            </p>
          </div>

          {/* Footer */}
          <p className="text-[11px] text-muted-foreground/60 text-center mt-6 max-w-xs mx-auto leading-relaxed">
            HSMC does not store your seed phrase — you are solely responsible for its safekeeping.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Index;
