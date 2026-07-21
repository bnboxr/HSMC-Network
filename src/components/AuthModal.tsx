import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, Loader2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { authenticateWithSeed } from '@/utils/seed-auth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AuthModal = ({ isOpen, onClose }: AuthModalProps) => {
  const navigate = useNavigate();
  const [seed, setSeed] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = seed.trim().replace(/\s+/g, ' ');
    const wc = trimmed.split(' ').length;
    if (![12, 15, 18, 21, 24, 25].includes(wc)) {
      toast({ title: 'Invalid seed phrase', description: `Expected 12, 15, 18, 21, 24 or 25 words. Got ${wc}.`, variant: 'destructive' });
      return;
    }
    setLoading(true);
    const res = await authenticateWithSeed(trimmed);
    setLoading(false);
    if (!res.ok) {
      toast({ title: 'Authentication failed', description: res.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Wallet authenticated', description: res.address });
    onClose();
    navigate('/app');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-foreground">
                  Sign in with Seed Phrase
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                No email. No password. Your seed phrase is your account.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="text-sm font-medium text-foreground">
                  Seed Phrase (12, 24 or 25 words)
                </label>
                <div className="relative">
                  <Textarea
                    value={show ? seed : (seed ? '•'.repeat(Math.min(seed.length, 80)) : '')}
                    onChange={e => setSeed(e.target.value)}
                    placeholder="word1 word2 word3 ..."
                    className="font-mono text-xs min-h-[110px] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-2 top-2 p-1 hover:bg-muted rounded"
                  >
                    {show ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>

                <div className="flex items-start gap-3 p-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-destructive">Processed locally.</strong> Your seed phrase is never sent to any server.
                  </p>
                </div>

                <Button type="submit" className="w-full gap-2" disabled={loading || !seed.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  Sign in with Seed Phrase
                </Button>
              </form>

              <p className="text-xs text-muted-foreground mt-4 text-center">
                New to HSMC?{' '}
                <button
                  onClick={() => { onClose(); navigate('/onboarding'); }}
                  className="text-primary hover:underline font-medium"
                >
                  Create a new wallet
                </button>
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
