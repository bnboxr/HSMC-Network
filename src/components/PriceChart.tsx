/**
 * PriceChart — real-time HSMC price history chart
 * Data sourced from price_history table, auto-refreshes every 30s
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, RefreshCw, Clock } from 'lucide-react';
import { supabase } from '@/integrations/db/client';
import { format, subDays, subHours } from 'date-fns';

type Period = '24h' | '7d' | '30d' | '90d';

interface PricePoint {
  timestamp: string;
  price: number;
  volume: number;
}

interface ChartPoint {
  time: string;
  price: number;
  volume: number;
  raw: string;
}

const PERIODS: { label: string; value: Period }[] = [
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
];

function cutoffDate(period: Period): string {
  const now = new Date();
  switch (period) {
    case '24h': return subHours(now, 24).toISOString();
    case '7d': return subDays(now, 7).toISOString();
    case '30d': return subDays(now, 30).toISOString();
    case '90d': return subDays(now, 90).toISOString();
  }
}

function formatTime(raw: string, period: Period): string {
  const d = new Date(raw);
  if (period === '24h') return format(d, 'HH:mm');
  if (period === '7d') return format(d, 'EEE HH:mm');
  return format(d, 'MMM d');
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background/95 px-3 py-2 shadow-xl backdrop-blur-sm text-xs">
      <p className="font-mono text-muted-foreground mb-1">{label}</p>
      <p className="font-mono font-bold text-primary">
        ${payload[0]?.value?.toFixed(6)} HSMC
      </p>
      {payload[1] && (
        <p className="font-mono text-muted-foreground/70 mt-0.5">
          Vol: {Number(payload[1]?.value).toLocaleString()}
        </p>
      )}
    </div>
  );
};

export const PriceChart = () => {
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    const cutoff = cutoffDate(period);
    const { data: rows, error } = await supabase
      .from('price_history')
      .select('timestamp, price, volume')
      .gte('timestamp', cutoff)
      .order('timestamp', { ascending: true })
      .limit(500);

    if (!error && rows) {
      const mapped: ChartPoint[] = (rows as PricePoint[]).map(r => ({
        time: formatTime(r.timestamp, period),
        price: Number(r.price),
        volume: Number(r.volume),
        raw: r.timestamp,
      }));
      setData(mapped);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Realtime subscription for new price entries
  useEffect(() => {
    const channel = supabase
      .channel('price-chart-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'price_history' }, () => {
        fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const currentPrice = data.length ? data[data.length - 1].price : null;
  const firstPrice = data.length ? data[0].price : null;
  const priceChange = currentPrice && firstPrice ? ((currentPrice - firstPrice) / firstPrice) * 100 : null;
  const isPositive = priceChange !== null && priceChange >= 0;
  const minPrice = data.length ? Math.min(...data.map(d => d.price)) : 0;
  const maxPrice = data.length ? Math.max(...data.map(d => d.price)) : 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="glass-panel col-span-full"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-sm uppercase tracking-wider font-mono">HSMC / USD</h3>
            <span className="flex items-center gap-1 text-xs text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              Live
            </span>
          </div>
          <div className="flex items-baseline gap-3">
            {currentPrice !== null ? (
              <>
                <span className="text-2xl font-black" style={{ fontFamily: 'var(--font-serif)' }}>
                  ${currentPrice.toFixed(6)}
                </span>
                {priceChange !== null && (
                  <span className={`flex items-center gap-1 text-sm font-mono font-semibold ${isPositive ? 'text-secondary' : 'text-destructive'}`}>
                    {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground text-sm font-mono">No price data yet</span>
            )}
          </div>
          {lastUpdated && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 font-mono mt-0.5">
              <Clock className="w-3 h-3" />
              Updated {format(lastUpdated, 'HH:mm:ss')}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/30 border border-border/30">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-all ${
                  period === p.value
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/50" />
        </div>
      ) : data.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center gap-2 text-center">
          <TrendingUp className="w-8 h-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground font-medium">No market activity yet</p>
          <p className="text-xs text-muted-foreground/50 max-w-xs">
            Prețul HSMC va apărea aici după primele tranzacții reale ale utilizatorilor.<br/>
            Fă un swap sau trimite HSMC pentru a genera activitate de piață.
          </p>
        </div>
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[minPrice * 0.998, maxPrice * 1.002]}
                tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${v.toFixed(4)}`}
                width={72}
              />
              <Tooltip content={<CustomTooltip />} />
              {firstPrice && (
                <ReferenceLine
                  y={firstPrice}
                  stroke="hsl(var(--muted-foreground) / 0.3)"
                  strokeDasharray="4 4"
                />
              )}
              <Area
                type="monotone"
                dataKey="price"
                stroke={isPositive ? 'hsl(var(--secondary))' : 'hsl(var(--destructive))'}
                strokeWidth={1.5}
                fill="url(#priceGradient)"
                dot={false}
                activeDot={{ r: 4, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
};

export default PriceChart;
