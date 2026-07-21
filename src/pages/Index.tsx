/**
 * Root route — redirects to /onboarding (unauthenticated) or /app (authenticated)
 * Checks both local auth session and localStorage seed presence.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

/** Maximum time to show the loading spinner before redirecting anyway */
const LOADING_TIMEOUT_MS = 5000;

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const safeNavigate = (path: string) => {
      try { navigate(path, { replace: true }); } catch { /* router not ready yet */ }
    };

    useEffect(() => {
      // Safety timeout: redirect after 5s even if loading never resolves
      if (loading) {
        timeoutRef.current = setTimeout(() => {
          console.warn('[Index] Loading timed out, redirecting to onboarding');
          const hasSeed =
            !!localStorage.getItem('hsmc_encrypted_seed') ||
            Object.keys(localStorage).some(k => k.startsWith('hsmc_encrypted_seed_'));
          safeNavigate(hasSeed ? '/app' : '/onboarding');
        }, LOADING_TIMEOUT_MS);
        return () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
      }

      // Clear timeout if loading resolved naturally
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Check for any auth: local user OR cached encrypted seed
      const hasSeed =
        !!localStorage.getItem('hsmc_encrypted_seed') ||
        Object.keys(localStorage).some(k => k.startsWith('hsmc_encrypted_seed_'));

      safeNavigate(user || hasSeed ? '/app' : '/onboarding');
    }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
