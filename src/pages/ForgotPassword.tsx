import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Key, Activity, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Password reset is no longer available — HSMC uses seed-phrase-only auth.
 * Redirect users to the seed-based recovery flow.
 */
export const ForgotPasswordPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => navigate('/onboarding', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, hsl(var(--primary) / 0.1), transparent)' }} />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-border/40">
        <a href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/30">
            <Activity className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold gradient-text">HSMC</span>
        </a>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-2xl shadow-primary/30">
            <Key className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-black mb-2" style={{ fontFamily: 'var(--font-serif)' }}>
            No Passwords Here
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            HSMC uses seed-phrase-only authentication. There are no passwords to reset.
            Your seed phrase is your account — keep it safe.
          </p>
          <Button variant="hero" className="gap-2" onClick={() => navigate('/onboarding')}>
            Go to Wallet Recovery <ArrowRight className="w-4 h-4" />
          </Button>
          <p className="text-xs text-muted-foreground/60 mt-4">Redirecting automatically...</p>
        </motion.div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
