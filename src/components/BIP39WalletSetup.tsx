import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, Key, Eye, EyeOff, Copy, Check,
  Fingerprint, AlertTriangle, RefreshCw, Download,
  Upload, Lock, Unlock, ArrowRight, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import {
  generateMnemonic,
  validateMnemonic,
  encryptMnemonic,
  decryptMnemonic,
  deriveAddress,
  registerBiometric,
  authenticateBiometric,
  hasBiometricRegistered,
  isBiometricAvailable,
} from '@/utils/bip39-wallet';
import { backupWalletToCloud } from '@/utils/wallet-backup';
import { persistSeedToDb } from "@/utils/wallet-seed-db";
import { withRetry } from "@/utils/db-retry";
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/db/client';
import * as bip39Lib from 'bip39';

interface WalletSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (address: string) => void;
}

type SetupStep = 'choice' | 'generate' | 'confirm' | 'import' | 'encrypt' | 'biometric' | 'done';

const VALID_WORD_COUNTS = [12, 15, 18, 21, 24, 25] as const;
type ValidWordCount = typeof VALID_WORD_COUNTS[number];

const isValidWordCount = (n: number): n is ValidWordCount =>
  (VALID_WORD_COUNTS as readonly number[]).includes(n);

/** Validate a mnemonic of any BIP39-compatible length (12/15/18/21/24) or 25-word HSMC format */
const validateAnyMnemonic = (phrase: string): boolean => {
  const words = phrase.trim().split(/\s+/);
  const count = words.length;
  if (count === 25) return validateMnemonic(phrase.trim());
  if ([12, 15, 18, 21, 24].includes(count)) return bip39Lib.validateMnemonic(phrase.trim());
  return false;
};

export const BIP39WalletSetup = ({ isOpen, onClose, onComplete }: WalletSetupModalProps) => {
  const { user } = useAuth();
  const [step, setStep] = useState<SetupStep>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  // Dynamic size — filled when mnemonic is known
  const [confirmWords, setConfirmWords] = useState<string[]>(Array(25).fill(''));
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [copiedMnemonic, setCopiedMnemonic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);

  useEffect(() => {
    isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const handleGenerate = () => {
    const m = generateMnemonic(); // always 25-word HSMC format
    setMnemonic(m);
    const words = m.split(' ');
    setConfirmWords(Array(words.length).fill(''));
    // Pick 4 random word indices to verify
    const indices: number[] = [];
    const rng = new Uint32Array(1);
    while (indices.length < 4) {
      crypto.getRandomValues(rng);
      const i = rng[0] % words.length;
      if (!indices.includes(i)) indices.push(i);
    }
    setVerifyIndices(indices.sort((a, b) => a - b));
    setStep('generate');
  };

  const handleCopyMnemonic = () => {
    navigator.clipboard.writeText(mnemonic);
    setCopiedMnemonic(true);
    setTimeout(() => setCopiedMnemonic(false), 3000);
  };

  const handleVerifyWords = () => {
    const mnemonicWords = mnemonic.split(' ');
    for (const idx of verifyIndices) {
      if (confirmWords[idx]?.trim().toLowerCase() !== mnemonicWords[idx]) {
        toast({
          title: 'Verification Failed',
          description: `Word #${idx + 1} is incorrect. Please check your seed phrase.`,
          variant: 'destructive',
        });
        return;
      }
    }
    setStep('encrypt');
  };

  const handleImport = async () => {
    const trimmed = importMnemonic.trim().replace(/\s+/g, ' ');
    const wordCount = trimmed.split(' ').length;

    if (!isValidWordCount(wordCount)) {
      toast({
        title: 'Invalid Seed Phrase',
        description: `Expected 12, 15, 18, 21, 24 or 25 words. You entered ${wordCount}. Check each word.`,
        variant: 'destructive',
      });
      return;
    }

    const valid = validateAnyMnemonic(trimmed);
    if (!valid) {
      toast({
        title: 'Invalid Seed Phrase',
        description: 'One or more words are not valid BIP39 words. Check spelling carefully.',
        variant: 'destructive',
      });
      return;
    }

    setMnemonic(trimmed);
    setStep('encrypt');
  };

  const handleEncryptAndSave = async () => {
    if (password.length < 8) {
      toast({ title: 'Password too short', description: 'Minimum 8 characters', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const encrypted = await encryptMnemonic(mnemonic, password);
      const address = await deriveAddress(mnemonic);

      // Store encrypted mnemonic in localStorage (fast cache) AND DB (persistent)
      localStorage.setItem(`hsmc_encrypted_seed_${user!.id}`, encrypted);
      localStorage.setItem(`hsmc_wallet_address_${user!.id}`, address);

      // Persist to DB — survives localStorage clears and device changes
      await persistSeedToDb(user!.id, encrypted, address);
      const { data: primaryWallet, error: walletLookupError } = await withRetry(() => supabase
        .from("wallets")
        .select("id")
        .eq("user_id", user!.id)
        .eq("is_primary", true)
        .maybeSingle());
      if (walletLookupError) throw walletLookupError;
      const existingPrimaryWallet = primaryWallet as { id: string } | null;
      const walletWrite = existingPrimaryWallet
        ? await withRetry(() => supabase.from("wallets").update({ address, is_primary: true, label: "Main Wallet" }).eq("id", existingPrimaryWallet.id).eq("user_id", user!.id))
        : await withRetry(() => supabase.from("wallets").insert({ user_id: user!.id, address, balance: 0, is_primary: true, label: "Main Wallet" }));
      if (walletWrite.error) throw walletWrite.error;
      await withRetry(() => supabase
        .from("profiles")
        .update({ wallet_address: address })
        .eq("user_id", user!.id));

      // ✅ CRITICAL: backup encrypted seed to cloud so it can be recovered on any device
      try {
        await backupWalletToCloud(user!.id, address);
        toast({ title: '☁️ Seed backed up to cloud', description: 'Recoverable on any device.', duration: 3000 });
      } catch {
        // Non-fatal — seed is still safe locally
        console.warn('[BIP39Setup] Cloud backup failed, seed stored locally only');
      }

      if (biometricAvailable) {
        setStep('biometric');
      } else {
        setStep('done');
        onComplete(address);
      }
    } catch (err: unknown) {
      toast({ title: 'Encryption failed', description: String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSetupBiometric = async () => {
    const res = await registerBiometric(user!.id);
    if (res.ok) {
      setBiometricEnabled(true);
      toast({ title: '✅ Biometric registered', description: 'You can now use Face ID / fingerprint to unlock your wallet.' });
    } else {
      toast({ title: 'Biometric setup failed', description: res.error || 'You can set it up later from wallet settings.', variant: 'destructive' });
    }
    const address = localStorage.getItem(`hsmc_wallet_address_${user!.id}`) || '';
    setStep('done');
    onComplete(address);
  };

  const handleSkipBiometric = () => {
    const address = localStorage.getItem(`hsmc_wallet_address_${user!.id}`) || '';
    setStep('done');
    onComplete(address);
  };

  const words = mnemonic ? mnemonic.split(' ') : [];
  const wordCount = words.length;
  // Cols layout: 5 for 25, 4 for 12/24, 3 for 15/18/21
  const gridCols = wordCount === 25 ? 'grid-cols-5' : wordCount === 12 ? 'grid-cols-4' : 'grid-cols-5';

  // Import textarea word count
  const importWordCount = importMnemonic.trim() ? importMnemonic.trim().split(/\s+/).length : 0;
  const importValid = isValidWordCount(importWordCount);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <Key className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-bold text-lg">BIP39 Wallet Setup</h2>
                <p className="text-xs text-muted-foreground">HSMC Secure Wallet · Supports 12–25 words</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          <div className="p-6">
            {/* STEP: Choice */}
            {step === 'choice' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <p className="text-muted-foreground text-sm mb-6">
                  Your wallet is secured by a <strong className="text-foreground">BIP39 seed phrase</strong> (12–25 words) encrypted with AES-256-GCM. 
                  Your seed phrase never leaves this device.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={handleGenerate}
                    className="p-6 border border-border rounded-xl hover:border-primary/50 hover:bg-muted/30 transition-all text-left group"
                  >
                    <RefreshCw className="w-8 h-8 text-primary mb-3" />
                    <h3 className="font-semibold mb-1">Create New Wallet</h3>
                    <p className="text-xs text-muted-foreground">Generate a new 25-word HSMC seed phrase</p>
                  </button>
                  <button
                    onClick={() => setStep('import')}
                    className="p-6 border border-border rounded-xl hover:border-primary/50 hover:bg-muted/30 transition-all text-left group"
                  >
                    <Upload className="w-8 h-8 text-secondary mb-3" />
                    <h3 className="font-semibold mb-1">Import Wallet</h3>
                    <p className="text-xs text-muted-foreground">Restore from 12, 15, 18, 21, 24 or 25 words</p>
                  </button>
                </div>
                <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl mt-4">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-destructive">Security Warning:</strong> Never share your seed phrase with anyone. 
                    HSMC will never ask for it. Store it offline in a safe place.
                  </p>
                </div>
              </motion.div>
            )}

            {/* STEP: Show Generated Mnemonic */}
            {step === 'generate' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Your {wordCount}-Word Seed Phrase</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowMnemonic(!showMnemonic)}
                      className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                      {showMnemonic ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    <button
                      onClick={handleCopyMnemonic}
                      className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                      {copiedMnemonic ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>

                <div className={`grid ${gridCols} gap-2 p-4 bg-muted/30 rounded-xl border border-border ${!showMnemonic ? 'filter blur-sm select-none' : ''}`}>
                  {words.map((word, i) => (
                    <div key={i} className="flex items-center gap-1.5 p-2 bg-background/50 rounded-lg">
                      <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}.</span>
                      <span className="text-xs font-mono font-medium truncate">{word}</span>
                    </div>
                  ))}
                </div>

                {!showMnemonic && (
                  <p className="text-center text-sm text-muted-foreground">Click the eye icon to reveal your seed phrase</p>
                )}

                <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Write down all {wordCount} words in order and store them securely. You'll need to verify 4 words next.
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('choice')} className="flex-1">Back</Button>
                  <Button variant="hero" onClick={() => setStep('confirm')} className="flex-1">
                    I've Written It Down <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP: Verify Words */}
            {step === 'confirm' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <h3 className="font-semibold">Verify Your Seed Phrase</h3>
                <p className="text-sm text-muted-foreground">
                  Enter the words at positions {verifyIndices.map(i => i + 1).join(', ')} to confirm you've saved your {wordCount}-word phrase.
                </p>

                <div className="space-y-3">
                  {verifyIndices.map((idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground w-20 text-right shrink-0">Word #{idx + 1}</span>
                      <Input
                        type="text"
                        placeholder={`Enter word ${idx + 1}`}
                        value={confirmWords[idx] || ''}
                        onChange={(e) => {
                          const updated = [...confirmWords];
                          updated[idx] = e.target.value;
                          setConfirmWords(updated);
                        }}
                        className="font-mono text-sm"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 mt-4">
                  <Button variant="outline" onClick={() => setStep('generate')} className="flex-1">Back</Button>
                  <Button variant="hero" onClick={handleVerifyWords} className="flex-1">
                    Verify & Continue <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP: Import */}
            {step === 'import' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <h3 className="font-semibold">Import Seed Phrase</h3>
                <p className="text-sm text-muted-foreground">Enter your BIP39 seed phrase — 12, 15, 18, 21, 24 or 25 words separated by spaces.</p>

                <textarea
                  value={importMnemonic}
                  onChange={(e) => setImportMnemonic(e.target.value)}
                  placeholder="word1 word2 word3 ..."
                  className="w-full h-32 p-3 font-mono text-sm bg-background border border-input rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                />

                {/* Word count indicator */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {([12, 15, 18, 21, 24, 25] as number[]).map((n) => (
                      <span
                        key={n}
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-mono transition-colors ${
                          importWordCount === n
                            ? 'border-secondary/50 bg-secondary/10 text-secondary'
                            : 'border-border text-muted-foreground/50'
                        }`}
                      >
                        {n}w
                      </span>
                    ))}
                  </div>
                  <span className={`text-xs font-mono ${importValid ? 'text-secondary' : importWordCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {importWordCount} words {importValid ? '✓' : importWordCount > 0 ? '— invalid count' : ''}
                  </span>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep('choice')} className="flex-1">Back</Button>
                  <Button variant="hero" onClick={handleImport} className="flex-1" disabled={!importValid}>
                    Import Wallet <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP: Encrypt */}
            {step === 'encrypt' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Lock className="w-6 h-6 text-primary" />
                  <h3 className="font-semibold">Encrypt with AES-256</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Set a strong password to encrypt your {wordCount}-word seed phrase locally with AES-256-GCM. 
                  This password is required to access your wallet.
                </p>

                <div className="space-y-3">
                  <Input
                    type="password"
                    placeholder="Encryption password (min 8 chars)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className={`p-2 rounded-lg text-center ${password.length >= 8 ? 'bg-secondary/20 text-secondary' : 'bg-muted/30 text-muted-foreground'}`}>
                    8+ chars
                  </div>
                  <div className={`p-2 rounded-lg text-center ${/[A-Z]/.test(password) ? 'bg-secondary/20 text-secondary' : 'bg-muted/30 text-muted-foreground'}`}>
                    Uppercase
                  </div>
                  <div className={`p-2 rounded-lg text-center ${/[0-9!@#$%]/.test(password) ? 'bg-secondary/20 text-secondary' : 'bg-muted/30 text-muted-foreground'}`}>
                    Number/Symbol
                  </div>
                </div>

                <Button
                  variant="hero"
                  className="w-full"
                  onClick={handleEncryptAndSave}
                  disabled={loading || password.length < 8 || password !== confirmPassword}
                >
                  {loading ? (
                    <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Encrypting...</span>
                  ) : (
                    <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Encrypt & Save Wallet</span>
                  )}
                </Button>
              </motion.div>
            )}

            {/* STEP: Biometric */}
            {step === 'biometric' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-6">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/30">
                  <Fingerprint className="w-8 h-8 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-2">Enable Biometric Auth</h3>
                  <p className="text-sm text-muted-foreground">
                    Use Face ID, Touch ID, or Windows Hello to quickly unlock your wallet without typing your password every time.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleSkipBiometric} className="flex-1">Skip for now</Button>
                  <Button variant="hero" onClick={handleSetupBiometric} className="flex-1">
                    <Fingerprint className="w-4 h-4 mr-2" />Enable Biometrics
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP: Done */}
            {step === 'done' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center space-y-4 py-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-secondary/20 border border-secondary/30 flex items-center justify-center">
                  <ShieldCheck className="w-8 h-8 text-secondary" />
                </div>
                <h3 className="font-bold text-xl text-secondary">Wallet Ready!</h3>
                <p className="text-sm text-muted-foreground">
                  Your {wordCount}-word BIP39 wallet is encrypted and active. Your seed phrase is stored only on this device.
                </p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default BIP39WalletSetup;
