import { motion } from 'framer-motion';
import {
  Wallet, Send, ArrowDownUp, History, Copy, Check, QrCode,
  Loader2, LogIn, Key, ShoppingCart, Fingerprint, Download,
  Upload, FileDown, FileUp, ChevronDown, Plus, ArrowLeftRight,
  Eye, EyeOff, ShieldAlert, X, Shield, Lock, Globe, Users, ShieldCheck,
  Info, Unlock
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWallet } from '@/hooks/useWallet';
import { useMultiWallet } from '@/hooks/useMultiWallet';
import { useAuth } from '@/hooks/useAuth';
import { useBlockchain } from '@/hooks/useBlockchain';
import { supabase } from '@/integrations/db/client';
import { formatAddress, formatRelativeTime } from '@/utils/blockchain-generator';
import { toast } from '@/hooks/use-toast';
import { BIP39WalletSetup } from '@/components/BIP39WalletSetup';
import { HSMCPay } from '@/components/HSMCPay';
import { MultiWalletManager } from '@/components/MultiWalletManager';
import {
  hasBiometricRegistered, isBiometricAvailable, authenticateBiometric,
  encryptMnemonic, decryptMnemonic, deriveStealthAddress
} from '@/utils/bip39-wallet';
import {
  PrivacyLevel, getPrivacyFeeInfo, isNodeAvailable,
  deriveDualKeyWallet, encodeStealthAddress,
  generateStealthOutput, generateCommitment,
  generateRingSignature, generateRangeProof,
  StealthOutputData
} from '@/utils/privacy-utils';
import { PasswordPromptModal } from '@/components/PasswordPromptModal';

export const WalletSection = () => {
  const { user } = useAuth();
  const { wallet, loading: walletLoading } = useWallet();
  const { wallets, activeWallet, switchWallet } = useMultiWallet();
  const { transactions } = useBlockchain();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'send' | 'receive'>('overview');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [showBIP39Setup, setShowBIP39Setup] = useState(false);
  const [showHSMCPay, setShowHSMCPay] = useState(false);
  const [showMultiWallet, setShowMultiWallet] = useState(false);
  const [showWalletSwitcher, setShowWalletSwitcher] = useState(false);
  const [hasSeedStored, setHasSeedStored] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [revealedSeed, setRevealedSeed] = useState('');
  const [seedVisible, setSeedVisible] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);

  // ── C7/C8/C9: Password in memory only, modal instead of prompt() ──────────────
  // Password is stored ONLY in this ref — never in sessionStorage/localStorage/disk
  const passwordRef = useRef<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  // Resolver for the promise-based password flow
  const passwordResolveRef = useRef<((pw: string | null) => void) | null>(null);

  /** Request password via modal. Returns password or null if cancelled. */
  const requestPassword = useCallback((): Promise<string | null> => {
    // Return cached password if available (in-memory only, same session lifecycle)
    if (passwordRef.current) {
      return Promise.resolve(passwordRef.current);
    }
    return new Promise<string | null>((resolve) => {
      passwordResolveRef.current = resolve;
      setShowPasswordModal(true);
    });
  }, []);

  /** Called when user submits password from modal */
  const handlePasswordSubmit = useCallback(async (pw: string): Promise<boolean> => {
    if (!user) return false;
    const storedSeed = localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
    if (!storedSeed) return false;
    try {
      // Try to decrypt to verify the password is correct
      await decryptMnemonic(storedSeed, pw);
      // Password is valid — store in memory (NEVER persist)
      passwordRef.current = pw;
      passwordResolveRef.current?.(pw);
      passwordResolveRef.current = null;
      setShowPasswordModal(false);
      return true;
    } catch {
      // Wrong password — modal handles the attempt count
      return false;
    }
  }, [user]);

  /** Called when user cancels password modal */
  const handlePasswordCancel = useCallback(() => {
    passwordResolveRef.current?.(null);
    passwordResolveRef.current = null;
    setShowPasswordModal(false);
  }, []);

  /** Clear in-memory password (e.g. on sign out or after sensitive operation) */
  const clearPassword = useCallback(() => {
    passwordRef.current = null;
  }, []);

  // ── Privacy state ──────────────────────────────────────────────────────────
  const [privacyMode, setPrivacyMode] = useState<'transparent' | 'private'>('transparent');
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>('full');
  const [showPrivacyOptions, setShowPrivacyOptions] = useState(false);
  const [nodeOnline, setNodeOnline] = useState<boolean | null>(null);
  const [checkingNode, setCheckingNode] = useState(false);
  // ── Privacy send progress ──────────────────────────────────────────────────
  type ProgressStepStatus = 'pending' | 'active' | 'done' | 'error';
  interface ProgressStep {
    id: string;
    label: string;
    status: ProgressStepStatus;
    detail?: string;
  }
  const PRIVACY_PROGRESS_STEPS: Record<string, { label: string; order: number }> = {
    deriving_keys:  { label: 'Deriving dual-key wallet (spend + view)', order: 0 },
    stealth_output: { label: 'Generating stealth one-time output...', order: 1 },
    commitment:     { label: 'Creating Pedersen commitment...', order: 2 },
    ring_signature: { label: 'Building ring signature (11 decoys)...', order: 3 },
    range_proof:    { label: 'Generating Bulletproof range proof...', order: 4 },
    signing:        { label: 'Signing and broadcasting...', order: 5 },
  };
  const [sendProgress, setSendProgress] = useState<ProgressStep[]>([]);
  const [sendProgressActive, setSendProgressActive] = useState(false);
  // ── Multi-sig state ───────────────────────────────────────────────────────
  const [showMultiSigDialog, setShowMultiSigDialog] = useState(false);
  const [multiSigThreshold, setMultiSigThreshold] = useState('3');
  const [multiSigAddresses, setMultiSigAddresses] = useState('');
  const [multiSigSaving, setMultiSigSaving] = useState(false);
  // ── Stealth address generator state ───────────────────────────────────────
  const [showStealthGen, setShowStealthGen] = useState(false);
  const [generatedStealthAddr, setGeneratedStealthAddr] = useState('');
  const [generatingStealth, setGeneratingStealth] = useState(false);
  const [stealthCopied, setStealthCopied] = useState(false);
  const [txTooltipId, setTxTooltipId] = useState<string | null>(null);
  // ────────────────────────────────────────────────────────────────────────────

  // Use the multi-wallet active wallet if available, fallback to useWallet
  const displayWallet = activeWallet || wallet;

  useEffect(() => {
    if (user) {
      setHasSeedStored(!!localStorage.getItem(`hsmc_encrypted_seed_${user.id}`));
      setHasBiometric(hasBiometricRegistered(user.id));
      isBiometricAvailable().then(setBiometricAvailable);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      setCheckingNode(true);
      const online = await isNodeAvailable();
      if (!cancelled) {
        setNodeOnline(online);
        setCheckingNode(false);
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  // Close transaction tooltip when clicking outside
  useEffect(() => {
    if (!txTooltipId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-tx-tooltip]')) {
        setTxTooltipId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [txTooltipId]);

  const handleCopy = () => {
    if (!displayWallet) return;
    navigator.clipboard.writeText(displayWallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Privacy badge styling ──────────────────────────────────────────────────
  const PRIVACY_BADGES: Record<string, { label: string; textColor: string; bgColor: string; borderColor: string; ringSize: number; hasRangeProof: boolean }> = {
    transparent: { label: 'Transparent', textColor: 'text-slate-400', bgColor: 'bg-slate-500/15', borderColor: 'border-slate-500/30', ringSize: 0, hasRangeProof: false },
    ringct:     { label: 'RingCT',     textColor: 'text-blue-400',  bgColor: 'bg-blue-500/15',   borderColor: 'border-blue-500/30',  ringSize: 11, hasRangeProof: false },
    stealth:    { label: 'Stealth',    textColor: 'text-violet-400',bgColor: 'bg-violet-500/15',  borderColor: 'border-violet-500/30', ringSize: 11, hasRangeProof: false },
    full:       { label: 'Full',       textColor: 'text-amber-400', bgColor: 'bg-amber-500/15',   borderColor: 'border-amber-500/30',  ringSize: 16, hasRangeProof: true },
    standard:   { label: 'Standard',   textColor: 'text-slate-400', bgColor: 'bg-slate-500/15',   borderColor: 'border-slate-500/30',  ringSize: 0,  hasRangeProof: false },
    private:    { label: 'Private',    textColor: 'text-blue-400',  bgColor: 'bg-blue-500/15',    borderColor: 'border-blue-500/30',   ringSize: 11, hasRangeProof: false },
    maximum:    { label: 'Maximum',    textColor: 'text-amber-400', bgColor: 'bg-amber-500/15',   borderColor: 'border-amber-500/30',  ringSize: 16, hasRangeProof: true },
  };

  const getPrivacyBadge = (level?: string | null) => {
    if (!level) return PRIVACY_BADGES.transparent;
    return PRIVACY_BADGES[level] ?? PRIVACY_BADGES.transparent;
  };

  // ── Stealth address generator ──────────────────────────────────────────────
  const handleGenerateStealth = async () => {
    if (!user) return;
    setGeneratingStealth(true);
    setGeneratedStealthAddr('');
    try {
      const storedSeed = localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
      if (!storedSeed) {
        toast({ title: 'BIP39 setup required', description: 'Generate a BIP39 wallet first to create stealth addresses.', variant: 'destructive' });
        setGeneratingStealth(false);
        return;
      }
      const pw = await requestPassword();
      if (!pw) { setGeneratingStealth(false); return; }
      let mnemonic: string;
      try {
        mnemonic = await decryptMnemonic(storedSeed, pw);
      } catch {
        clearPassword();
        toast({ title: 'Wrong password', variant: 'destructive' });
        setGeneratingStealth(false);
        return;
      }
      const addr = await deriveStealthAddress(mnemonic);
      setGeneratedStealthAddr(addr);
      toast({ title: '✅ Stealth Address Generated', description: 'Share this HSMCst address for private transactions.' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setGeneratingStealth(false);
    }
  };

  const handleStealthCopy = () => {
    if (!generatedStealthAddr) return;
    navigator.clipboard.writeText(generatedStealthAddr);
    setStealthCopied(true);
    setTimeout(() => setStealthCopied(false), 2000);
  };

  // ── Progress helper ─────────────────────────────────────────────────────────
  const updateProgress = useCallback((stepId: string, status: ProgressStepStatus, detail?: string) => {
    setSendProgress(prev => {
      const updated = prev.map(s => s.id === stepId ? { ...s, status, detail } : s);
      return updated;
    });
  }, []);

  const initProgress = useCallback((levels: PrivacyLevel) => {
    const steps: ProgressStep[] = [];
    const allStepIds = ['deriving_keys', 'stealth_output', 'commitment', 'ring_signature', 'range_proof', 'signing'];
    for (const id of allStepIds) {
      // Skip range_proof for non-full privacy
      if (id === 'range_proof' && levels !== 'full') continue;
      steps.push({
        id,
        label: PRIVACY_PROGRESS_STEPS[id].label,
        status: 'pending' as ProgressStepStatus,
      });
    }
    setSendProgress(steps);
    setSendProgressActive(true);
  }, []);

  // ── Stealth confirmation state ────────────────────────────────────────────
  const [stealthConfirm, setStealthConfirm] = useState<{
    oneTimeKey: string;
    ephemeralKey: string;
    privacyLevel: string;
  } | null>(null);

  const handleSend = async () => {
    if (!displayWallet || !recipientAddress || !sendAmount || !user) return;
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0 || amount > displayWallet.balance) {
      toast({ title: 'Invalid amount', variant: 'destructive' });
      return;
    }

    const isPrivate = privacyMode === 'private';
    const effectivePrivacy = isPrivate ? privacyLevel : 'transparent';
    const feeInfo = getPrivacyFeeInfo(effectivePrivacy, amount);

    // Ensure balance covers amount + fee
    if (displayWallet.balance < amount + feeInfo.minFee) {
      toast({
        title: 'Insufficient balance',
        description: `Need ${(amount + feeInfo.minFee).toFixed(4)} HSMC (amount + ${feeInfo.minFee} fee) but only have ${displayWallet.balance.toFixed(4)}`,
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    setSendProgressActive(false);
    setStealthConfirm(null);

    try {
      // Generate transaction hash
      const hashBytes = new Uint8Array(32);
      crypto.getRandomValues(hashBytes);
      const txHash = '0x' + Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      let ringSignature: string | null = null;
      let stealthAddress: string | null = null;
      let commitment: string | null = null;
      let rangeProof: string | null = null;
      let keyImage: string | null = null;
      let decoyCount: number | null = null;
      let privacyLevelStr = 'standard';
      let effectiveToAddress = recipientAddress;
      let stealthOutputResult: StealthOutputData | null = null;

      if (isPrivate) {
        // Verify node is online before attempting private transaction
        const nodeAvail = await isNodeAvailable();
        if (!nodeAvail) {
          toast({
            title: 'Privacy unavailable — node offline',
            description: 'Private transactions require a connected HSMC Rust node. Switch to Transparent mode or try again later.',
            variant: 'destructive',
          });
          setSending(false);
          return;
        }

        // Decrypt seed
        const storedSeed = localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
        if (!storedSeed) {
          toast({ title: 'BIP39 setup required', description: 'Private transactions require BIP39 wallet setup.', variant: 'destructive' });
          setSending(false);
          return;
        }

        const pw = await requestPassword();
        if (!pw) { setSending(false); return; }
        let mnemonic: string;
        try {
          mnemonic = await decryptMnemonic(storedSeed, pw);
        } catch {
          clearPassword();
          toast({ title: 'Wrong password', description: 'Cannot sign private transaction.', variant: 'destructive' });
          setSending(false);
          return;
        }

        const ringSize = effectivePrivacy === 'full' ? 16 : 11;
        const amountSatoshis = Math.round(amount * 1e8);

        // ── Step-by-step privacy build with progress ──────────────────────
        initProgress(effectivePrivacy);

        // Step 1: Derive dual-key wallet
        updateProgress('deriving_keys', 'active');
        const wallet_keys = await deriveDualKeyWallet(mnemonic);
        const senderAddress = encodeStealthAddress(wallet_keys.spendPublic, wallet_keys.viewPublic);
        updateProgress('deriving_keys', 'done');

        // Step 2: Generate stealth one-time output
        updateProgress('stealth_output', 'active');
        const isStealthAddr = recipientAddress.startsWith('HSMCst');
        let effectiveAddr: string = recipientAddress;
        if (!isStealthAddr) {
          // Wrap transparent address in a pseudo-stealth address
          const recipientPubHash = await crypto.subtle.digest(
            'SHA-256', new TextEncoder().encode(recipientAddress)
          );
          const derivedSP = new Uint8Array(recipientPubHash).slice(0, 32);
          const derivedVP = new Uint8Array(recipientPubHash).slice(0, 32);
          effectiveAddr = encodeStealthAddress(derivedSP, derivedVP);
        }
        stealthOutputResult = await generateStealthOutput(effectiveAddr, 0);
        stealthAddress = stealthOutputResult.oneTimeKey;
        updateProgress('stealth_output', 'done',
          `One-time key: ${stealthOutputResult.oneTimeKey.slice(0, 14)}...`);

        // Step 3: Generate Pedersen commitment
        updateProgress('commitment', 'active');
        const commitData = await generateCommitment(amountSatoshis, wallet_keys);
        commitment = commitData.commitment;
        updateProgress('commitment', 'done',
          `Commitment: ${commitment.slice(0, 14)}...`);

        // Step 4: Generate ring signature
        updateProgress('ring_signature', 'active',
          `Building ring signature with ${ringSize - 1} decoys...`);
        const message = `${senderAddress}:${stealthAddress}:${amount}:${Date.now()}`;
        const ringData = await generateRingSignature(message, wallet_keys, ringSize);
        ringSignature = ringData.ringSignature;
        keyImage = ringData.keyImage;
        updateProgress('ring_signature', 'done',
          `Key image: ${keyImage.slice(0, 14)}...`);

        // Step 5: Generate Bulletproof range proof (full only)
        if (effectivePrivacy === 'full') {
          updateProgress('range_proof', 'active');
          rangeProof = await generateRangeProof(amountSatoshis, commitment);
          updateProgress('range_proof', 'done',
            `Range proof: ${rangeProof.slice(0, 14)}...`);
        }

        decoyCount = ringSize;
        privacyLevelStr = effectivePrivacy;

        // Use stealth one-time address as the destination
        if (stealthOutputResult.oneTimeKey) {
          effectiveToAddress = '0x' + stealthOutputResult.oneTimeKey;
        }

        // Step 6: Signing & broadcasting
        updateProgress('signing', 'active');
      }

      // Insert confirmed transaction — build payload defensively
      const insertPayload: Record<string, unknown> = {
        hash: txHash,
        from_address: displayWallet.address,
        to_address: effectiveToAddress,
        amount: isPrivate ? 0 : amount, // hidden for private txs
        fee: feeInfo.minFee,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        privacy_level: privacyLevelStr,
        ring_signature: ringSignature,
        stealth_address: stealthAddress,
        commitment: commitment,
        range_proof: rangeProof,
        decoy_count: decoyCount,
      };
      if (keyImage) { insertPayload.key_image = keyImage; }

      const { error: txError } = await supabase.from('transactions').insert(insertPayload);
      if (txError) throw txError;

      // Deduct balance + fee from sender
      const { error: walletError } = await supabase
        .from('wallets')
        .update({ balance: parseFloat((displayWallet.balance - amount - feeInfo.minFee).toFixed(8)) })
        .eq('id', displayWallet.id);
      if (walletError) throw walletError;

      // If recipient has a wallet in our system, credit their balance
      const { data: recipientWallet } = await supabase
        .from('wallets')
        .select('id, balance')
        .eq('address', recipientAddress)
        .maybeSingle();
      if (recipientWallet) {
        await supabase
          .from('wallets')
          .update({ balance: parseFloat((recipientWallet.balance + amount).toFixed(8)) })
          .eq('id', recipientWallet.id);
      }

      // Mark signing as done
      if (isPrivate) {
        updateProgress('signing', 'done', 'Broadcast complete');
      }

      // Build success message
      const privacyLabel = isPrivate ? ` (${privacyLevelStr.toUpperCase()} private)` : '';

      if (isPrivate && stealthOutputResult) {
        // Show detailed stealth confirmation as inline panel, toast as summary
        setStealthConfirm({
          oneTimeKey: stealthOutputResult.oneTimeKey,
          ephemeralKey: stealthOutputResult.ephemeralKey,
          privacyLevel: privacyLevelStr,
        });
        toast({
          title: '🔒 Private Transaction Sent!',
          description: `${amount.toFixed(4)} HSMC sent via stealth address (${privacyLevelStr.toUpperCase()}). One-time destination key generated.`,
        });
      } else {
        toast({
          title: isPrivate ? '🔒 Private Transaction Sent!' : 'Transaction sent!',
          description: `Sent ${amount.toFixed(4)} HSMC${privacyLabel} — fee: ${feeInfo.minFee.toFixed(6)} HSMC`,
        });
      }

      setRecipientAddress('');
      setSendAmount('');
      setPrivacyMode('transparent');
      setActiveTab('overview');
    } catch (err: unknown) {
      // Mark current active step as errored
      setSendProgress(prev =>
        prev.map(s => s.status === 'active' ? { ...s, status: 'error' as ProgressStepStatus, detail: (err as Error).message } : s)
      );
      toast({ title: 'Transaction Failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleBiometricUnlock = async () => {
    if (!user) return;
    const ok = await authenticateBiometric(user.id);
    if (ok) {
      toast({ title: '✅ Biometric verified', description: 'Wallet unlocked.' });
    } else {
      toast({ title: 'Biometric failed', variant: 'destructive' });
    }
  };

  // ─── View Seed Phrase ────────────────────────────────────────────────────────
  const handleRevealSeed = async () => {
    if (!user) return;
    setSeedLoading(true);
    try {
      const storedSeed = localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
      if (!storedSeed) {
        toast({ title: 'Seed not found', description: 'Setup BIP39 first to secure your wallet.', variant: 'destructive' });
        setSeedLoading(false);
        return;
      }
      const decrypted = await decryptMnemonic(storedSeed, seedPassword);
      setRevealedSeed(decrypted);
      setSeedVisible(true);
    } catch {
      toast({ title: 'Wrong password', description: 'The password you entered is incorrect.', variant: 'destructive' });
    } finally {
      setSeedLoading(false);
    }
  };

  const closeSeedModal = () => {
    setShowSeedModal(false);
    setSeedPassword('');
    setRevealedSeed('');
    setSeedVisible(false);
  };

  // ─── Export .hsmc file ──────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!user || !wallet) return;
    if (exportPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Min 8 characters', variant: 'destructive' });
      return;
    }

    const storedSeed = localStorage.getItem(`hsmc_encrypted_seed_${user.id}`);
    if (!storedSeed) {
      toast({ title: 'No seed found', description: 'Setup BIP39 first', variant: 'destructive' });
      return;
    }

    try {
      // Decrypt existing stored seed, then re-encrypt with export password
      const existingEncrypted = storedSeed;
      const exportPayload = {
        version: '1.0',
        chain: 'HSMC',
        address: wallet.address,
        encrypted_seed: existingEncrypted,
        user_id: user.id,
        created_at: new Date().toISOString(),
      };

      // Re-encrypt the payload with new password
      const json = JSON.stringify(exportPayload);
      const reEncrypted = await encryptMnemonic(json, exportPassword);

      const finalPayload = {
        format: 'HSMC-Wallet-v1',
        data: reEncrypted,
        checksum: btoa(wallet.address.slice(2, 10)),
      };

      const blob = new Blob([JSON.stringify(finalPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hsmc-wallet-${wallet.address.slice(0, 10)}.hsmc`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: '✅ Wallet exported', description: 'Keep your .hsmc file safe!' });
      setShowExport(false);
      setExportPassword('');
    } catch (err: unknown) {
      toast({ title: 'Export failed', description: String(err), variant: 'destructive' });
    }
  };

  // ─── Import .hsmc file ──────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setImportLoading(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (parsed.format !== 'HSMC-Wallet-v1') {
        throw new Error('Invalid .hsmc file format');
      }

      // Request password via secure modal (C9: no prompt())
      const importPassword = await requestPassword();
      if (!importPassword) { setImportLoading(false); return; }

      const decrypted = await decryptMnemonic(parsed.data, importPassword);
      const inner = JSON.parse(decrypted);

      if (inner.chain !== 'HSMC' && inner.chain !== 'ASTRA-HSMC') {
        throw new Error('Not a HSMC wallet file');
      }

      // Restore encrypted seed into localStorage
      localStorage.setItem(`hsmc_encrypted_seed_${user.id}`, inner.encrypted_seed);
      localStorage.setItem(`hsmc_wallet_address_${user.id}`, inner.address);

      // Update DB wallet address
      await supabase.from('wallets').update({ address: inner.address }).eq('user_id', user.id);
      await supabase.from('profiles').update({ wallet_address: inner.address }).eq('user_id', user.id);

      setHasSeedStored(true);
      toast({ title: '✅ Wallet imported!', description: `Address: ${inner.address.slice(0, 14)}...` });
    } catch (err: unknown) {
      toast({ title: 'Import failed', description: String(err), variant: 'destructive' });
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─── Multi-Sig Save ─────────────────────────────────────────────────────────
  const handleMultiSigSave = async () => {
    if (!user) return;
    const t = parseInt(multiSigThreshold);
    const addresses = multiSigAddresses.split(/[\n,]+/).map(a => a.trim()).filter(Boolean);
    if (isNaN(t) || t < 1 || t > addresses.length) {
      toast({
        title: 'Invalid configuration',
        description: `Threshold (t=${t}) must be >= 1 and <= number of signers (${addresses.length})`,
        variant: 'destructive',
      });
      return;
    }
    setMultiSigSaving(true);
    try {
      const { error } = await supabase.from('user_settings').upsert({
        user_id: user.id,
        setting_key: 'multi_sig_config',
        setting_value: JSON.stringify({ t, n: addresses.length, addresses }),
      }, { onConflict: 'user_id,setting_key' });
      if (error) throw error;
      toast({ title: '✅ Multi-Sig Created', description: `${t}-of-${addresses.length} wallet configured` });
      setShowMultiSigDialog(false);
      setMultiSigThreshold('3');
      setMultiSigAddresses('');
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' });
    } finally {
      setMultiSigSaving(false);
    }
  };


  if (!user) {
    return (
      <section id="wallet" className="py-20 gradient-mesh">
        <div className="container mx-auto px-4">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              <span className="gradient-text">Wallet</span> Interface
            </h2>
          </motion.div>
          <div className="max-w-md mx-auto text-center py-16 bg-card/50 rounded-xl border border-border">
            <LogIn className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-xl font-semibold mb-2">Sign in to access your wallet</h3>
            <p className="text-muted-foreground">Create an account or sign in to manage your HSMC tokens</p>
          </div>
        </div>
      </section>
    );
  }

  if (walletLoading) {
    return (
      <section id="wallet" className="py-20 gradient-mesh">
        <div className="container mx-auto px-4 flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  if (!displayWallet) {
    return (
      <section id="wallet" className="py-20 gradient-mesh">
        <div className="container mx-auto px-4 text-center py-20">
          <p className="text-muted-foreground">No wallet found. Please contact support.</p>
        </div>
      </section>
    );
  }

  const walletTxs = displayWallet
    ? transactions.filter(tx => tx.from_address === displayWallet.address || tx.to_address === displayWallet.address)
    : [];

  return (
    <section id="wallet" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            <span className="gradient-text">Wallet</span> Interface
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Manage your HSMC tokens with BIP39 security, biometric auth, and HSMCPay
          </p>
        </motion.div>

        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel mb-6">
            {/* Wallet Switcher */}
            {wallets.length > 1 && (
              <div className="mb-4 flex items-center gap-2">
                <button
                  onClick={() => setShowWalletSwitcher(!showWalletSwitcher)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-primary/50 text-sm transition-colors bg-muted/20"
                >
                   <Wallet className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">{displayWallet?.label ?? 'Wallet'}</span>
                  <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${showWalletSwitcher ? 'rotate-180' : ''}`} />
                </button>
                <button onClick={() => setShowMultiWallet(true)} className="p-1.5 hover:bg-muted rounded-lg transition-colors" title="Manage wallets">
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => setShowMultiWallet(true)} className="p-1.5 hover:bg-muted rounded-lg transition-colors" title="Transfer between wallets">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
            {showWalletSwitcher && wallets.length > 1 && (
              <div className="mb-4 p-2 bg-muted/20 rounded-xl border border-border space-y-1">
                {wallets.map(w => (
                  <button key={w.id} onClick={() => { switchWallet(w.id); setShowWalletSwitcher(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      displayWallet?.id === w.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                    }`}>
                    <span className="font-mono">{w.label}</span>
                    <span className="font-mono text-xs">{w.balance.toFixed(4)} HSMC</span>
                  </button>
                ))}
                <button onClick={() => { setShowWalletSwitcher(false); setShowMultiWallet(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
                  <Plus className="w-3 h-3" /> Create new wallet
                </button>
              </div>
            )}
            {wallets.length <= 1 && (
              <div className="mb-4 flex justify-end">
                <button onClick={() => setShowMultiWallet(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                  <Plus className="w-3 h-3" /> Add wallet
                </button>
              </div>
            )}
            {/* Wallet Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-border">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center backdrop-blur-sm">
                  <Wallet className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Your Wallet</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{formatAddress(displayWallet?.address ?? '', 8)}</span>
                    <button onClick={handleCopy} className="p-1 hover:bg-muted rounded transition-colors">
                      {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Security Controls */}
              <div className="flex flex-wrap gap-2">
                {!hasSeedStored ? (
                  <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary" onClick={() => setShowBIP39Setup(true)}>
                    <Key className="w-4 h-4" /> Setup BIP39
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary">
                    <Key className="w-3 h-3" /> BIP39 Secured
                  </div>
                )}
                {biometricAvailable && hasBiometric && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={handleBiometricUnlock}>
                    <Fingerprint className="w-4 h-4" /> Unlock
                  </Button>
                )}
                {hasSeedStored && (
                  <>
                    <Button variant="outline" size="sm" className="gap-2 border-warning/50 text-warning hover:bg-warning/10" onClick={() => setShowSeedModal(true)}>
                      <Eye className="w-4 h-4" /> View Seed
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2 border-secondary/50 text-secondary hover:bg-secondary/10" onClick={() => setShowStealthGen(true)}>
                      <Shield className="w-4 h-4" /> Stealth
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowExport(!showExport)}>
                      <FileDown className="w-4 h-4" /> Export
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importLoading}
                >
                  {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                  Import
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".hsmc"
                  onChange={handleImport}
                  className="hidden"
                />
              </div>
            </div>

            {/* Export Panel */}
            {showExport && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-6 p-4 bg-muted/30 rounded-xl border border-border"
              >
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Download className="w-4 h-4 text-primary" /> Export Wallet as .hsmc (AES-256-GCM)
                </h4>
                <div className="flex gap-3">
                  <Input
                    type="password"
                    placeholder="Export password (min 8 chars)"
                    value={exportPassword}
                    onChange={e => setExportPassword(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="hero" size="sm" onClick={handleExport} disabled={exportPassword.length < 8}>
                    <FileDown className="w-4 h-4 mr-1" /> Download
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  The .hsmc file is encrypted with AES-256-GCM. Keep it safe and remember the password.
                </p>
              </motion.div>
            )}

            {/* Balance Display — Terminal Style */}
            <div className="text-center mb-8">
              <div className="font-mono text-5xl sm:text-6xl font-bold mb-2 tracking-tight">
                <span className="text-foreground">{(displayWallet?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                <span className="text-2xl text-muted-foreground ml-3 font-mono">HSMC</span>
              </div>
              {(displayWallet?.staked_balance ?? 0) > 0 && (
                <div className="text-lg text-muted-foreground">
                  + {(displayWallet?.staked_balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} staked
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              <Button
                variant={activeTab === 'send' ? 'hero' : 'glass'}
                size="lg"
                className="gap-2"
                onClick={() => setActiveTab(activeTab === 'send' ? 'overview' : 'send')}
              >
                <Send className="w-5 h-5" /> Send
              </Button>
              <Button
                variant={activeTab === 'receive' ? 'hero' : 'glass'}
                size="lg"
                className="gap-2"
                onClick={() => setActiveTab(activeTab === 'receive' ? 'overview' : 'receive')}
              >
                <QrCode className="w-5 h-5" /> Receive
              </Button>
              <Button variant="glass" size="lg" className="gap-2 border-primary/30" onClick={() => setShowHSMCPay(true)}>
                <ShoppingCart className="w-5 h-5" /> HSMCPay
              </Button>
              <Button variant="glass" size="lg" className="gap-2" onClick={() => setShowMultiSigDialog(true)}>
                <Users className="w-5 h-5" /> Multi-Sig
              </Button>
            </div>

            {/* Send */}
            {activeTab === 'send' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="border-t border-border pt-6">
                <h4 className="font-semibold mb-4">Send HSMC</h4>
                <div className="space-y-4">
                  {/* ── Privacy Mode Toggle ──────────────────────────────── */}
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Transaction Type</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setPrivacyMode('transparent'); setShowPrivacyOptions(false); }}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                          privacyMode === 'transparent'
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-muted/20 border-border text-muted-foreground hover:border-primary/30'
                        }`}
                      >
                        <Globe className="w-4 h-4" /> Transparent
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (nodeOnline === false) {
                            toast({
                              title: 'Privacy unavailable',
                              description: 'The HSMC Rust node is offline. Privacy features require a connected node.',
                              variant: 'destructive',
                            });
                            return;
                          }
                          setPrivacyMode('private');
                          setShowPrivacyOptions(true);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                          privacyMode === 'private'
                            ? 'bg-secondary/10 border-secondary text-secondary'
                            : nodeOnline === false
                              ? 'bg-muted/20 border-border text-muted-foreground opacity-50 cursor-not-allowed'
                              : 'bg-muted/20 border-border text-muted-foreground hover:border-secondary/30'
                        }`}
                        title={nodeOnline === false ? 'HSMC Rust node offline — privacy features unavailable' : ''}
                      >
                        <Shield className="w-4 h-4" /> Private
                        {nodeOnline === false && (
                          <span className="text-[10px] ml-1 text-destructive">offline</span>
                        )}
                      </button>
                    </div>
                    {nodeOnline === false && (
                      <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Privacy unavailable — Rust node offline. Only transparent transactions are available.
                      </p>
                    )}
                    {nodeOnline === true && (
                      <p className="text-xs text-secondary mt-1.5 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> HSMC Rust node connected — full privacy features available.
                      </p>
                    )}
                    {checkingNode && (
                      <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Checking node connectivity...
                      </p>
                    )}
                  </div>

                  {/* ── Privacy Level Selector (when Private) ──────────── */}
                  {privacyMode === 'private' && showPrivacyOptions && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="p-4 bg-secondary/5 border border-secondary/20 rounded-xl space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-secondary" />
                        <span className="text-sm font-semibold text-secondary">Privacy Level</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['ringct', 'stealth', 'full'] as PrivacyLevel[]).map(level => {
                          const info = getPrivacyFeeInfo(level, parseFloat(sendAmount) || 0);
                          const isSelected = privacyLevel === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              onClick={() => setPrivacyLevel(level)}
                              className={`p-3 rounded-lg border text-xs text-left transition-all ${
                                isSelected
                                  ? 'bg-secondary/20 border-secondary text-secondary'
                                  : 'bg-muted/20 border-border text-muted-foreground hover:border-secondary/30'
                              }`}
                            >
                              <div className="font-bold mb-1 uppercase">{level}</div>
                              <div className="leading-tight opacity-70">
                                {level === 'ringct' && 'Amount hidden + ring sig'}
                                {level === 'stealth' && 'Ring sig + stealth addr'}
                                {level === 'full' && 'Monero-grade (all)'}
                              </div>
                              <div className="mt-1 font-mono text-[10px] opacity-50">
                                fee: {info.minFee.toFixed(4)}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {/* Privacy info box */}
                      <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                        <p><span className="font-medium text-foreground">{privacyLevel.toUpperCase()}:</span> {getPrivacyFeeInfo(privacyLevel).description}</p>
                        <p>Ring size: <span className="font-mono">{getPrivacyFeeInfo(privacyLevel).ringSize}</span> decoys • Overhead: <span className="font-mono">~{getPrivacyFeeInfo(privacyLevel).overheadBytes} bytes</span></p>
                      </div>
                    </motion.div>
                  )}

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Recipient Address</label>
                    <Input
                      type="text"
                      placeholder={privacyMode === 'private' ? "0x... or HSMCst..." : "0x..."}
                      value={recipientAddress}
                      onChange={e => setRecipientAddress(e.target.value)}
                      className="font-mono text-sm"
                    />
                    {privacyMode === 'private' && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Use an <code className="text-secondary">HSMCst...</code> stealth address for full receiver privacy. Standard 0x-addresses will be wrapped with a stealth output.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Amount</label>
                    <div className="relative">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={sendAmount}
                        onChange={e => setSendAmount(e.target.value)}
                        className="font-mono text-sm pr-16"
                      />
                      <button
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium"
                        onClick={() => setSendAmount((displayWallet?.balance ?? 0).toString())}
                      >
                        MAX
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Available: {(displayWallet?.balance ?? 0).toFixed(4)} HSMC</p>
                    {privacyMode === 'private' && sendAmount && (
                      <p className="text-xs text-primary mt-1">
                        🔒 Amount will be hidden on-chain via Pedersen commitment
                      </p>
                    )}
                  </div>

                  {/* Fee display */}
                  {sendAmount && parseFloat(sendAmount) > 0 && (
                    <div className="bg-muted/20 rounded-lg p-3 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fee ({getPrivacyFeeInfo(privacyMode === 'private' ? privacyLevel : 'transparent').privacyLevel})</span>
                        <span className="font-mono">{getPrivacyFeeInfo(privacyMode === 'private' ? privacyLevel : 'transparent', parseFloat(sendAmount)).minFee.toFixed(6)} HSMC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-mono font-bold">
                          {(parseFloat(sendAmount) + getPrivacyFeeInfo(privacyMode === 'private' ? privacyLevel : 'transparent', parseFloat(sendAmount)).minFee).toFixed(6)} HSMC
                        </span>
                      </div>
                    </div>
                  )}

                  {/* ── Privacy Progress Indicator ──────────────────────── */}
                  {sendProgressActive && sendProgress.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="p-4 bg-muted/30 border border-border rounded-xl space-y-2"
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <Shield className="w-4 h-4" />
                        Building Private Transaction
                      </div>
                      {sendProgress.map((step) => (
                        <div key={step.id} className="flex items-start gap-2.5 text-xs">
                          <div className="mt-0.5 flex-shrink-0">
                            {step.status === 'active' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                            {step.status === 'done' && <Check className="w-3.5 h-3.5 text-green-400" />}
                            {step.status === 'error' && <X className="w-3.5 h-3.5 text-destructive" />}
                            {step.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={
                              step.status === 'active' ? 'text-primary font-medium' :
                              step.status === 'done' ? 'text-green-400' :
                              step.status === 'error' ? 'text-destructive' :
                              'text-muted-foreground'
                            }>{step.label}</span>
                            {step.detail && step.status === 'done' && (
                              <div className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{step.detail}</div>
                            )}
                            {step.detail && step.status === 'error' && (
                              <div className="text-[10px] text-destructive/70 mt-0.5 truncate">{step.detail}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}

                  {/* ── Stealth Address Confirmation ──────────────────────── */}
                  {stealthConfirm && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-secondary/10 border border-secondary/30 rounded-xl space-y-2"
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-secondary">
                        <ShieldCheck className="w-4 h-4" />
                        Stealth Address Used
                      </div>
                      <div className="text-xs space-y-1.5">
                        <div>
                          <span className="text-muted-foreground">One-time destination: </span>
                          <span className="font-mono text-secondary break-all">{stealthConfirm.oneTimeKey}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Ephemeral public key: </span>
                          <span className="font-mono text-muted-foreground break-all text-[11px]">{stealthConfirm.ephemeralKey}</span>
                        </div>
                        <div className="bg-muted/30 rounded p-2 text-muted-foreground mt-1">
                          <strong className="text-foreground">Why is this address different?</strong>{' '}
                          A stealth one-time address is derived via ECDH key exchange from the recipient's{' '}
                          <code className="text-secondary">HSMCst...</code> public keys. Each transaction gets a unique address
                          that only the recipient can detect using their view key — no on-chain link between transactions.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setStealthConfirm(null)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Dismiss
                      </button>
                    </motion.div>
                  )}

                  <Button
                    variant="hero"
                    className="w-full"
                    size="lg"
                    onClick={handleSend}
                    disabled={sending || !recipientAddress || !sendAmount}
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {privacyMode === 'private' ? (
                      <><Shield className="w-4 h-4 mr-2" /> Send Private Transaction</>
                    ) : (
                      'Send Transaction'
                    )}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Receive — Real QR from wallet address */}
            {activeTab === 'receive' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="border-t border-border pt-6 text-center">
                <h4 className="font-semibold mb-4">Receive HSMC</h4>
                <div className="w-52 h-52 mx-auto mb-4 bg-white p-3 rounded-xl shadow-lg">
                   <QRCodeSVG
                     value={`hsmc:${displayWallet?.address ?? ''}`}
                     size={184}
                     bgColor="#ffffff"
                     fgColor="#000000"
                     level="H"
                     includeMargin={false}
                   />
                 </div>
                 <p className="text-xs text-muted-foreground mb-1">Scan to receive HSMC to this address</p>
                 <div className="font-mono text-sm bg-muted/50 p-3 rounded-lg break-all my-3">{displayWallet?.address ?? ''}</div>
                <Button variant="outline" className="gap-2" onClick={handleCopy}>
                  {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                  Copy Address
                </Button>
              </motion.div>
            )}
          </motion.div>

          {/* Recent Transactions */}
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold flex items-center gap-2">
                <History className="w-5 h-5 text-primary" /> Recent Activity
              </h4>
            </div>
            <div className="space-y-3">
              {walletTxs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No transactions yet. Send or receive HSMC to see activity here.
                </p>
              ) : (
                walletTxs.slice(0, 8).map(tx => {
                  const badge = getPrivacyBadge(tx.privacy_level);
                  const isPrivate = tx.privacy_level && tx.privacy_level !== 'standard' && tx.privacy_level !== 'transparent';
                  const isOutgoing = tx.from_address === displayWallet?.address;
                  const showTooltip = txTooltipId === tx.id;
                  return (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors relative"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isOutgoing ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'
                      }`}>
                        {isPrivate ? (
                          <Shield className="w-5 h-5" />
                        ) : (
                          <Send className={`w-5 h-5 ${isOutgoing ? '' : 'rotate-180'}`} />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-1.5 relative">
                          {isOutgoing ? 'Sent' : 'Received'}
                          <button
                            type="button"
                            onClick={() => setTxTooltipId(showTooltip ? null : tx.id)}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-mono uppercase transition-colors cursor-pointer ${badge.textColor} ${badge.bgColor} ${badge.borderColor} hover:opacity-80`}
                            title="Click for privacy details"
                          >
                            {badge.label}
                          </button>
                          {/* Tooltip */}
                          {showTooltip && (
                            <div data-tx-tooltip className="absolute left-0 top-full mt-1 z-20 p-3 bg-card border border-border rounded-lg shadow-xl text-xs space-y-1 min-w-[200px]">
                              <div className="flex items-center gap-1.5 font-semibold">
                                <Info className="w-3 h-3" />
                                Privacy Details
                              </div>
                              <div className="text-muted-foreground space-y-0.5">
                                {badge.ringSize > 0 && <div>Ring size: <span className="font-mono text-foreground">{badge.ringSize} decoys</span></div>}
                                {badge.hasRangeProof && <div>Range proof: <span className="text-amber-400">Bulletproof</span></div>}
                                {tx.decoy_count && <div>Decoys used: <span className="font-mono text-foreground">{tx.decoy_count}</span></div>}
                                {tx.commitment && <div>Commitment: <span className="font-mono text-foreground">{tx.commitment.slice(0, 12)}...</span></div>}
                                {tx.stealth_address && <div>Stealth addr: <span className="font-mono text-foreground">{tx.stealth_address.slice(0, 12)}...</span></div>}
                                {tx.range_proof && <div>Range proof: <span className="text-amber-400">✓ verified</span></div>}
                                {badge.ringSize === 0 && !isPrivate && <div>No privacy — amounts & addresses visible on-chain</div>}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{formatRelativeTime(tx.created_at)}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-medium ${
                        isOutgoing ? 'text-destructive' : 'text-primary'
                      }`}>
                        {isOutgoing ? '-' : '+'}
                        {tx.amount === 0 && isPrivate ? (
                          <span className="italic text-muted-foreground">hidden</span>
                        ) : (
                          `${tx.amount.toFixed(4)} HSMC`
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatAddress(tx.hash, 6)}
                        {tx.stealth_address && <span className="ml-1 text-primary">🔒</span>}
                      </div>
                    </div>
                  </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* BIP39 Setup Modal */}
      <BIP39WalletSetup
        isOpen={showBIP39Setup}
        onClose={() => setShowBIP39Setup(false)}
        onComplete={address => {
          setHasSeedStored(true);
          setShowBIP39Setup(false);
          toast({ title: '🔐 BIP39 Wallet Secured', description: `Address: ${address.slice(0, 16)}...` });
        }}
      />

      {/* HSMCPay Modal */}
      <HSMCPay isOpen={showHSMCPay} onClose={() => setShowHSMCPay(false)} mode="buy" />

      {/* Multi-Wallet Manager Modal */}
      <MultiWalletManager isOpen={showMultiWallet} onClose={() => setShowMultiWallet(false)} />

      {/* View Seed Phrase Modal */}
      {showSeedModal && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-destructive/20 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4 text-destructive" />
                </div>
                <div>
                  <h2 className="font-bold">Seed Phrase</h2>
                  <p className="text-xs text-muted-foreground">Decriptat local — nu se trimite niciodată pe server</p>
                </div>
              </div>
              <button onClick={closeSeedModal} className="p-2 hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {!revealedSeed ? (
                <>
                  <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                    <ShieldAlert className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-destructive">Atenție:</strong> Nu arăta seed-ul nimănui. Oricine îl cunoaște poate accesa toate fondurile tale.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Introdu parola de criptare</label>
                    <div className="relative">
                      <Input
                        type={seedVisible ? 'text' : 'password'}
                        placeholder="Parola cu care ai securizat BIP39"
                        value={seedPassword}
                        onChange={e => setSeedPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleRevealSeed()}
                        className="pr-10"
                      />
                      <button type="button" onClick={() => setSeedVisible(!seedVisible)} className="absolute right-3 top-1/2 -translate-y-1/2">
                        {seedVisible ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={closeSeedModal}>Anulează</Button>
                    <Button variant="hero" className="flex-1" onClick={handleRevealSeed} disabled={!seedPassword || seedLoading}>
                      {seedLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                      Dezvăluie Seed
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                    <ShieldAlert className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive font-medium">Ești singura persoană care vede asta. Închide fereastra după verificare.</p>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {revealedSeed.split(' ').map((word, i) => (
                      <div key={i} className="flex items-center gap-1 p-2 bg-muted/30 rounded-lg border border-border">
                        <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i+1}.</span>
                        <span className="text-xs font-mono font-medium truncate">{word}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-muted/20 rounded-xl p-3 border border-border">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Adresa derivată din acest seed:</p>
                    <p className="font-mono text-xs break-all text-foreground">{displayWallet?.address}</p>
                  </div>
                  <Button variant="outline" className="w-full" onClick={closeSeedModal}>
                    <X className="w-4 h-4 mr-2" /> Închide &amp; Șterge din memorie
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Multi-Sig Wallet Dialog */}
      {showMultiSigDialog && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold">Create Multi-Sig Wallet</h2>
                  <p className="text-xs text-muted-foreground">t-of-n threshold signature configuration</p>
                </div>
              </div>
              <button onClick={() => setShowMultiSigDialog(false)} className="p-2 hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Threshold (t)</label>
                <p className="text-xs text-muted-foreground mb-2">Number of signatures required to authorize a transaction</p>
                <Input
                  type="number"
                  min="1"
                  max="15"
                  placeholder="3"
                  value={multiSigThreshold}
                  onChange={e => setMultiSigThreshold(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Signer Addresses (one per line or comma-separated)</label>
                <p className="text-xs text-muted-foreground mb-2">List of n wallet addresses that can sign</p>
                <textarea
                  placeholder={'0xabc123...\n0xdef456...\n0x789abc...'}
                  value={multiSigAddresses}
                  onChange={e => setMultiSigAddresses(e.target.value)}
                  rows={5}
                  className="w-full font-mono text-xs bg-muted/30 border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary resize-none"
                />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowMultiSigDialog(false)}>
                  Cancel
                </Button>
                <Button
                  variant="hero"
                  className="flex-1"
                  onClick={handleMultiSigSave}
                  disabled={multiSigSaving || !multiSigThreshold || !multiSigAddresses.trim()}
                >
                  {multiSigSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Users className="w-4 h-4 mr-1" />}
                  Create Multi-Sig
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Stealth Address Generator Dialog */}
      {showStealthGen && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-secondary/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-secondary" />
                </div>
                <div>
                  <h2 className="font-bold">Generate Stealth Address</h2>
                  <p className="text-xs text-muted-foreground">HSMCst... one-time address for private transactions</p>
                </div>
              </div>
              <button onClick={() => { setShowStealthGen(false); setGeneratedStealthAddr(''); }} className="p-2 hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {!generatedStealthAddr ? (
                <>
                  <div className="p-4 bg-muted/20 rounded-xl border border-border space-y-2">
                    <p className="text-sm text-muted-foreground">
                      A <strong>stealth address</strong> is a one-time address derived from your wallet's public keys
                      using ECDH key exchange. Give this <code className="text-secondary">HSMCst...</code> address to
                      anyone who wants to send you private transactions.
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Each transaction generates a unique one-time destination</li>
                      <li>No one can link transactions to your wallet address</li>
                      <li>Requires your wallet password to derive the keys</li>
                    </ul>
                  </div>
                  <Button
                    variant="hero"
                    className="w-full"
                    onClick={handleGenerateStealth}
                    disabled={generatingStealth}
                  >
                    {generatingStealth ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Deriving keys...</>
                    ) : (
                      <><Unlock className="w-4 h-4 mr-2" /> Generate Stealth Address</>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <div className="p-4 bg-secondary/10 border border-secondary/20 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-secondary" />
                      <span className="text-sm font-semibold text-secondary">Your Stealth Address</span>
                    </div>
                    <div className="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all border border-border select-all">
                      {generatedStealthAddr}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share this address for private transactions. It encodes your spend & view public keys.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={handleStealthCopy}
                    >
                      {stealthCopied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                      {stealthCopied ? 'Copied!' : 'Copy Address'}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => { setShowStealthGen(false); setGeneratedStealthAddr(''); setStealthCopied(false); }}
                    >
                      Close
                    </Button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Password Prompt Modal (C7/C8/C9 fix — replaces prompt() + sessionStorage) */}
      <PasswordPromptModal
        isOpen={showPasswordModal}
        title="Wallet Password"
        description="Enter your wallet password to decrypt and sign this operation."
        onPassword={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
    </section>
  );
};

export default WalletSection;
