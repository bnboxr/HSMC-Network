import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Key, Loader2, ArrowLeft, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { authenticateWithSeed } from '@/utils/seed-auth';
import { generateMnemonic } from '@/utils/bip39-wallet';

export default function WalletAuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [mnemonic, setMnemonic] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleGenerate = () => {
    setMnemonic(generateMnemonic());
    setShow(true);
    setMode('create');
    setAcknowledged(false);
  };

  const handleSubmit = async () => {
    if (mode === 'create' && !acknowledged) {
      toast({ title: 'Confirm you saved the seed', variant: 'destructive' });
      return;
    }
    setBusy(true);
    const res = await authenticateWithSeed(mnemonic.trim());
    setBusy(false);
    if (!res.ok) {
      toast({ title: 'Authentication failed', description: res.error, variant: 'destructive' });
      return;
    }
    toast({ title: '✅ Wallet authenticated', description: res.address });
    navigate('/app');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg bg-card border border-border rounded-2xl p-6 shadow-2xl"
      >
        <Link to="/" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-3 h-3" /> Back to home
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Key className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Wallet-only Sign In</h1>
            <p className="text-xs text-muted-foreground">No email. Your seed is your account.</p>
          </div>
        </div>

        <div className="flex gap-2 mt-4 mb-4">
          <Button
            variant={mode === 'signin' ? 'default' : 'outline'}
            size="sm" className="flex-1"
            onClick={() => setMode('signin')}
          >Recover with seed</Button>
          <Button
            variant={mode === 'create' ? 'default' : 'outline'}
            size="sm" className="flex-1"
            onClick={handleGenerate}
          >Create new wallet</Button>
        </div>

        {mode === 'create' && mnemonic && (
          <div className="p-3 mb-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 text-xs space-y-2">
            <div className="flex items-start gap-2 font-medium text-yellow-500">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>This seed phrase is the ONLY way to recover your account. We do not store it. If you lose it, your funds are unrecoverable.</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
              <span>I have written down all 25 words in a safe place.</span>
            </label>
          </div>
        )}

        <label className="text-xs font-medium block mb-1">
          Seed phrase {mode === 'signin' ? '(12, 24 or 25 words)' : '(generated for you)'}
        </label>
        <div className="relative">
          <Textarea
            value={show ? mnemonic : (mnemonic ? '•'.repeat(Math.min(mnemonic.length, 80)) : '')}
            onChange={e => setMnemonic(e.target.value)}
            placeholder="word1 word2 word3 ..."
            className="font-mono text-xs min-h-[110px] pr-10"
            readOnly={mode === 'create'}
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-2 top-2 p-1 hover:bg-muted rounded"
          >
            {show ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
          </button>
        </div>

        <Button
          className="w-full mt-4"
          disabled={!mnemonic || busy}
          onClick={handleSubmit}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {mode === 'signin' ? 'Sign in with seed' : 'Create wallet & sign in'}
        </Button>

        <p className="text-[11px] text-muted-foreground mt-4 text-center">
          New to HSMC? <Link to="/onboarding" className="text-primary hover:underline">Create a new wallet</Link>
        </p>
      </motion.div>
    </div>
  );
}
