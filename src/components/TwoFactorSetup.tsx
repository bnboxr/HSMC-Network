/**
 * 2FA Setup — TOTP (Google Authenticator) + WebAuthn biometrics
 * Uses otpauth lib (RFC 6238) + qrcode for QR generation
 * and WebAuthn API for fingerprint / Face ID / Windows Hello
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ShieldCheck, ShieldOff, QrCode, Copy, Check, RefreshCw, Loader2, Key, X, Eye, EyeOff, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { registerBiometric, hasBiometricRegistered, isBiometricAvailable, authenticateBiometric } from '@/utils/bip39-wallet';

interface TwoFactorSetupProps {
  onClose?: () => void;
}

const generateSecret = () => {
  const totp = new OTPAuth.TOTP({
    issuer: 'HSMC',
    label: 'HSMC',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.secret.base32;
};

const generateBackupCodes = (): string[] => {
  const codes: string[] = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 8; i++) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    const part1 = Array.from(bytes.slice(0, 5)).map(b => chars[b % chars.length]).join('');
    const part2 = Array.from(bytes.slice(5, 10)).map(b => chars[b % chars.length]).join('');
    codes.push(`${part1}-${part2}`);
  }
  return codes;
};

const verifyTOTP = (secret: string, code: string): boolean => {
  try {
    const totp = new OTPAuth.TOTP({
      issuer: 'HSMC',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
};

export const TwoFactorSetup = ({ onClose }: TwoFactorSetupProps) => {
  const { user } = useAuth();
  const [step, setStep] = useState<'loading' | 'disabled' | 'setup' | 'verify' | 'backup' | 'enabled'>('loading');
  const [secret, setSecret] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioRegistered, setBioRegistered] = useState(false);
  const [bioRegistering, setBioRegistering] = useState(false);
  const [bioVerifying, setBioVerifying] = useState(false);

  useEffect(() => {
    if (!user) return;
    const checkStatus = async () => {
      const { data } = await supabase
        .from('totp_secrets')
        .select('enabled, secret')
        .eq('user_id', user.id)
        .maybeSingle();
      setStep(data?.enabled ? 'enabled' : 'disabled');
      // Check WebAuthn biometric status
      const avail = await isBiometricAvailable();
      setBioAvailable(avail);
      setBioRegistered(hasBiometricRegistered(user.id));
    };
    checkStatus();
  }, [user]);

  const startSetup = useCallback(async () => {
    if (!user) return;
    const newSecret = generateSecret();
    setSecret(newSecret);

    const totp = new OTPAuth.TOTP({
      issuer: 'HSMC',
      label: user.email || 'user',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(newSecret),
    });
    const otpUri = totp.toString();

    try {
      const dataUrl = await QRCode.toDataURL(otpUri, { width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
      setQrUrl(dataUrl);
    } catch (e) {
      console.error('QR gen error', e);
    }

    setStep('setup');
  }, [user]);

  const handleVerify = async () => {
    if (!verifyCode || verifyCode.length !== 6) return;
    setVerifying(true);
    const valid = verifyTOTP(secret, verifyCode);
    setVerifying(false);
    if (!valid) {
      toast({ title: 'Invalid code', description: 'The code is wrong or expired. Try again.', variant: 'destructive' });
      setVerifyCode('');
      return;
    }
    const codes = generateBackupCodes();
    setBackupCodes(codes);
    setStep('backup');
  };

  const handleEnable = async () => {
    if (!user || !secret || backupCodes.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from('totp_secrets')
      .upsert({ user_id: user.id, secret, backup_codes: backupCodes, enabled: true }, { onConflict: 'user_id' });
    setSaving(false);
    if (error) {
      toast({ title: 'Failed to enable 2FA', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '🔐 2FA Enabled!', description: 'Two-factor authentication is now active.' });
      setStep('enabled');
    }
  };

  const handleDisable = async () => {
    if (!user) return;
    setDisabling(true);
    const { error } = await supabase
      .from('totp_secrets')
      .update({ enabled: false })
      .eq('user_id', user.id);
    setDisabling(false);
    if (error) {
      toast({ title: 'Failed to disable 2FA', variant: 'destructive' });
    } else {
      toast({ title: '2FA Disabled', description: 'Two-factor authentication has been turned off.' });
      setStep('disabled');
    }
  };

  const handleRegisterBiometric = async () => {
    if (!user) return;
    setBioRegistering(true);
    const result = await registerBiometric(user.id);
    setBioRegistering(false);
    if (result.ok) {
      setBioRegistered(true);
      toast({ title: '🔐 Biometric Registered', description: 'Fingerprint / Face ID is now configured for this device.' });
    } else {
      toast({ title: 'Biometric registration failed', description: result.error || 'Unknown error', variant: 'destructive' });
    }
  };

  const handleVerifyBiometric = async () => {
    if (!user) return;
    setBioVerifying(true);
    const ok = await authenticateBiometric(user.id);
    setBioVerifying(false);
    if (ok) {
      toast({ title: '✅ Biometric Verified', description: 'Your identity was confirmed via biometrics.' });
    } else {
      toast({ title: 'Biometric verification failed', description: 'Unable to verify. Try again or use TOTP.', variant: 'destructive' });
    }
  };

  const copyToClipboard = (text: string, type: 'secret' | 'backup') => {
    navigator.clipboard.writeText(text);
    if (type === 'secret') { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
    else { setCopiedBackup(true); setTimeout(() => setCopiedBackup(false), 2000); }
  };

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${step === 'enabled' ? 'bg-secondary/10 border-secondary/30' : 'bg-muted/20 border-border/30'}`}>
        {step === 'enabled'
          ? <ShieldCheck className="w-5 h-5 text-secondary" />
          : <ShieldOff className="w-5 h-5 text-muted-foreground" />
        }
        <div>
          <p className="text-sm font-semibold">
            {step === 'enabled' ? '2FA is Active' : '2FA is Disabled'}
          </p>
          <p className="text-xs text-muted-foreground">
            {step === 'enabled'
              ? 'Your account is protected with Google Authenticator'
              : 'Enable TOTP for extra account security'
            }
          </p>
        </div>
        <div className="ml-auto">
          {step === 'enabled' ? (
            <Button variant="outline" size="sm" onClick={handleDisable} disabled={disabling} className="text-destructive border-destructive/30 hover:bg-destructive/10 text-xs">
              {disabling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
              Disable
            </Button>
          ) : step === 'disabled' ? (
            <Button variant="hero" size="sm" onClick={startSetup} className="text-xs">
              <Shield className="w-3.5 h-3.5" />
              Enable 2FA
            </Button>
          ) : null}
        </div>
      </div>

      {/* Setup Step: Show QR */}
      <AnimatePresence mode="wait">
        {step === 'setup' && (
          <motion.div key="setup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                1. Install <strong className="text-foreground">Google Authenticator</strong> or <strong className="text-foreground">Authy</strong>
              </p>
              <p className="text-sm text-muted-foreground">2. Scan the QR code below</p>
              {qrUrl ? (
                <div className="flex justify-center">
                  <div className="p-3 bg-white rounded-xl shadow-lg border border-border/20">
                    <img src={qrUrl} alt="TOTP QR Code" className="w-44 h-44" />
                  </div>
                </div>
              ) : (
                <div className="w-44 h-44 mx-auto bg-muted animate-pulse rounded-xl" />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">Or enter this secret manually:</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 font-mono text-xs bg-muted/40 border border-border/30 rounded-lg px-3 py-2 overflow-hidden">
                  {showSecret ? secret : secret.replace(/./g, '●')}
                </div>
                <button onClick={() => setShowSecret(!showSecret)} className="p-2 hover:bg-muted rounded-lg transition-colors">
                  {showSecret ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                </button>
                <button onClick={() => copyToClipboard(secret, 'secret')} className="p-2 hover:bg-muted rounded-lg transition-colors">
                  {copiedSecret ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            </div>

            <Button variant="hero" className="w-full" onClick={() => setStep('verify')}>
              Next: Verify Code
            </Button>
          </motion.div>
        )}

        {step === 'verify' && (
          <motion.div key="verify" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="text-center space-y-2">
              <QrCode className="w-8 h-8 text-primary mx-auto" />
              <p className="text-sm font-semibold">Verify Setup</p>
              <p className="text-xs text-muted-foreground">Enter the 6-digit code from your authenticator app to confirm setup</p>
            </div>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center font-mono text-xl tracking-[0.5em] h-14"
              autoFocus
            />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep('setup')}>Back</Button>
              <Button variant="hero" className="flex-1" onClick={handleVerify} disabled={verifyCode.length !== 6 || verifying}>
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 'backup' && (
          <motion.div key="backup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="text-center space-y-1">
              <Key className="w-8 h-8 text-secondary mx-auto" />
              <p className="text-sm font-semibold">Save Backup Codes</p>
              <p className="text-xs text-muted-foreground">Store these in a safe place — each code can be used once if you lose your phone</p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 bg-muted/20 border border-border/30 rounded-xl">
              {backupCodes.map((code, i) => (
                <span key={i} className="font-mono text-xs text-center py-1.5 px-2 bg-background/50 rounded border border-border/20">{code}</span>
              ))}
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => copyToClipboard(backupCodes.join('\n'), 'backup')}>
              {copiedBackup ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4" />}
              {copiedBackup ? 'Copied!' : 'Copy all codes'}
            </Button>
            <Button variant="hero" className="w-full" onClick={handleEnable} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              I've saved my codes — Enable 2FA
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── WebAuthn / Biometric Section ─────────────────────────────── */}
      {bioAvailable && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Biometric Authentication</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Use Touch ID, Face ID, Windows Hello, or Android biometrics as an additional security layer.
          </p>
          <div className="flex gap-2">
            {!bioRegistered ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleRegisterBiometric}
                disabled={bioRegistering}
              >
                {bioRegistering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fingerprint className="w-3.5 h-3.5" />}
                Register Biometric
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/10 border border-secondary/20 text-xs text-secondary">
                  <ShieldCheck className="w-3 h-3" /> Biometric Active
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleVerifyBiometric}
                  disabled={bioVerifying}
                >
                  {bioVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fingerprint className="w-3.5 h-3.5" />}
                  Verify
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Wrapped with forwardRef to prevent React ref warning when used inside motion.div
import React from 'react';
const TwoFactorSetupForwarded = React.forwardRef<HTMLDivElement, TwoFactorSetupProps>((props, _ref) => <TwoFactorSetup {...props} />);
TwoFactorSetupForwarded.displayName = 'TwoFactorSetup';
export default TwoFactorSetupForwarded;
