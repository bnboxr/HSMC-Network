/**
 * Onboarding Page — Seed-Phrase-Only Auth Flow
 * Screen 1: Welcome (Create New Wallet / Import Existing Wallet)
 * Screen 2A: Create Wallet — 12-word BIP39 seed, confirm save
 * Screen 2B: Import Wallet — textarea, Check Balance via live RPCs
 * Screen 3: Wallet Ready — balances + Enter HSMC
 *
 * NO email. NO password. NO Google. Just the seed phrase.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, ArrowRight, Key, AlertTriangle, Loader2,
  CheckCircle2, Wallet, Shield, RefreshCw, Copy, Check,
  Download, Eye, EyeOff, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  generateMnemonic12, validateMnemonic,
  checkBalances, type BalancesResponse, type BalanceResult,
} from '@/utils/bip39-wallet';
import { authenticateWithSeed } from '@/utils/seed-auth';

type Step = 'welcome' | 'create' | 'import' | 'wallet-ready';

const OnboardingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');

  // Create flow
  const [mnemonic, setMnemonic] = useState('');
  const [showSeed, setShowSeed] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  // Import flow
  const [importSeed, setImportSeed] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<BalancesResponse | null>(null);
  const [scanError, setScanError] = useState('');

  // Shared
  const [busy, setBusy] = useState(false);
  const [walletAddr, setWalletAddr] = useState('');

  // ─── Generate seed on entering create step ───────────────────────────────
  useEffect(() => {
    if (step === 'create' && !mnemonic) {
      setMnemonic(generateMnemonic12());
      setShowSeed(true);
      setAcknowledged(false);
      setCopied(false);
    }
  }, [step, mnemonic]);

  // ─── Import: validate word count ─────────────────────────────────────────
  const importWordCount = importSeed.trim() ? importSeed.trim().split(/\s+/).length : 0;
  const importValidLength = [12, 15, 18, 21, 24, 25].includes(importWordCount);

  // ─── Validate seed phrase (import) ───────────────────────────────────────
  const validateImportSeed = useCallback(async (seed: string): Promise<boolean> => {
    const trimmed = seed.trim().replace(/\s+/g, ' ');
    const wc = trimmed.split(' ').length;
    if (wc === 25) return validateMnemonic(trimmed);
    if ([12, 15, 18, 21, 24].includes(wc)) {
      try {
        const bip39mod = await import('bip39');
            const validate = (bip39mod as any).validateMnemonic || bip39mod.default?.validateMnemonic;
            return validate(trimmed);
      } catch {
        return false;
      }
    }
    return false;
  }, []);

  // ─── Check Balance ──────────────────────────────────────────────────────
  const handleCheckBalance = async () => {
    const trimmed = importSeed.trim().replace(/\s+/g, ' ');
    const wc = trimmed.split(' ').length;
    if (![12, 15, 18, 21, 24, 25].includes(wc)) {
      setScanError(`Enter 12, 15, 18, 21, 24 or 25 words. Got ${wc}.`);
      return;
    }

    const valid = await validateImportSeed(trimmed);
    if (!valid) {
      setScanError('This seed phrase is not valid. Check your spelling and try again.');
      return;
    }

    setScanError('');
    setScanning(true);
    setScanResult(null);
    try {
      const result = await checkBalances(trimmed);
      setScanResult(result);
      toast({
        title: result.totalNetworksWithFunds > 0 ? 'Wallet Found' : 'Wallet Ready',
        description: result.totalNetworksWithFunds > 0
          ? `${result.totalNetworksWithFunds} network(s) with funds detected.`
          : 'No funds detected on any network.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(msg);
      toast({ title: 'Scan failed', description: msg, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  // ─── Proceed after create or import ─────────────────────────────────────
  const handleProceed = async () => {
    const seed = step === 'create' ? mnemonic : importSeed.trim().replace(/\s+/g, ' ');
    setBusy(true);
    try {
      const result = await authenticateWithSeed(seed);
      if (!result.ok) {
        toast({ title: 'Authentication failed', description: result.error, variant: 'destructive' });
        return;
      }
      setWalletAddr(result.address || '');
      setStep('wallet-ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // ─── Enter App ──────────────────────────────────────────────────────────
  const handleEnterApp = () => {
    try {
      localStorage.removeItem('hsmc_onboarding_step');
    } catch {
      // localStorage unavailable — ignore
    }
    let mcpReturn: string | null = null;
    try {
      mcpReturn = sessionStorage.getItem('mcp_return_to');
      if (mcpReturn) {
        sessionStorage.removeItem('mcp_return_to');
      }
    } catch {
      // sessionStorage unavailable — ignore
    }
    if (mcpReturn) {
          try { navigate(mcpReturn, { replace: true }); } catch { /* ignore */ }
          return;
        }
        try { navigate('/app', { replace: true }); } catch { /* ignore */ }
  };

  // ─── Helpers ────────────────────────────────────────────────────────────
  const handleCopyMnemonic = () => {
    navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMnemonic = () => {
    const blob = new Blob([`HSMC Seed Phrase\n\n${mnemonic}\n\nKeep this safe — never share it.`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'hsmc-seed.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  const mnemonicWords = mnemonic ? mnemonic.split(' ') : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Background — terminal dot grid + subtle ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, hsl(var(--primary) / 0.06), transparent)' }} />
        <div className="absolute inset-0 dot-grid-bg opacity-60" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-border/40">
        <a href="/landing" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <span className="text-lg font-bold gradient-text">HSMC</span>
        </a>
        <a href="/landing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Learn more</a>
      </nav>

      {/* Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <AnimatePresence mode="wait">

            {/* ═══════════════════════════════════════════════════════════════
                SCREEN 1: WELCOME
            ════════════════════════════════════════════════════════════════ */}
            {step === 'welcome' && (
              <motion.div key="welcome" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center backdrop-blur-sm">
                    <Shield className="w-8 h-8 text-primary" />
                  </div>
                  <h1 className="text-3xl font-black mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
                    Welcome to HSMC
                  </h1>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                    Your seed phrase is your account. No email. No password. Just you and your keys.
                  </p>
                </div>

                <div className="space-y-3">
                  <Button
                    variant="hero"
                    size="lg"
                    className="w-full gap-2 py-6 text-base"
                    onClick={() => setStep('create')}
                  >
                    <Wallet className="w-5 h-5" />
                    Create New Wallet
                  </Button>

                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full gap-2 py-6 text-base"
                    onClick={() => setStep('import')}
                  >
                    <Key className="w-5 h-5" />
                    Import Existing Wallet
                  </Button>
                </div>

                <p className="text-[11px] text-muted-foreground/60 text-center mt-6 max-w-xs mx-auto leading-relaxed">
                  HSMC does not store your seed phrase — you are solely responsible for its safekeeping.
                </p>
              </motion.div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                SCREEN 2A: CREATE WALLET
            ════════════════════════════════════════════════════════════════ */}
            {step === 'create' && (
              <motion.div key="create" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="text-center mb-5">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center backdrop-blur-sm">
                    <Wallet className="w-7 h-7 text-primary" />
                  </div>
                  <h1 className="text-2xl font-black" style={{ fontFamily: 'var(--font-serif)' }}>Your Recovery Phrase</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Write these 12 words down, in order, on paper. Do not screenshot them.
                  </p>
                </div>

                <div className="glass-panel space-y-4">
                  {/* Seed display */}
                  <div className="relative">
                    <div className="grid grid-cols-3 gap-1.5">
                      {mnemonicWords.map((word, i) => (
                        <div key={i} className="flex items-center gap-1 p-2 rounded-lg bg-muted/30 border border-border/40">
                          <span className="text-[9px] text-muted-foreground/50 font-mono w-4 shrink-0">{i + 1}</span>
                          <span className="text-[11px] font-mono font-medium truncate">{showSeed ? word : '••••'}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSeed(!showSeed)}
                      className="absolute top-1 right-1 p-1.5 hover:bg-muted rounded-lg transition-colors"
                    >
                      {showSeed ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                  </div>

                  {/* Copy / Download / Regenerate */}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-xs" onClick={handleCopyMnemonic}>
                      {copied ? <><Check className="w-3.5 h-3.5 text-primary" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-xs" onClick={handleDownloadMnemonic}>
                      <Download className="w-3.5 h-3.5" /> Download
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => { setMnemonic(generateMnemonic12()); setAcknowledged(false); setShowSeed(true); }}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Warning */}
                  <div className="flex items-start gap-3 p-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-destructive">Anyone who has these words can control your funds.</strong> HSMC can never recover them.
                    </p>
                  </div>

                  {/* Checkbox */}
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/40 cursor-pointer hover:bg-muted/30 transition-colors">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={e => setAcknowledged(e.target.checked)}
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <span className="text-xs text-muted-foreground">
                      I have written down all 12 words and stored them safely.
                    </span>
                  </label>

                  {/* CTA */}
                  <Button
                    variant="hero"
                    className="w-full gap-2"
                    onClick={handleProceed}
                    disabled={!acknowledged || busy}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Confirm & Continue
                  </Button>

                  <button
                    onClick={() => setStep('welcome')}
                    className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    ← Back
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                SCREEN 2B: IMPORT WALLET
            ════════════════════════════════════════════════════════════════ */}
            {step === 'import' && (
              <motion.div key="import" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <div className="text-center mb-5">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center backdrop-blur-sm">
                    <Key className="w-7 h-7 text-primary" />
                  </div>
                  <h1 className="text-2xl font-black" style={{ fontFamily: 'var(--font-serif)' }}>Restore Your Wallet</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enter your 12-word recovery phrase to restore access.
                  </p>
                </div>

                <div className="glass-panel space-y-4">
                  {/* Textarea */}
                  <div>
                    <textarea
                      value={importSeed}
                      onChange={e => { setImportSeed(e.target.value); setScanResult(null); setScanError(''); }}
                      placeholder="word1 word2 word3 … (12 words separated by spaces)"
                      className="w-full h-28 p-3 font-mono text-sm bg-background border border-input rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      spellCheck={false} autoCorrect="off" autoCapitalize="none"
                    />
                    <div className="flex justify-between text-xs mt-1">
                      <span className={`font-mono ${importWordCount === 0 ? 'text-muted-foreground/50' : importValidLength ? 'text-primary' : 'text-destructive'}`}>
                        {importWordCount} / 12 words
                      </span>
                      {importValidLength && (
                        <span className="text-primary flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Valid length</span>
                      )}
                    </div>
                  </div>

                  {/* Error */}
                  {scanError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/5 border border-destructive/20">
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                      <p className="text-xs text-destructive">{scanError}</p>
                    </div>
                  )}

                  {/* Check Balance */}
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleCheckBalance}
                    disabled={scanning || !importValidLength}
                  >
                    {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {scanning ? 'Scanning networks…' : 'Check Balance'}
                  </Button>

                  {/* Scan Results */}
                  {scanResult && (
                    <div className="space-y-2 p-3 rounded-xl bg-card/40 border border-primary/20">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Networks with funds</span>
                        <span className={`font-mono font-bold ${(scanResult.totalNetworksWithFunds ?? 0) > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {scanResult.totalNetworksWithFunds ?? 0} / {scanResult.chains?.length ?? 0}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground/70 break-all">
                        HSMC: {scanResult.hsmcAddress}
                      </div>
                      {scanResult.evmAddress && (
                        <div className="text-[10px] font-mono text-muted-foreground/70 break-all">
                          EVM: {scanResult.evmAddress}
                        </div>
                      )}
                      <div className="space-y-1.5 pt-2 border-t border-border/40">
                        {(scanResult.chains ?? []).map((c: BalanceResult) => (
                          <div key={c.chain} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${c.hasBalance ? 'bg-primary animate-pulse' : c.error ? 'bg-destructive/60' : 'bg-muted-foreground/30'}`} />
                              <span className="text-foreground">{c.chain}</span>
                            </div>
                            <div className="text-right">
                              {c.error ? (
                                <span className="text-destructive/80 font-mono text-[10px]" title={c.error}>unreachable</span>
                              ) : (
                                <span className={`font-mono ${c.hasBalance ? 'text-primary font-bold' : 'text-muted-foreground/60'}`}>
                                  {c.balance} {c.symbol}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 pt-1">
                        Balances queried in real-time from live RPCs. If you just sent funds, wait for confirmation.
                      </p>
                    </div>
                  )}

                  {/* Security note */}
                  <div className="flex items-start gap-3 p-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-destructive">Processed locally.</strong> Your seed phrase is never sent to any server.
                    </p>
                  </div>

                  {/* Enter App button */}
                  <Button
                    variant="hero"
                    className="w-full gap-2"
                    onClick={handleProceed}
                    disabled={busy || !importValidLength || (scanResult && (scanResult.totalNetworksWithFunds ?? 0) === 0 && !(scanResult.chains ?? []).some((c: BalanceResult) => !c.error))}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                    Enter HSMC
                  </Button>

                  <button
                    onClick={() => setStep('welcome')}
                    className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    ← Back
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                SCREEN 3: WALLET READY
            ════════════════════════════════════════════════════════════════ */}
            {step === 'wallet-ready' && (
              <motion.div key="wallet-ready" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <div className="glass-panel text-center space-y-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
                    className="w-20 h-20 mx-auto rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center"
                  >
                    <CheckCircle2 className="w-10 h-10 text-primary" />
                  </motion.div>

                  <div>
                    <h2 className="text-2xl font-black mb-1" style={{ fontFamily: 'var(--font-serif)' }}>
                      {scanResult && (scanResult.totalNetworksWithFunds ?? 0) > 0 ? 'Wallet Found' : 'Wallet Ready'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {scanResult && (scanResult.totalNetworksWithFunds ?? 0) > 0
                        ? `${scanResult.totalNetworksWithFunds} network(s) with funds detected.`
                        : 'No funds detected on any network.'}
                    </p>
                  </div>

                  {walletAddr && (
                    <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">HSMC Address</p>
                      <p className="font-mono text-xs text-primary break-all">{walletAddr}</p>
                    </div>
                  )}

                  {/* Balances summary (if scan was done in import flow) */}
                  {scanResult && (scanResult.totalNetworksWithFunds ?? 0) > 0 && (
                    <div className="space-y-2 p-3 rounded-xl bg-card/40 border border-primary/20 text-left">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Balances</p>
                      {(scanResult.chains ?? []).filter(c => c.hasBalance).map((c: BalanceResult) => (
                        <div key={c.chain} className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{c.chain}</span>
                          <span className="font-mono text-primary font-bold">{c.balance} {c.symbol}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground/60">
                    Balances queried from live RPCs. If you just sent funds, wait for confirmation.
                  </p>

                  <Button variant="hero" className="w-full gap-2 text-base py-5" onClick={handleEnterApp}>
                    Enter HSMC
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
};

export default OnboardingPage;
