/**
 * ReferralPanel — displays user's referral link + stats
 * Each user auto-gets a code; bonus of 50 HSMC tracked in DB
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Gift, Copy, Check, Users, Loader2, Share2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

interface ReferralCode {
  id: string;
  code: string;
  created_at: string;
}

interface ReferralUse {
  id: string;
  referred_user_id: string;
  bonus_amount: number;
  bonus_paid: boolean;
  created_at: string;
}

export const ReferralPanel = () => {
  const { user } = useAuth();
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null);
  const [referrals, setReferrals] = useState<ReferralUse[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchReferralData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Fetch or create referral code
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('id, code, created_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      setReferralCode(existing as ReferralCode);

      // Fetch referral uses
      const { data: uses } = await supabase
        .from('referral_uses')
        .select('id, referred_user_id, bonus_amount, bonus_paid, created_at')
        .eq('referrer_user_id', user.id)
        .order('created_at', { ascending: false });
      setReferrals((uses ?? []) as ReferralUse[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchReferralData();
  }, [fetchReferralData]);

  const handleCreateCode = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('referral_codes')
        .insert({ user_id: user.id })
        .select('id, code, created_at')
        .single();
      if (error) throw error;
      setReferralCode(data as ReferralCode);
      toast({ title: '🎁 Referral link created!', description: 'Share it to earn 50 HSMC per signup.' });
    } catch (err: unknown) {
      toast({ title: 'Failed', description: String(err), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const referralLink = referralCode
    ? `${window.location.origin}/onboarding?ref=${referralCode.code}`
    : '';

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: '✅ Link copied to clipboard!' });
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join HSMC',
          text: 'Sign up with my referral link and we both get 50 HSMC!',
          url: referralLink,
        });
      } catch {
        handleCopy();
      }
    } else {
      handleCopy();
    }
  };

  const totalBonus = referrals.reduce((s, r) => s + Number(r.bonus_amount), 0);
  const paidBonus = referrals.filter(r => r.bonus_paid).reduce((s, r) => s + Number(r.bonus_amount), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Referrals', value: referrals.length, color: 'text-primary' },
          { label: 'Bonus Earned', value: `${totalBonus} HSMC`, color: 'text-secondary' },
          { label: 'Bonus Paid', value: `${paidBonus} HSMC`, color: 'text-accent' },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-border/40 bg-muted/20 p-3 text-center">
            <div className={`text-lg font-black font-mono ${stat.color}`}>{stat.value}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Referral Link */}
      {!referralCode ? (
        <div className="rounded-xl border border-border/40 bg-muted/10 p-5 text-center space-y-3">
          <Gift className="w-8 h-8 text-primary mx-auto" />
          <div>
            <p className="font-semibold text-sm">Generate your referral link</p>
            <p className="text-xs text-muted-foreground mt-1">
              You and your friend both receive <strong className="text-secondary">50 HSMC</strong> when they sign up and create a wallet.
            </p>
          </div>
          <Button onClick={handleCreateCode} disabled={creating} variant="hero" className="w-full">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
            Generate Referral Link
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Your Referral Link</span>
            <span className="ml-auto text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
              ACTIVE
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              readOnly
              value={referralLink}
              className="text-xs font-mono bg-background/50 cursor-text"
              onClick={e => (e.target as HTMLInputElement).select()}
            />
            <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
              {copied ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={handleShare} className="shrink-0">
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Code: <span className="font-mono font-bold text-primary">{referralCode.code}</span>
            {' · '}Both users receive <strong className="text-secondary">50 HSMC</strong> on wallet creation.
          </p>
        </div>
      )}

      {/* Referral history */}
      {referrals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="w-3.5 h-3.5" />
            Referred Users ({referrals.length})
          </h3>
          {referrals.slice(0, 5).map(r => (
            <div
              key={r.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30"
            >
              <div>
                <p className="text-xs font-mono text-muted-foreground">
                  {r.referred_user_id.slice(0, 8)}...
                </p>
                <p className="text-[10px] text-muted-foreground/50">
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-bold text-secondary">+{r.bonus_amount} HSMC</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  r.bonus_paid
                    ? 'border-secondary/30 text-secondary bg-secondary/10'
                    : 'border-border text-muted-foreground'
                }`}>
                  {r.bonus_paid ? 'paid' : 'pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default ReferralPanel;
