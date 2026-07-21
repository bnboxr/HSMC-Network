/**
 * Settings Hub — single source of truth for all integrations.
 * Loads schema + status from settings-status edge function, groups by category,
 * shows which features are enabled/disabled based on filled keys.
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Save, Loader2, Eye, EyeOff, Shield, Server, CreditCard,
  Settings2, CheckCircle2, AlertCircle, Trash2, ExternalLink, Zap,
  Network, Bell, Layers, Coins, Wifi, WifiOff, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import HSMCPayAdminToggle from '@/components/HSMCPayAdminToggle';

interface SchemaRow {
  key: string;
  category: string;
  label: string;
  description: string;
  is_secret: boolean;
  required_for: string[];
  example_value: string | null;
  validation_regex: string | null;
  display_order: number;
  has_value: boolean;
  updated_at: string | null;
  current_value: string | null;
}
interface FeatureRow { feature: string; enabled: boolean; missing_keys: string[] }

const CATEGORY_META: Record<string, { label: string; icon: any; desc: string }> = {
  payment:       { label: 'Payments',     icon: CreditCard, desc: 'Stripe keys for real-money liquidity & checkout' },
  node:          { label: 'Rust Node',    icon: Server,     desc: 'Connect your blockchain node for live data' },
  bridge:        { label: 'Bridges',      icon: Layers,     desc: 'BSC / ETH / Polygon RPC + relayer keys' },
  dex:           { label: 'DEX Oracle',   icon: Coins,      desc: 'On-chain DEX pool addresses for price reads' },
  mining:        { label: 'Mining',       icon: Zap,        desc: 'Stratum V2 pool URL + worker name' },
  notifications: { label: 'Push',         icon: Bell,       desc: 'VAPID keys for browser push notifications' },
};

const SettingsPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [schema, setSchema] = useState<SchemaRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('node');
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; latency_ms: number; error?: string }>>({});
  const [generatingVapid, setGeneratingVapid] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/onboarding', { replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => { if (user) loadStatus(); }, [user]);

  const loadStatus = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('settings-status');
    if (error) {
      toast({ title: 'Failed to load settings', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    setSchema(data?.schema ?? []);
    setFeatures(data?.features ?? []);
    setLoading(false);
  };

  const grouped = useMemo(() => {
    const g: Record<string, SchemaRow[]> = {};
    for (const row of schema) {
      (g[row.category] ??= []).push(row);
    }
    return g;
  }, [schema]);

  const categoryHealth = (cat: string) => {
    const rows = grouped[cat] ?? [];
    const filled = rows.filter(r => r.has_value).length;
    return { filled, total: rows.length };
  };

  const toggleVisible = (key: string) =>
    setVisible(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const saveSetting = async (row: SchemaRow) => {
    if (!user) return;
    const value = edits[row.key] ?? row.current_value ?? '';
    if (row.validation_regex && value && !new RegExp(row.validation_regex).test(value)) {
      toast({ title: 'Invalid format', description: `Value does not match expected pattern`, variant: 'destructive' });
      return;
    }
    setSaving(row.key);

    // Special path: rust_node_url auto-derives stratum_url so a single VPS IP
    // unlocks blockchain + mining + tx_broadcast + mining_pool together.
    if (row.key === 'rust_node_url') {
      const { error } = await supabase.functions.invoke('auto-fill-settings', {
        body: { rust_node_url: value },
      });
      setSaving(null);
      if (error) {
        toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
        return;
      }
      toast({
        title: '✅ VPS connected',
        description: 'rust_node_url + stratum_url saved. Mining, tx broadcast and blockchain are now active.',
      });
      setEdits(prev => { const n = { ...prev }; delete n[row.key]; return n; });
      await loadStatus();
      return;
    }

    const { error } = await supabase.from('user_settings').upsert(
      { user_id: user.id, setting_key: row.key, setting_value: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,setting_key' }
    );
    setSaving(null);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '✅ Saved', description: row.label });
    setEdits(prev => { const n = { ...prev }; delete n[row.key]; return n; });
    await loadStatus();
  };

  const deleteSetting = async (row: SchemaRow) => {
    if (!user) return;
    await supabase.from('user_settings').delete().eq('user_id', user.id).eq('setting_key', row.key);
    toast({ title: '🗑️ Removed', description: row.label });
    await loadStatus();
  };

  // Test a URL value (rust_node_url, stratum_url, *_rpc_url, bridge_address)
  const testConnection = async (row: SchemaRow) => {
    const url = (edits[row.key] ?? row.current_value ?? '').trim();
    if (!url) {
      toast({ title: 'Nothing to test', description: 'Type or save a URL first', variant: 'destructive' });
      return;
    }
    setTesting(row.key);
    const { data, error } = await supabase.functions.invoke('test-connection', { body: { url } });
    setTesting(null);
    if (error || !data) {
      setTestResult(p => ({ ...p, [row.key]: { ok: false, latency_ms: 0, error: error?.message ?? 'failed' } }));
      return;
    }
    setTestResult(p => ({ ...p, [row.key]: data }));
    toast({
      title: data.ok ? `✅ Online (${data.latency_ms}ms)` : '❌ Unreachable',
      description: data.ok ? row.label : (data.error ?? `status ${data.status}`),
      variant: data.ok ? 'default' : 'destructive',
    });
  };

  // Server-side VAPID generation — fills both vapid_public_key and vapid_private_key
  const generateVapid = async () => {
    setGeneratingVapid(true);
    const { data, error } = await supabase.functions.invoke('vapid-generate');
    setGeneratingVapid(false);
    if (error) {
      toast({ title: 'VAPID generation failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: '🔑 VAPID keys generated',
      description: 'Public + private key saved. Push notifications are now enabled.',
    });
    await loadStatus();
  };

  // URL-like keys get the Test button
  const isUrlKey = (key: string) =>
    key === 'rust_node_url' || key === 'stratum_url' || key.endsWith('_rpc_url');

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-12 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings2 className="h-6 w-6 text-primary" />
              Settings Hub
            </h1>
            <p className="text-muted-foreground text-sm">
              The single point of activation for every paid integration in your workspace.
              Nothing happens server-side until you fill in the matching keys here.
            </p>
          </div>
        </div>

        {/* HSMCPay Intermediary Toggle — admin controls the global buy/sell processor path */}
        <div className="mb-6">
          <HSMCPayAdminToggle />
        </div>



        {/* Security notice */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6 flex items-start gap-3"
        >
          <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-primary">Encrypted per-user storage (RLS)</p>
            <p className="text-muted-foreground">
              Secret values never round-trip to the browser after saving — only the masked status is shown.
              Every key is scoped to your user account.
            </p>
          </div>
        </motion.div>

        {/* Quick-start callout: ONE field unlocks the whole VPS stack */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-primary/10 to-accent/5 border border-primary/30 rounded-lg p-4 mb-6"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm flex-1">
              <p className="font-medium text-foreground">One IP, full stack</p>
              <p className="text-muted-foreground mt-0.5">
                Paste your VPS URL in <button onClick={() => setActiveTab('node')} className="font-mono text-primary underline">rust_node_url</button>{' '}
                and we automatically derive <code className="font-mono">stratum_url</code> too —
                blockchain, mining, mining_pool and tx_broadcast all activate at once.
                Use the <Wifi className="inline h-3 w-3" /> Test button to verify the node responds.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Feature health overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {features.map(f => (
            <div
              key={f.feature}
              className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                f.enabled ? 'bg-green-500/5 border-green-500/30' : 'bg-muted/40 border-border'
              }`}
            >
              <div>
                <div className="font-mono text-foreground">{f.feature}</div>
                {!f.enabled && f.missing_keys?.length > 0 && (
                  <div className="text-muted-foreground text-[10px] mt-0.5">
                    needs: {f.missing_keys.slice(0, 2).join(', ')}{f.missing_keys.length > 2 ? '…' : ''}
                  </div>
                )}
              </div>
              {f.enabled
                ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                : <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>

        {/* Category Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto flex-wrap h-auto">
            {Object.keys(CATEGORY_META).map(cat => {
              const meta = CATEGORY_META[cat];
              const { filled, total } = categoryHealth(cat);
              const Icon = meta.icon;
              return (
                <TabsTrigger key={cat} value={cat} className="gap-2">
                  <Icon className="h-4 w-4" />
                  {meta.label}
                  <Badge variant={filled === total && total > 0 ? 'default' : 'secondary'} className="ml-1 text-[10px]">
                    {filled}/{total}
                  </Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {Object.keys(CATEGORY_META).map(cat => (
            <TabsContent key={cat} value={cat} className="mt-6 space-y-4">
              <div className="bg-muted/30 border border-border/40 rounded-lg p-3 text-xs text-muted-foreground">
                {CATEGORY_META[cat].desc}
              </div>

              {(grouped[cat] ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No configurable keys in this category.
                </p>
              )}

              {(grouped[cat] ?? []).map(row => {
                const isVis = visible.has(row.key);
                const editedVal = edits[row.key];
                const currentVal = row.is_secret
                  ? (editedVal ?? '')                       // never expose existing secret
                  : (editedVal ?? row.current_value ?? '');
                const dirty = editedVal !== undefined;

                return (
                  <motion.div
                    key={row.key}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-border rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{row.label}</span>
                          {row.is_secret && <Badge variant="outline" className="text-[9px] gap-1"><Shield className="h-2.5 w-2.5" />SECRET</Badge>}
                          {row.has_value && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
                        {row.required_for?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {row.required_for.map(f => (
                              <span key={f} className="text-[9px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <div className="relative flex-1">
                        <Input
                          type={row.is_secret && !isVis ? 'password' : 'text'}
                          placeholder={row.has_value && row.is_secret ? '•••••••• (saved — type to replace)' : (row.example_value ?? '')}
                          value={currentVal}
                          onChange={e => setEdits(prev => ({ ...prev, [row.key]: e.target.value }))}
                          className="pr-10 font-mono text-sm"
                        />
                        {row.is_secret && (
                          <button
                            type="button"
                            onClick={() => toggleVisible(row.key)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {isVis ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                      {isUrlKey(row.key) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => testConnection(row)}
                          disabled={testing === row.key}
                          title="Test connection"
                        >
                          {testing === row.key
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Wifi className="h-4 w-4" />}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => saveSetting(row)}
                        disabled={saving === row.key || !dirty}
                      >
                        {saving === row.key
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Save className="h-4 w-4" />}
                      </Button>
                      {row.has_value && (
                        <Button size="sm" variant="ghost" onClick={() => deleteSetting(row)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    {testResult[row.key] && (
                      <div className={`mt-2 text-[11px] font-mono flex items-center gap-1.5 ${testResult[row.key].ok ? 'text-green-500' : 'text-destructive'}`}>
                        {testResult[row.key].ok
                          ? <><Wifi className="h-3 w-3" /> reachable · {testResult[row.key].latency_ms}ms</>
                          : <><WifiOff className="h-3 w-3" /> {testResult[row.key].error ?? 'unreachable'}</>}
                      </div>
                    )}

                    {row.updated_at && (
                      <p className="text-[10px] text-muted-foreground/60 mt-2 font-mono">
                        Last updated: {new Date(row.updated_at).toLocaleString()}
                      </p>
                    )}
                  </motion.div>
                );
              })}

              {/* Per-category quick actions */}
              {cat === 'notifications' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateVapid}
                  disabled={generatingVapid}
                  className="gap-2"
                >
                  {generatingVapid
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Sparkles className="h-4 w-4" />}
                  Auto-generate VAPID keys
                </Button>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Manual / docs */}
        <div className="mt-10 p-5 rounded-lg border border-border bg-muted/20">
          <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
            <Network className="h-4 w-4 text-primary" />
            Setup Manual — where to obtain each key
          </h3>
          <div className="grid md:grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="font-mono text-foreground mb-1">Stripe (Payments)</p>
              <p>1. Create an account at <a href="https://dashboard.stripe.com" target="_blank" className="text-primary inline-flex items-center gap-1">dashboard.stripe.com <ExternalLink className="h-3 w-3" /></a></p>
              <p>2. Developers → API keys → copy <code>pk_…</code> and <code>sk_…</code></p>
              <p>3. Webhooks → Add endpoint pointing at your <code>hsmcpay-checkout</code> function → copy <code>whsec_…</code></p>
            </div>
            <div>
              <p className="font-mono text-foreground mb-1">Rust Node</p>
              <p>1. Deploy with <code>rust-node/deploy.sh</code> on a VPS</p>
              <p>2. Set <code>rust_node_url</code> to <code>https://your-host:8545</code></p>
              <p>3. Optional API key for protected endpoints</p>
            </div>
            <div>
              <p className="font-mono text-foreground mb-1">EVM Bridges (BSC / ETH / Polygon)</p>
              <p>1. RPC URL from <a href="https://chainlist.org" target="_blank" className="text-primary inline-flex items-center gap-1">chainlist.org <ExternalLink className="h-3 w-3" /></a> or Alchemy/Infura</p>
              <p>2. Deploy <code>WrappedHSMC.sol</code>, paste contract address</p>
              <p>3. Relayer wallet private key (use a hot wallet — never your main)</p>
            </div>
            <div>
              <p className="font-mono text-foreground mb-1">DEX Price Oracle</p>
              <p>1. Add liquidity on PancakeSwap / Uniswap V3</p>
              <p>2. Copy the pair / pool contract address</p>
              <p>3. Engine reads reserves every 5 min via your RPC URL</p>
            </div>
            <div>
              <p className="font-mono text-foreground mb-1">Mining (Stratum V2)</p>
              <p>Point your miner at <code>ws://your-rust-node:3333</code> with worker name <code>your-wallet.rig1</code>.</p>
            </div>
            <div>
              <p className="font-mono text-foreground mb-1">Push Notifications</p>
              <p>Generate VAPID keys with <code>npx web-push generate-vapid-keys</code> and paste both halves.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
