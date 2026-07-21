/**
 * SeedPhraseRecovery — password re-auth + 3-word quiz before revealing mnemonic
 * Used inside the Security tab of ProfilePage
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Lock, ShieldCheck, KeyRound, AlertTriangle, Copy, Check, X, RefreshCw, CloudDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { decryptMnemonic } from '@/utils/bip39-wallet';
import { restoreWalletFromCloud } from '@/utils/wallet-backup';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

type Stage = 'locked' | 'reauth' | 'quiz' | 'revealed';

export const SeedPhraseRecovery = () => {
  const { user } = useAuth();
  const [stage, setStage] = useState<Stage>('locked');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [restoring, setRestoring] = useState(false);

  const [mnemonic, setMnemonic] = useState('');
  const [quizIndices, setQuizIndices] = useState<number[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizError, setQuizError] = useState('');
  const [copied, setCopied] = useState(false);

  // Check if seed exists locally (re-evaluated after restore)
  const [hasSeed, setHasSeed] = useState(user ? !!localStorage.getItem(`hsmc_encrypted_seed_${user.id}`) : false);

  // Auto-restore from cloud if seed missing locally
  useEffect(() => {
    if (!user || hasSeed) return;
    setRestoring(true);
    restoreWalletFromCloud(user.id).then((ok) => {
      if (ok) {
        setHasSeed(true);
        toast({ title: '☁️ Seed restored from cloud backup', description: 'Your wallet is available in this browser.' });
      }
      setRestoring(false);
    });
  }, [user, hasSeed]);

  // --- Step 1: Re-authenticate ---
  const handleReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    setAuthLoading(false);
    if (error) {
      setAuthError('Incorrect password. Please try again.');
      return;
    }

    // Try to decrypt seed
    const encrypted = localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
    if (!encrypted) {
      setAuthError('No seed phrase found for this account in this browser.');
      return;
    }
    try {
      const plain = await decryptMnemonic(encrypted, password);
      setMnemonic(plain);
      // Pick 3 random distinct indices for quiz
      const words = plain.split(' ');
      const indices = new Set<number>();
      const arr = new Uint32Array(1);
      while (indices.size < 3) { crypto.getRandomValues(arr); indices.add(arr[0] % words.length); }
      setQuizIndices([...indices].sort((a, b) => a - b));
      setQuizAnswers({});
      setStage('quiz');
    } catch {
      setAuthError('Failed to decrypt seed phrase. The stored seed may have been encrypted with a different password.');
    }
    setPassword('');
  };

  // --- Step 2: Quiz ---
  const submitQuiz = useCallback(() => {
    const words = mnemonic.split(' ');
    const allCorrect = quizIndices.every(
      i => quizAnswers[i]?.trim().toLowerCase() === words[i].toLowerCase()
    );
    if (allCorrect) {
      setQuizError('');
      setStage('revealed');
    } else {
      setQuizError('One or more words are incorrect. Check your saved seed phrase and try again.');
    }
  }, [mnemonic, quizIndices, quizAnswers]);

  const mnemonicWords = useMemo(() => mnemonic.split(' '), [mnemonic]);

  const handleCopy = () => {
    navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setStage('locked');
    setMnemonic('');
    setPassword('');
    setAuthError('');
    setQuizError('');
    setQuizAnswers({});
  };

  if (restoring) {
    return (
      <div className="p-4 rounded-lg bg-muted/20 border border-border/30 text-center">
        <RefreshCw className="w-5 h-5 text-primary mx-auto mb-2 animate-spin" />
        <p className="text-sm text-muted-foreground">Restoring seed from cloud backup…</p>
      </div>
    );
  }

  if (!hasSeed) {
    return (
      <div className="p-4 rounded-lg bg-muted/20 border border-border/30 text-center space-y-3">
        <AlertTriangle className="w-5 h-5 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">No seed phrase found in this browser or cloud backup.</p>
        <p className="text-xs text-muted-foreground/60">Generate or import a BIP39 wallet in the Wallet section first.</p>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={async () => {
            if (!user) return;
            setRestoring(true);
            const ok = await restoreWalletFromCloud(user.id);
            if (ok) {
              setHasSeed(true);
              toast({ title: '☁️ Restored!', description: 'Seed phrase recovered from cloud.' });
            } else {
              toast({ title: 'No cloud backup found', description: 'Please create a wallet first.', variant: 'destructive' });
            }
            setRestoring(false);
          }}
        >
          <CloudDownload className="w-4 h-4" />
          Try Cloud Restore
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="wait">
        {/* LOCKED */}
        {stage === 'locked' && (
          <motion.div key="locked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-accent/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5 text-accent-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Recovery Seed Phrase</p>
                  <p className="text-xs text-muted-foreground">25 words · AES-256-GCM encrypted locally</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setStage('reauth')}
              >
                <Eye className="w-3.5 h-3.5" />
                Reveal
              </Button>
            </div>
          </motion.div>
        )}

        {/* RE-AUTH */}
        {stage === 'reauth' && (
          <motion.div key="reauth" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="p-4 rounded-xl bg-muted/20 border border-primary/20 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Verify your identity</span>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter your account password to decrypt your seed phrase. This never leaves your device.
            </p>
            <form onSubmit={handleReauth} className="space-y-3">
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  placeholder="Your account password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {authError && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {authError}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleClose} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" variant="hero" size="sm" disabled={authLoading || !password} className="flex-1">
                  {authLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="w-3.5 h-3.5" />
                  )}
                  Verify
                </Button>
              </div>
            </form>
          </motion.div>
        )}

        {/* QUIZ */}
        {stage === 'quiz' && (
          <motion.div key="quiz" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="p-4 rounded-xl bg-muted/20 border border-secondary/20 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-secondary" />
                <span className="text-sm font-semibold">Confirm backup verification</span>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the following 3 words from your saved seed phrase to confirm you have it backed up.
            </p>
            <div className="space-y-3">
              {quizIndices.map(idx => (
                <div key={idx}>
                  <label className="text-xs text-muted-foreground mb-1 block font-mono">
                    Word #{idx + 1}
                  </label>
                  <Input
                    type="text"
                    placeholder={`Enter word #${idx + 1}`}
                    value={quizAnswers[idx] ?? ''}
                    onChange={e => setQuizAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </div>
              ))}
            </div>
            {quizError && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {quizError}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="neonGreen"
                size="sm"
                onClick={submitQuiz}
                disabled={quizIndices.some(i => !quizAnswers[i]?.trim())}
                className="flex-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Confirm & Reveal
              </Button>
            </div>
          </motion.div>
        )}

        {/* REVEALED */}
        {stage === 'revealed' && (
          <motion.div key="revealed" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-sm font-semibold text-destructive">Never share your seed phrase</span>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {mnemonicWords.map((word, i) => (
                <div key={i} className="flex flex-col items-center p-1.5 rounded-lg bg-background/60 border border-border/40">
                  <span className="text-[9px] text-muted-foreground/50 font-mono mb-0.5">{i + 1}</span>
                  <span className="text-xs font-mono font-semibold text-foreground">{word}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="flex-1 gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy All Words'}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClose} className="flex-1">
                <X className="w-3.5 h-3.5" />
                Close & Wipe
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

import React from 'react';
const SeedPhraseRecoveryForwarded = React.forwardRef<HTMLDivElement>((_, _ref) => <SeedPhraseRecovery />);
SeedPhraseRecoveryForwarded.displayName = 'SeedPhraseRecovery';
export default SeedPhraseRecoveryForwarded;
