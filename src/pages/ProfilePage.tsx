/**
 * Profile Page — /app/profile
 * Avatar upload, username/email, password change, activity, security, 2FA
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  User, Mail, Lock, Shield, Activity, Camera, Save, Loader2,
  Eye, EyeOff, ArrowLeft, CheckCircle2, AlertTriangle, LogOut,
  Wallet, TrendingUp, ArrowUpRight, ArrowDownLeft, RefreshCw, Key,
  Download, Gift, LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { registerBiometric, isBiometricAvailable, hasBiometricRegistered } from '@/utils/bip39-wallet';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import TwoFactorSetup from '@/components/TwoFactorSetup';
import SeedPhraseRecovery from '@/components/SeedPhraseRecovery';
import ReferralPanel from '@/components/ReferralPanel';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
}

interface WalletData {
  balance: number;
  staked_balance: number;
  address: string;
}

interface TxRow {
  id: string;
  hash: string;
  from_address: string;
  to_address: string;
  amount: number;
  status: string;
  created_at: string;
  privacy_level: string | null;
}

interface SwapRow {
  id: string;
  from_token: string;
  to_token: string;
  from_amount: number;
  to_amount: number;
  status: string;
  created_at: string;
}

type TabId = 'profile' | 'security' | 'activity' | 'referral';

export const ProfilePage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('profile');

  // Profile form
  const [username, setUsername] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Email change
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Password change
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      setLoading(true);

      // Fetch profile and primary wallet first
      const [{ data: prof }, { data: wal }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('wallets').select('balance, staked_balance, address').eq('user_id', user.id).order('is_primary', { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (prof) {
        setProfile(prof as Profile);
        setUsername(prof.username ?? '');
      }
      if (wal) setWallet(wal as WalletData);

      // Transactions are keyed by wallet address, NOT user_id
      // Fetch all user wallets' addresses, then query transactions by address
      const { data: allWallets } = await supabase
        .from('wallets')
        .select('address')
        .eq('user_id', user.id);

      const addresses = (allWallets ?? []).map(w => w.address);

      if (addresses.length > 0) {
        const orFilter = addresses
          .flatMap(addr => [`from_address.eq.${addr}`, `to_address.eq.${addr}`])
          .join(',');
        const { data: addrTxs } = await supabase
          .from('transactions')
          .select('id, hash, from_address, to_address, amount, status, created_at, privacy_level')
          .or(orFilter)
          .order('created_at', { ascending: false })
          .limit(30);
        if (addrTxs) setTransactions(addrTxs as TxRow[]);
      }

      // Swaps are keyed by user_id — correct
      const { data: sws } = await supabase
        .from('token_swaps')
        .select('id, from_token, to_token, from_amount, to_amount, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (sws) setSwaps(sws as SwapRow[]);

      setLoading(false);
    };
    fetchAll();
  }, [user]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 2MB', variant: 'destructive' });
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `avatars/${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('wallet-backups')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('wallet-backups').getPublicUrl(path);
      const avatarUrl = urlData.publicUrl;

      await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('user_id', user.id);
      setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
      toast({ title: '✅ Avatar updated!' });
    } catch (err: unknown) {
      toast({ title: 'Upload failed', description: String(err), variant: 'destructive' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase.from('profiles')
      .update({ username: username.trim() || null })
      .eq('user_id', user.id);
    setSavingProfile(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Profile saved!' });
    }
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || newEmail === user?.email) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSavingEmail(false);
    if (error) {
      toast({ title: 'Email change failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Confirmation email sent', description: 'Check your new email address to confirm the change.' });
      setNewEmail('');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Min 8 chars', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast({ title: 'Password change failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Password updated!' });
      setOldPassword(''); setNewPassword(''); setConfirmNewPassword('');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const exportTransactionsCSV = () => {
    if (transactions.length === 0) {
      toast({ title: 'No transactions to export' });
      return;
    }
    const headers = ['Hash', 'From', 'To', 'Amount (HSMC)', 'Status', 'Privacy Level', 'Date'];
    const rows = transactions.map(tx => [
      tx.hash,
      tx.from_address,
      tx.to_address,
      tx.amount.toFixed(8),
      tx.status,
      tx.privacy_level ?? 'standard',
      new Date(tx.created_at).toISOString(),
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hsmc-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '✅ CSV exported!', description: `${transactions.length} transactions downloaded.` });
  };

  const exportSwapsCSV = () => {
    if (swaps.length === 0) {
      toast({ title: 'No swaps to export' });
      return;
    }
    const headers = ['From Token', 'To Token', 'From Amount', 'To Amount', 'Status', 'Date'];
    const rows = swaps.map(sw => [
      sw.from_token,
      sw.to_token,
      sw.from_amount.toFixed(8),
      sw.to_amount.toFixed(8),
      sw.status,
      new Date(sw.created_at).toISOString(),
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hsmc-swaps-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '✅ Swaps CSV exported!', description: `${swaps.length} swaps downloaded.` });
  };

  if (!user) return null;

  const tabs: { id: TabId; label: string; icon: typeof User }[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'referral', label: 'Referral', icon: Gift },
  ];

  const avatarFallback = (profile?.username ?? user.email ?? '?')[0].toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16 max-w-3xl">
        {/* Back */}
        <div className="flex items-center gap-3 mb-6">
          <a href="/app" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </a>
          <a
            href="/app"
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
          >
            <LayoutDashboard className="w-4 h-4" />
            Open Platform
          </a>
        </div>

        {/* Avatar + name hero */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-panel mb-6">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="flex items-center gap-5 flex-wrap">
              {/* Avatar */}
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/20 to-secondary/20 border-2 border-border flex items-center justify-center">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-primary">{avatarFallback}</span>
                  )}
                </div>
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/80 transition-colors shadow-md"
                >
                  {uploadingAvatar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
              </div>

              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-black truncate">
                  {profile?.username ?? user.email?.split('@')[0] ?? 'User'}
                </h1>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                {wallet && (
                  <p className="text-xs font-mono text-muted-foreground/60 truncate mt-0.5">
                    {wallet.address?.slice(0, 16)}...
                  </p>
                )}
              </div>

              {/* Wallet summary */}
              {wallet && (
                <div className="flex gap-4 ml-auto">
                  <div className="text-right">
                    <div className="text-lg font-black font-mono text-primary">{wallet.balance.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">HSMC Balance</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black font-mono text-secondary">{wallet.staked_balance.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Staked</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-muted/20 p-1 mb-6">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg transition-all ${
                tab === t.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Profile Tab ── */}
        {tab === 'profile' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="glass-panel space-y-4">
              <h2 className="font-bold flex items-center gap-2"><User className="w-4 h-4 text-primary" />Profile Info</h2>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Username</label>
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="satoshi"
                  maxLength={32}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Shown in the navbar and dashboard</p>
              </div>
              <Button variant="hero" onClick={handleSaveProfile} disabled={savingProfile} className="w-full sm:w-auto">
                {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </div>

            <div className="glass-panel space-y-4">
              <h2 className="font-bold flex items-center gap-2"><Mail className="w-4 h-4 text-primary" />Change Email</h2>
              <p className="text-xs text-muted-foreground">
                Current: <strong className="text-foreground">{user.email}</strong>
              </p>
              <form onSubmit={handleChangeEmail} className="flex gap-3">
                <Input
                  type="email"
                  placeholder="new@email.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  required
                  className="flex-1"
                />
                <Button type="submit" variant="outline" disabled={savingEmail || !newEmail || newEmail === user.email}>
                  {savingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
                </Button>
              </form>
              <p className="text-[10px] text-muted-foreground">A confirmation will be sent to your new email address.</p>
            </div>
          </motion.div>
        )}

        {/* ── Security Tab ── */}
        {tab === 'security' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="glass-panel space-y-4">
              <h2 className="font-bold flex items-center gap-2"><Lock className="w-4 h-4 text-primary" />Change Password</h2>
              <p className="text-xs text-muted-foreground">
                Introdu noua parolă — vei fi deconectat de pe alte sesiuni după confirmare.
              </p>
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="relative">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    placeholder="Parolă nouă (min 8 caractere)"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { ok: newPassword.length >= 8, label: '8+ chars' },
                    { ok: /[A-Z]/.test(newPassword), label: 'Uppercase' },
                    { ok: /[0-9!@#$%^&*]/.test(newPassword), label: 'Number/Symbol' },
                    { ok: newPassword === confirmNewPassword && newPassword.length > 0, label: 'Match' },
                  ].map(r => (
                    <span key={r.label} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${r.ok ? 'border-secondary/40 text-secondary bg-secondary/10' : 'border-border text-muted-foreground'}`}>
                      {r.ok ? '✓ ' : ''}{r.label}
                    </span>
                  ))}
                </div>
                <Input
                  type={showPw ? 'text' : 'password'}
                  placeholder="Confirmă parola nouă"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                {confirmNewPassword && newPassword !== confirmNewPassword && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Parolele nu coincid
                  </p>
                )}
                <Button
                  type="submit"
                  variant="hero"
                  disabled={savingPassword || newPassword.length < 8 || newPassword !== confirmNewPassword}
                  className="w-full"
                >
                  {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Actualizează Parola
                </Button>
              </form>
            </div>

            {/* 2FA TOTP */}
            <div className="glass-panel space-y-2">
              <h2 className="font-bold flex items-center gap-2"><Shield className="w-4 h-4 text-primary" />Two-Factor Authentication (2FA)</h2>
              <TwoFactorSetup />
            </div>

            {/* Seed Phrase Recovery */}
            <div className="glass-panel space-y-3">
              <h2 className="font-bold flex items-center gap-2"><Key className="w-4 h-4 text-primary" />Seed Phrase Recovery</h2>
              <p className="text-xs text-muted-foreground">
                Reveal your 25-word recovery phrase after password verification and a backup confirmation quiz.
              </p>
              <SeedPhraseRecovery />
            </div>

            <div className="glass-panel space-y-3">
              <h2 className="font-bold flex items-center gap-2"><Key className="w-4 h-4 text-primary" />Wallet Security</h2>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30">
                <div>
                  <p className="text-sm font-medium">Encrypted Seed</p>
                  <p className="text-xs text-muted-foreground">AES-256-GCM · stocat local + cloud backup</p>
                </div>
                <CheckCircle2 className="w-5 h-5 text-secondary" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30">
                <div>
                  <p className="text-sm font-medium">Biometric Auth</p>
                  <p className="text-xs text-muted-foreground">
                    {user && hasBiometricRegistered(user.id)
                      ? 'Enrolled — Face ID / Fingerprint / Windows Hello'
                      : 'Face ID / Fingerprint / Windows Hello'}
                  </p>
                </div>
                {user && hasBiometricRegistered(user.id) ? (
                  <CheckCircle2 className="w-5 h-5 text-secondary" />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={async () => {
                      if (!user) return;
                      const available = await isBiometricAvailable();
                      if (!available) {
                        toast({
                          title: 'Biometric not available',
                          description: 'This device/browser does not support WebAuthn (Face ID / Fingerprint / Windows Hello).',
                          variant: 'destructive',
                        });
                        return;
                      }
                      const res = await registerBiometric(user.id);
                      toast({
                        title: res.ok ? 'Biometric enrolled' : 'Enrollment failed',
                        description: res.ok
                          ? 'You can now unlock your wallet with biometrics.'
                          : (res.error || 'The biometric registration was cancelled or failed.'),
                        variant: res.ok ? 'default' : 'destructive',
                      });
                      if (res.ok) setProfile((p) => p && { ...p });
                    }}
                  >
                    Configure
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30">
                <div>
                  <p className="text-sm font-medium">Session Security</p>
                  <p className="text-xs text-muted-foreground">JWT auto-refresh · token invalidation la logout</p>
                </div>
                <CheckCircle2 className="w-5 h-5 text-secondary" />
              </div>
            </div>

            <div className="glass-panel">
              <h2 className="font-bold flex items-center gap-2 mb-4"><AlertTriangle className="w-4 h-4 text-destructive" />Danger Zone</h2>
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={handleSignOut}
              >
                <LogOut className="w-4 h-4" />
                Sign Out from All Devices
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── Referral Tab ── */}
        {tab === 'referral' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="glass-panel">
              <h2 className="font-bold flex items-center gap-2 mb-4">
                <Gift className="w-4 h-4 text-primary" />Referral Program
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Invite friends to HSMC. Both you and your referred friend receive{' '}
                <strong className="text-secondary">50 HSMC</strong> when they sign up and create a wallet.
              </p>
              <ReferralPanel />
            </div>
          </motion.div>
        )}

        {/* ── Activity Tab ── */}
        {tab === 'activity' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* Transactions */}
            <div className="glass-panel">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" />Recent Transactions</h2>
                {transactions.length > 0 && (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={exportTransactionsCSV}>
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </Button>
                )}
              </div>
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No transactions yet</p>
              ) : (
                <div className="space-y-2">
                  {transactions.map(tx => {
                    const isOut = wallet && tx.from_address === wallet.address;
                    return (
                      <div key={tx.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/30 hover:border-border/60 transition-colors">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isOut ? 'bg-destructive/10' : 'bg-secondary/10'}`}>
                          {isOut
                            ? <ArrowUpRight className="w-4 h-4 text-destructive" />
                            : <ArrowDownLeft className="w-4 h-4 text-secondary" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono truncate text-muted-foreground">
                            {isOut ? `To: ${tx.to_address.slice(0, 14)}...` : `From: ${tx.from_address.slice(0, 14)}...`}
                          </p>
                          <p className="text-[10px] text-muted-foreground/50">
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`font-bold text-sm font-mono ${isOut ? 'text-destructive' : 'text-secondary'}`}>
                            {isOut ? '-' : '+'}{tx.amount.toFixed(4)} HSMC
                          </p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            tx.status === 'confirmed' ? 'bg-secondary/10 text-secondary' : 'bg-muted text-muted-foreground'
                          }`}>
                            {tx.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Swaps */}
            <div className="glass-panel">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" />Recent Swaps</h2>
                {swaps.length > 0 && (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={exportSwapsCSV}>
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </Button>
                )}
              </div>
              {swaps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No swaps yet</p>
              ) : (
                <div className="space-y-2">
                  {swaps.map(sw => (
                    <div key={sw.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/30">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <RefreshCw className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {sw.from_token} → {sw.to_token}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(sw.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm">
                          <span className="text-destructive">{sw.from_amount.toFixed(2)}</span>
                          <span className="text-muted-foreground mx-1">→</span>
                          <span className="text-secondary">{sw.to_amount.toFixed(2)}</span>
                        </p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          sw.status === 'completed' ? 'bg-secondary/10 text-secondary' : 'bg-muted text-muted-foreground'
                        }`}>
                          {sw.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stats */}
            {wallet && (
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-panel text-center">
                  <TrendingUp className="w-6 h-6 text-secondary mx-auto mb-2" />
                  <div className="text-xl font-black font-mono text-secondary">{wallet.balance.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Available HSMC</div>
                </div>
                <div className="glass-panel text-center">
                  <Wallet className="w-6 h-6 text-primary mx-auto mb-2" />
                  <div className="text-xl font-black font-mono text-primary">{wallet.staked_balance.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Staked HSMC</div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;
