import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart, Activity,
  Loader2, Coins, ZoomIn, ZoomOut, RefreshCw
} from 'lucide-react';
import {
  PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Brush
} from 'recharts';
import { supabase } from '@/integrations/db/client';
import { Button } from '@/components/ui/button';

interface TokenMetrics {
  price: number;
  price_change_24h: number;
  market_cap: number;
  market_cap_change_24h: number;
  volume_24h: number;
  volume_change_24h: number;
  fully_diluted_valuation: number;
  circulating_supply: number;
  total_supply: number;
  staked_supply: number;
  all_time_high: number;
  all_time_high_date: string;
  token_holders: number;
  ytd_return: number;
}

interface PricePoint {
  timestamp: string;
  price: number;
  volume: number;
  label: string;
}

type Period = '7d' | '30d' | '90d';

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };

const fmtCurrency = (n: number) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(4)}`;
};

const fmtSupply = (n: number) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
};

const fmtDate = (ts: string, period: Period) => {
  const d = new Date(ts);
  if (period === '7d') return d.toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (period === '30d') return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
};

const HSMC_TOKENS = [
  { symbol: 'HSMC', name: 'Native Token', color: 'hsl(var(--primary))' },
  { symbol: 'wHSMC', name: 'Wrapped', color: 'hsl(var(--secondary))' },
  { symbol: 'HSMC-LEU', name: 'Romanian Leu', color: 'hsl(var(--accent))' },
  { symbol: 'HSMC-EUR', name: 'Euro', color: 'hsl(45 100% 58%)' },
  { symbol: 'HSMC-USD', name: 'US Dollar', color: 'hsl(187 100% 54%)' },
  { symbol: 'HSMC-XAU', name: 'Gold', color: 'hsl(38 100% 60%)' },
  { symbol: 'HSMC-XAG', name: 'Silver', color: 'hsl(210 15% 70%)' },
];

// Custom tooltip
const PriceTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs font-mono">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="text-primary font-bold text-sm">${Number(payload[0]?.value ?? 0).toFixed(6)}</p>
      {payload[1] && (
        <p className="text-muted-foreground mt-1">Vol: {fmtCurrency(Number(payload[1]?.value ?? 0))}</p>
      )}
    </div>
  );
};

export const TokenomicsSection = () => {
  const [metrics, setMetrics] = useState<TokenMetrics | null>(null);
  const [stakingAPR, setStakingAPR] = useState<number | null>(null);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [period, setPeriod] = useState<Period>('30d');
  const [loadingChart, setLoadingChart] = useState(false);
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const [{ data: m }, { data: p }] = await Promise.all([
        supabase.from('token_metrics').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('staking_pools').select('apr').eq('status', 'active').order('apr', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (m) setMetrics(m as unknown as TokenMetrics);
      if (p) setStakingAPR(p.apr);
    };
    fetchAll();

    const ch = supabase.channel('token-metrics-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'token_metrics' }, (p) => {
        if (p.new) setMetrics(p.new as unknown as TokenMetrics);
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  const fetchPriceHistory = useCallback(async (p: Period) => {
    setLoadingChart(true);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - PERIOD_DAYS[p]);

      const { data } = await supabase
        .from('price_history')
        .select('timestamp, price, volume')
        .gte('timestamp', cutoff.toISOString())
        .order('timestamp', { ascending: true })
        .limit(500);

      if (data && data.length > 0) {
        const formatted: PricePoint[] = data.map(row => ({
          timestamp: row.timestamp,
          price: Number(row.price),
          volume: Number(row.volume),
          label: fmtDate(row.timestamp, p),
        }));
        setPriceHistory(formatted);
      } else {
        // No real data — clear chart, do NOT generate fake data
        setPriceHistory([]);
      }
    } finally {
      setLoadingChart(false);
    }
  }, [metrics]);

  useEffect(() => {
    if (metrics !== null) fetchPriceHistory(period);
  }, [period, metrics]);

  const priceStart = priceHistory[0]?.price ?? 0;
  const priceEnd = priceHistory[priceHistory.length - 1]?.price ?? 0;
  const priceChange = priceStart > 0 ? ((priceEnd - priceStart) / priceStart) * 100 : 0;
  const isUp = priceChange >= 0;
  const chartColor = isUp ? 'hsl(var(--secondary))' : 'hsl(var(--destructive))';

  if (!metrics) {
    return (
      <section id="tokenomics" className="py-24">
        <div className="container mx-auto px-4 flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const cirPct = Math.round((metrics.circulating_supply / metrics.total_supply) * 100) || 0;
  const stkPct = Math.round((metrics.staked_supply / metrics.total_supply) * 100) || 0;
  const teamPct = 10;
  const treasPct = Math.max(0, 100 - cirPct - stkPct - teamPct);

  // Only show distribution if real data exists (no mock fallbacks)
  const hasRealSupplyData = metrics.total_supply > 0 && metrics.circulating_supply > 0;
  const distribution = hasRealSupplyData
    ? [
        { name: 'Circulating', value: cirPct, color: 'hsl(var(--primary))' },
        { name: 'Staked', value: stkPct, color: 'hsl(var(--secondary))' },
        { name: 'Team', value: teamPct, color: 'hsl(var(--accent))' },
        { name: 'Treasury', value: Math.max(0, treasPct), color: 'hsl(45 100% 58%)' },
      ]
    : [];

  const marketStats = [
    {
      label: 'HSMC Price',
      value: metrics.price > 0 ? `$${metrics.price.toFixed(6)}` : '$0.0001',
      change: metrics.price_change_24h,
      icon: DollarSign,
      sublabel: metrics.token_holders === 0 ? 'Pre-Market' : undefined,
    },
    {
      label: 'Market Cap',
      value: metrics.market_cap > 0 ? fmtCurrency(metrics.market_cap) : '—',
      change: metrics.market_cap_change_24h,
      icon: BarChart3,
      sublabel: metrics.market_cap === 0 ? 'No holders yet' : undefined,
    },
    {
      label: '24h Volume',
      value: metrics.volume_24h > 0 ? fmtCurrency(metrics.volume_24h) : '$0.00',
      change: metrics.volume_change_24h,
      icon: Activity,
      sublabel: metrics.volume_24h === 0 ? 'No transactions yet' : undefined,
    },
    {
      label: 'Fully Diluted',
      value: metrics.fully_diluted_valuation > 0 ? fmtCurrency(metrics.fully_diluted_valuation) : '—',
      change: metrics.price_change_24h,
      icon: TrendingUp,
      sublabel: metrics.fully_diluted_valuation === 0 ? 'Pre-Market' : undefined,
    },
  ];

  return (
    <section id="tokenomics" className="py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-14">
          <p className="section-eyebrow mb-4">Tokenomics</p>
          <h2 className="text-3xl sm:text-4xl font-black mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
            <span className="gradient-text">HSMC</span> Market Data
          </h2>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Real-time metrics from the HSMC ecosystem — 100+ chain multichain, HSMC as default currency
          </p>
        </motion.div>

        {/* Token Pairs */}
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="flex flex-wrap justify-center gap-2 mb-10">
          {HSMC_TOKENS.map((t) => (
            <span key={t.symbol} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-muted/20 text-xs font-mono"
              style={{ borderColor: `${t.color}30`, color: t.color }}>
              <Coins className="w-3 h-3" />
              {t.symbol}
              <span className="text-muted-foreground/60 text-[10px]">({t.name})</span>
            </span>
          ))}
        </motion.div>

        {/* Market Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {marketStats.map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }} className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <div className="p-1.5 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
                  <stat.icon className="w-4 h-4" />
                </div>
                {stat.sublabel ? (
                  <span className="text-[10px] font-mono text-muted-foreground/60 border border-border/30 rounded px-1.5 py-0.5">{stat.sublabel}</span>
                ) : (
                  <span className={`flex items-center gap-1 text-xs font-mono ${stat.change >= 0 ? 'text-secondary' : 'text-destructive'}`}>
                    {stat.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {stat.change >= 0 ? '+' : ''}{stat.change.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="text-2xl font-black" style={{ fontFamily: 'var(--font-serif)' }}>{stat.value}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">{stat.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Recharts Price Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel mb-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm">HSMC / USD Price Chart</h3>
                <p className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                  {loadingChart ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <span className={`font-bold ${isUp ? 'text-secondary' : 'text-destructive'}`}>
                      {isUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}% · {period}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Period selector */}
            <div className="flex items-center gap-2">
              {(['7d', '30d', '90d'] as Period[]).map(p => (
                <Button
                  key={p}
                  variant={period === p ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setPeriod(p); setZoomDomain(null); }}
                  className="h-7 px-3 text-xs font-mono"
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchPriceHistory(period)}
                className="h-7 w-7 p-0"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {loadingChart ? (
            <div className="h-80 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : priceHistory.length > 0 ? (
            <div style={{ height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={priceHistory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={chartColor} stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${Number(v).toFixed(4)}`}
                    width={70}
                  />
                  <YAxis
                    yAxisId="vol"
                    orientation="left"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground) / 0.5)', fontFamily: 'var(--font-mono)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtCurrency(Number(v))}
                    width={52}
                  />
                  <Tooltip content={<PriceTooltip />} />
                  {/* Volume bars (area underneath) */}
                  <Area
                    yAxisId="vol"
                    type="monotone"
                    dataKey="volume"
                    stroke="hsl(var(--primary) / 0.3)"
                    strokeWidth={0}
                    fill="url(#volGradient)"
                    isAnimationActive={false}
                  />
                  {/* Price line */}
                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="price"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#priceGradient)"
                    dot={false}
                    activeDot={{ r: 4, fill: chartColor, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                    isAnimationActive={priceHistory.length < 100}
                  />
                  {/* Zoom/scroll brush */}
                  <Brush
                    dataKey="label"
                    height={24}
                    stroke="hsl(var(--border))"
                    fill="hsl(var(--muted) / 0.3)"
                    travellerWidth={8}
                    tickFormatter={() => ''}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <BarChart3 className="w-10 h-10 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">No trading activity yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
                  Graficul va afișa date reale de preț pe măsură ce utilizatorii fac tranzacții și swap-uri pe rețea.
                </p>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40 border border-border/20 rounded px-2 py-1">
                Price: $0.0001 · Launch price · Pre-Market
              </span>
            </div>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground/50 font-mono">Data: price_history · Recharts · Live DB</span>
            <span className="text-[10px] text-muted-foreground/50 font-mono">Drag the brush to zoom</span>
          </div>
        </motion.div>

        {/* Distribution + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-panel">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
                <PieChart className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Token Distribution</h3>
                <p className="text-xs text-muted-foreground font-mono">Total: {fmtSupply(metrics.total_supply)} HSMC</p>
              </div>
            </div>
            {hasRealSupplyData ? (
              <div className="flex flex-col sm:flex-row items-center gap-5">
                <div className="w-44 h-44 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie data={distribution} cx="50%" cy="50%" innerRadius={46} outerRadius={66} paddingAngle={3} dataKey="value">
                        {distribution.map((entry, i) => (
                          <Cell key={i} fill={entry.color} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }} />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2.5">
                  {distribution.map((item) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: item.color }} />
                        <span className="text-xs font-mono">{item.name}</span>
                      </div>
                      <span className="font-mono font-bold text-sm">{item.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Coins className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">Pre-Market</p>
                <p className="text-xs text-muted-foreground/60 mt-1 font-mono">Distribution data available after TGE</p>
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="glass-panel">
            <h3 className="font-bold text-sm mb-5 font-mono uppercase tracking-wider">Token Metrics</h3>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { icon: DollarSign, label: 'All-Time High', value: `$${metrics.all_time_high.toFixed(4)}`, sub: metrics.all_time_high_date || '—' },
                { icon: Activity, label: 'Staking APR', value: stakingAPR ? `${stakingAPR}%` : '—', sub: 'Variable rate' },
                { icon: BarChart3, label: 'Token Holders', value: metrics.token_holders >= 1000 ? `${(metrics.token_holders / 1000).toFixed(1)}K` : `${metrics.token_holders}`, sub: 'Unique addresses' },
                { icon: TrendingUp, label: 'YTD Return', value: `${metrics.ytd_return >= 0 ? '+' : ''}${metrics.ytd_return}%`, sub: 'Since Jan 1' },
              ].map((item) => (
                <div key={item.label} className="text-center p-3 rounded-lg bg-muted/20 border border-border/30">
                  <div className="w-8 h-8 mx-auto mb-2 rounded-lg flex items-center justify-center" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
                    <item.icon className="w-4 h-4" />
                  </div>
                  <div className="text-lg font-black font-mono">{item.value}</div>
                  <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mt-0.5">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground/50 font-mono">{item.sub}</div>
                </div>
              ))}
            </div>

            {/* Multichain badge */}
            <div className="p-3 rounded-lg border border-primary/20 text-center" style={{ background: 'hsl(var(--primary) / 0.06)' }}>
              <div className="font-bold text-primary text-xs font-mono uppercase tracking-widest">100+ Chain Multichain</div>
              <div className="text-[11px] text-muted-foreground mt-1">Default currency: HSMC — interoperable with all major EVM and non-EVM chains</div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default TokenomicsSection;
