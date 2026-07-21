/**
 * HSMCPay Intermediary Toggle — admin-only ON/OFF switch.
 *
 * ON  = buy/sell flows through HSMC's own processor (edge fn hsmcpay-checkout)
 *       which validates the card, mints an OTP, credits/debits the wallet in
 *       DB, and submits the tx to the Rust node.
 * OFF = HSMC processor is bypassed; buy/sell must use direct Stripe checkout.
 *
 * Every signed-in user can READ the current mode (badge).
 * Only rows in `user_roles` with role='admin' can toggle it (RLS-enforced).
 */
import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

export default function HSMCPayAdminToggle() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableExists, setTableExists] = useState(true);

  const load = async () => {
    setLoading(true);
    const cfgRes = await supabase
      .from('platform_config' as never)
      .select('hsmcpay_intermediary_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (cfgRes.error && /does not exist|relation/i.test(cfgRes.error.message)) {
      setTableExists(false);
      setEnabled(true); // default assumption
    } else {
      setEnabled(Boolean((cfgRes.data as { hsmcpay_intermediary_enabled?: boolean } | null)?.hsmcpay_intermediary_enabled));
    }
    if (user) {
      const roleRes = await supabase
        .from('user_roles' as never)
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      setIsAdmin(Boolean(roleRes.data));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const toggle = async () => {
    if (!isAdmin || enabled === null) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from('platform_config')
      .update({ hsmcpay_intermediary_enabled: !enabled, updated_at: new Date().toISOString(), updated_by: user?.id })
      .eq('id', 1);
    setSaving(false);
    if (error) {
      toast({ title: 'Toggle failed', description: error.message, variant: 'destructive' });
      return;
    }
    setEnabled(!enabled);
    toast({
      title: `HSMCPay processor ${!enabled ? 'ENABLED' : 'DISABLED'}`,
      description: !enabled
        ? 'Buy/sell will flow through the HSMC intermediary.'
        : 'Buy/sell will bypass HSMC and use direct Stripe.',
    });
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading processor status…</div>;

  return (
    <div className="border border-border rounded-lg p-4 bg-card/60 backdrop-blur">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldCheck className="w-5 h-5 text-secondary" />
          ) : (
            <ShieldOff className="w-5 h-5 text-destructive" />
          )}
          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              HSMCPay Intermediary
              <Badge variant={enabled ? 'default' : 'destructive'} className="font-mono text-[10px]">
                {enabled ? 'ON' : 'OFF'}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {enabled
                ? 'Buy/Sell → HSMC processor → Stripe (own rail)'
                : 'Buy/Sell → Stripe direct (HSMC bypassed)'}
            </div>
          </div>
        </div>
        {isAdmin ? (
          <Button onClick={toggle} disabled={saving || !tableExists} variant={enabled ? 'destructive' : 'default'} size="sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
            {enabled ? 'Switch OFF' : 'Switch ON'}
          </Button>
        ) : (
          <span className="text-[10px] font-mono text-muted-foreground">read-only</span>
        )}
      </div>
      {!tableExists && (
        <p className="mt-3 text-[11px] text-amber-500">
          ⚠️ Table <code>platform_config</code> not migrated yet. Run <code>docs/migrations/platform_config.sql</code>.
        </p>
      )}
    </div>
  );
}
