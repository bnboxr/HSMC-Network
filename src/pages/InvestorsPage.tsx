import { useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  TrendingUp, Users, Shield, Coins, ChevronRight,
  Mail, Globe, Twitter, Github, Send, Check,
  BarChart3, PieChart, Lock, Unlock, Calendar, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/db/client';

// ── Animated counter ────────────────────────────────────────────────────────
function AnimatedNumber({ value, suffix = '', prefix = '' }: { value: number; suffix?: string; prefix?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [displayed, setDisplayed] = useState(0);

  useState(() => {
    if (!inView) return;
    let start = 0;
    const step = value / 60;
    const timer = setInterval(() => {
      start = Math.min(start + step, value);
      setDisplayed(Math.round(start));
      if (start >= value) clearInterval(timer);
    }, 16);
  });

  return <span ref={ref}>{prefix}{inView ? displayed.toLocaleString() : 0}{suffix}</span>;
}

// ── Allocation data ──────────────────────────────────────────────────────────
const ALLOCATION = [
  { label: 'Mining Rewards', pct: 40, color: 'hsl(var(--primary))', desc: 'Distributed over ~200 years via halving' },
  { label: 'Ecosystem Fund', pct: 20, color: 'hsl(var(--secondary))', desc: 'Grants, partnerships, developer bounties' },
  { label: 'Team & Advisors', pct: 15, color: 'hsl(var(--accent))', desc: '2-year vesting, 6-month cliff' },
  { label: 'Public Sale', pct: 15, color: 'hsl(var(--primary) / 0.6)', desc: 'ICO / DEX listing allocation' },
  { label: 'Reserve', pct: 10, color: 'hsl(var(--muted-foreground))', desc: 'Emergency fund & future CEX listings' },
];

const VESTING = [
  { who: 'Mining Rewards', cliff: '—', vesting: '~200 years (halving)', unlocked: 0 },
  { who: 'Ecosystem Fund', cliff: '—', vesting: 'Quarterly tranches', unlocked: 5 },
  { who: 'Team & Advisors', cliff: '6 months', vesting: '24 months linear', unlocked: 0 },
  { who: 'Public Sale', cliff: '—', vesting: 'Immediate at TGE', unlocked: 100 },
  { who: 'Reserve', cliff: '12 months', vesting: '36 months linear', unlocked: 0 },
];

// ── Pie chart SVG (pure CSS + SVG, no library needed) ───────────────────────
function AllocationPie({ active, setActive }: { active: number | null; setActive: (i: number | null) => void }) {
  const total = 100;
  let cumulative = 0;

  const slices = ALLOCATION.map((a, i) => {
    const startAngle = (cumulative / total) * 360 - 90;
    cumulative += a.pct;
    const endAngle = (cumulative / total) * 360 - 90;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const r = 80;
    const cx = 100, cy = 100;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = a.pct > 50 ? 1 : 0;
    const midAngle = ((startAngle + endAngle) / 2 * Math.PI) / 180;
    const lx = cx + (r + 18) * Math.cos(midAngle);
    const ly = cy + (r + 18) * Math.sin(midAngle);
    return { ...a, i, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`, lx, ly, midAngle };
  });

  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 200 200" className="w-64 h-64">
        {slices.map((s) => (
          <path
            key={s.i}
            d={s.path}
            fill={s.color}
            opacity={active === null || active === s.i ? 1 : 0.3}
            className="cursor-pointer transition-all duration-200"
            onMouseEnter={() => setActive(s.i)}
            onMouseLeave={() => setActive(null)}
            stroke="hsl(var(--background))"
            strokeWidth="2"
            transform={active === s.i ? `translate(${Math.cos(s.midAngle) * 5} ${Math.sin(s.midAngle) * 5})` : ''}
          />
        ))}
        <circle cx="100" cy="100" r="40" fill="hsl(var(--background))" />
        <text x="100" y="96" textAnchor="middle" className="text-xs" fill="hsl(var(--foreground))" fontSize="10" fontWeight="bold">
          {active !== null ? ALLOCATION[active].pct + '%' : '100M'}
        </text>
        <text x="100" y="110" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="7">
          {active !== null ? ALLOCATION[active].label : 'Total Supply'}
        </text>
      </svg>
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {ALLOCATION.map((a, i) => (
          <button key={i} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all ${active === i ? 'bg-muted/60' : ''}`}>
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-bold font-mono">{a.pct}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Vesting Timeline ─────────────────────────────────────────────────────────
function VestingBar({ pct, color }: { pct: number; color: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="h-2 bg-muted rounded-full overflow-hidden flex-1">
      <motion.div
        initial={{ width: 0 }}
        animate={inView ? { width: `${pct}%` } : {}}
        transition={{ duration: 1.2, delay: 0.3 }}
        className="h-full rounded-full"
        style={{ background: color }}
      />
    </div>
  );
}

export default function InvestorsPage() {
  const [activePie, setActivePie] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', fund: '', email: '', amount: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.fund) { toast({ title: 'Fill required fields', variant: 'destructive' }); return; }
    setSubmitting(true);
    try {
      // Store inquiry as notification so it hits the DB
      await supabase.from('notifications').insert({
        user_id: null,
        type: 'investor_inquiry',
        title: `VC Inquiry: ${formData.fund}`,
        message: `From: ${formData.name} <${formData.email}> | Amount: ${formData.amount} | ${formData.message}`,
        data: formData,
      });
      setSubmitted(true);
      toast({ title: '✅ Inquiry sent!', description: 'We will contact you within 48 hours.' });
    } catch { toast({ title: 'Error sending', variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <div className="fixed top-0 left-0 right-0 z-50 glass py-3 px-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" />Back
        </a>
        <div className="flex items-center gap-2">
          <a href="/whitepaper"><Button variant="outline" size="sm" className="gap-1"><Download className="w-3 h-3"/>Whitepaper</Button></a>
          <a href="/mainnet"><Button variant="hero" size="sm">Mainnet Hub</Button></a>
        </div>
      </div>

      <div className="pt-20 pb-32">
        {/* Hero */}
        <section className="container mx-auto px-4 py-24 text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-mono mb-6">
              <TrendingUp className="w-4 h-4" /> Investor Relations
            </div>
            <h1 className="text-5xl sm:text-7xl font-black mb-6">
              Invest in <span className="gradient-text">Privacy</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              HSMC is building the next generation of privacy-first blockchain infrastructure.
              We're seeking strategic partners for our mainnet launch.
            </p>
          </motion.div>
        </section>

        {/* KPI Stats */}
        <section className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              { label: 'Total Supply', value: 100, suffix: 'M HSMC', icon: Coins },
              { label: 'Block Time', value: 120, suffix: 's', icon: Calendar },
              { label: 'Max APR Staking', value: 18, suffix: '%', icon: TrendingUp },
              { label: 'Privacy Ring Size', value: 16, suffix: ' max', icon: Shield },
            ].map(({ label, value, suffix, icon: Icon }) => (
              <motion.div key={label} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel text-center">
                <Icon className="w-6 h-6 text-primary mx-auto mb-3" />
                <div className="text-3xl font-black gradient-text font-mono">
                  <AnimatedNumber value={value} suffix={suffix} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">{label}</div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Token Allocation */}
        <section className="container mx-auto px-4 py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-center mb-12">
              <span className="gradient-text">Token</span> Allocation
            </h2>
            <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
              <AllocationPie active={activePie} setActive={setActivePie} />
              <div className="space-y-4">
                {ALLOCATION.map((a, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                    onMouseEnter={() => setActivePie(i)} onMouseLeave={() => setActivePie(null)}
                    className={`p-4 rounded-xl border cursor-default transition-all ${activePie === i ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/10'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: a.color }} />
                        <span className="font-semibold text-sm">{a.label}</span>
                      </div>
                      <span className="font-black font-mono text-lg" style={{ color: a.color }}>{a.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                      <motion.div initial={{ width: 0 }} whileInView={{ width: `${a.pct}%` }} viewport={{ once: true }} transition={{ duration: 1 }}
                        className="h-full rounded-full" style={{ background: a.color }} />
                    </div>
                    <p className="text-xs text-muted-foreground">{a.desc}</p>
                    <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">
                      {(a.pct * 1_000_000).toLocaleString()} HSMC
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        {/* Vesting Schedule */}
        <section className="container mx-auto px-4 py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-center mb-4">
              <span className="gradient-text">Vesting</span> Schedule
            </h2>
            <p className="text-center text-muted-foreground mb-12 text-sm">Designed to align long-term incentives and prevent market dumps</p>
            <div className="max-w-3xl mx-auto glass-panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-4 text-xs text-muted-foreground font-mono uppercase">Allocation</th>
                      <th className="text-left p-4 text-xs text-muted-foreground font-mono uppercase">Cliff</th>
                      <th className="text-left p-4 text-xs text-muted-foreground font-mono uppercase">Vesting</th>
                      <th className="text-right p-4 text-xs text-muted-foreground font-mono uppercase">At TGE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VESTING.map((v, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ALLOCATION[i]?.color }} />
                            <span className="font-medium">{v.who}</span>
                          </div>
                        </td>
                        <td className="p-4 font-mono text-xs text-muted-foreground">{v.cliff}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <VestingBar pct={v.unlocked > 0 ? 100 : 40} color={ALLOCATION[i]?.color || 'hsl(var(--primary))'} />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{v.vesting}</span>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <span className={`font-mono text-sm font-bold ${v.unlocked > 0 ? 'text-secondary' : 'text-muted-foreground'}`}>
                            {v.unlocked}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 bg-muted/20 border-t border-border">
                <div className="flex items-start gap-3 text-xs text-muted-foreground">
                  <Lock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span>Team tokens are locked in a smart contract with time-lock. No team member can sell tokens before the cliff period ends, ensuring alignment with long-term project success.</span>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Why Invest */}
        <section className="container mx-auto px-4 py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-center mb-12">
              Why <span className="gradient-text">HSMC</span>?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {[
                {
                  icon: Shield,
                  title: 'Privacy as Default',
                  desc: 'Unlike Bitcoin/Ethereum where privacy is optional, HSMC has Ring Signatures, Stealth Addresses, and RingCT built into the core protocol. Every transaction is private by default.',
                  metric: '$5B+', metricLabel: 'Monero market cap (comparable)'
                },
                {
                  icon: BarChart3,
                  title: 'Dual Revenue Streams',
                  desc: 'Network fees from all private transactions + HSMCPay merchant payment processing creates two separate revenue streams that compound as adoption grows.',
                  metric: '18% APR', metricLabel: 'Max staking yield'
                },
                {
                  icon: Globe,
                  title: 'Cross-Chain Bridge',
                  desc: 'Wrapped HSMC on BSC and ETH brings DeFi liquidity to the privacy chain. Users can trade wHSMC on Uniswap/PancakeSwap while HSMC remains private on mainnet.',
                  metric: '3 chains', metricLabel: 'At launch (HSMC, BSC, ETH)'
                },
              ].map(({ icon: Icon, title, desc, metric, metricLabel }) => (
                <motion.div key={title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
                  <Icon className="w-8 h-8 text-primary mb-4" />
                  <h3 className="font-bold text-lg mb-3">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{desc}</p>
                  <div className="pt-4 border-t border-border">
                    <div className="text-2xl font-black gradient-text font-mono">{metric}</div>
                    <div className="text-xs text-muted-foreground">{metricLabel}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* VC Contact Form */}
        <section className="container mx-auto px-4 py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-center mb-4">
              <span className="gradient-text">Contact</span> Our Team
            </h2>
            <p className="text-center text-muted-foreground mb-12 text-sm">Strategic investors, VCs, and exchange partners — reach out for a private briefing</p>
            <div className="max-w-2xl mx-auto glass-panel">
              {submitted ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-secondary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Inquiry Received!</h3>
                  <p className="text-muted-foreground">We'll reach out within 48 business hours with a NDA and investor deck.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Your Name</label>
                      <Input placeholder="John Smith" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Fund / Organization *</label>
                      <Input placeholder="Andreessen Horowitz" value={formData.fund} onChange={e => setFormData(p => ({ ...p, fund: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Email *</label>
                      <Input type="email" placeholder="partner@fund.com" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} required />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Check Size (USD)</label>
                      <Input placeholder="$50,000 - $500,000" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Message</label>
                    <textarea
                      rows={4}
                      placeholder="Tell us about your investment thesis and why you're interested in privacy blockchain infrastructure..."
                      value={formData.message}
                      onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <Button type="submit" variant="hero" className="w-full gap-2" disabled={submitting}>
                    {submitting ? 'Sending...' : <><Send className="w-4 h-4" />Send Inquiry</>}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    All inquiries are reviewed by our core team. We respond to qualified investors within 48 hours.
                  </p>
                </form>
              )}
            </div>
          </motion.div>
        </section>
      </div>
    </div>
  );
}
