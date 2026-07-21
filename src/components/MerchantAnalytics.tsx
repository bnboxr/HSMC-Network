import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  TrendingUp, DollarSign, Package, BarChart3,
  Download, RefreshCw, Loader2, Calendar, FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';

interface DailyData {
  date: string;
  volume: number;
  count: number;
}

interface LinkRevenue {
  name: string;
  value: number;
  count: number;
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
  'hsl(var(--accent))',
  'hsl(45 100% 58%)',
  'hsl(187 100% 54%)',
];

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
};

export const MerchantAnalytics = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [linkRevenue, setLinkRevenue] = useState<LinkRevenue[]>([]);
  const [totalVolume, setTotalVolume] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [conversionRate, setConversionRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const fetchAnalytics = useCallback(async () => {
    if (!user || !wallet) { setLoading(false); return; }
    setLoading(true);

    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    try {
      // Fetch all received transactions for this wallet in the period
      const { data: txs } = await supabase
        .from('transactions')
        .select('amount, created_at, status, from_address')
        .eq('to_address', wallet.address)
        .gte('created_at', since)
        .order('created_at', { ascending: true });

      const { data: links } = await supabase
        .from('payment_links')
        .select('id, description, total_received, payments_count, slug')
        .eq('user_id', user.id);

      const { data: allTxFromPeriod } = await supabase
        .from('transactions')
        .select('id, status')
        .eq('to_address', wallet.address)
        .gte('created_at', since);

      if (txs) {
        // Build daily data
        const byDay: Record<string, { volume: number; count: number }> = {};
        for (let i = 0; i < days; i++) {
          const d = new Date(Date.now() - (days - 1 - i) * 86400000);
          const key = d.toISOString().slice(0, 10);
          byDay[key] = { volume: 0, count: 0 };
        }
        txs.forEach(tx => {
          const key = tx.created_at.slice(0, 10);
          if (byDay[key]) {
            byDay[key].volume += tx.amount;
            byDay[key].count += 1;
          }
        });
        const daily = Object.entries(byDay).map(([date, data]) => ({ date, ...data }));
        setDailyData(daily);
        setTotalVolume(txs.reduce((s, t) => s + t.amount, 0));
        setTotalCount(txs.length);

        // Conversion: confirmed / total
        const confirmed = allTxFromPeriod?.filter(t => t.status === 'confirmed').length ?? 0;
        const total = allTxFromPeriod?.length ?? 0;
        setConversionRate(total > 0 ? (confirmed / total) * 100 : 0);
      }

      if (links) {
        const lr = links
          .filter(l => l.total_received > 0 || l.payments_count > 0)
          .map(l => ({
            name: l.description || `Link ${l.slug.slice(0, 6)}`,
            value: l.total_received,
            count: l.payments_count,
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);
        setLinkRevenue(lr);
      }
    } catch (err) {
      console.error('Analytics error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, wallet, period]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const exportCSV = () => {
    const rows = [
      ['Date', 'Volume (HSMC)', 'Transactions'],
      ...dailyData.map(d => [d.date, d.volume.toFixed(4), d.count.toString()]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hsmc-merchant-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '✅ CSV exported' });
  };

  const exportPDF = () => {
    // Build a simple HTML report and print to PDF
    const html = `
      <!DOCTYPE html><html><head>
      <title>HSMCPay Merchant Report</title>
      <style>
        body { font-family: monospace; padding: 40px; background: #000; color: #fff; }
        h1 { color: #00f0ff; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #333; padding: 8px; text-align: left; }
        th { background: #111; color: #00f0ff; }
        .stat { display: inline-block; margin: 10px; padding: 15px; background: #111; border-radius: 8px; min-width: 150px; }
        .stat-value { font-size: 24px; color: #00f0ff; }
      </style></head><body>
      <h1>HSMCPay Merchant Report — ${period}</h1>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <div>
        <div class="stat"><div class="stat-value">${totalVolume.toFixed(2)}</div><div>Total Volume (HSMC)</div></div>
        <div class="stat"><div class="stat-value">${totalCount}</div><div>Total Transactions</div></div>
        <div class="stat"><div class="stat-value">${conversionRate.toFixed(1)}%</div><div>Conversion Rate</div></div>
      </div>
      <h2>Daily Breakdown</h2>
      <table><tr><th>Date</th><th>Volume (HSMC)</th><th>Transactions</th></tr>
      ${dailyData.map(d => `<tr><td>${d.date}</td><td>${d.volume.toFixed(4)}</td><td>${d.count}</td></tr>`).join('')}
      </table>
      </body></html>
    `;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-lg">
        <p className="font-mono text-muted-foreground mb-1">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} className="font-mono" style={{ color: p.color }}>
            {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                period === p ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={fetchAnalytics}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportPDF}>
            <FileText className="w-3.5 h-3.5" /> PDF
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Total Volume', value: `${totalVolume.toFixed(2)} HSMC`, icon: DollarSign, color: 'text-primary' },
              { label: 'Transactions', value: totalCount.toString(), icon: BarChart3, color: 'text-secondary' },
              { label: 'Conversion Rate', value: `${conversionRate.toFixed(1)}%`, icon: TrendingUp, color: 'text-accent' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <div className={`font-mono font-bold text-lg ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Daily Volume Chart */}
          <div className="glass-panel">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Daily Volume ({period})</span>
            </div>
            {dailyData.some(d => d.volume > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="volume" name="Volume (HSMC)" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No payment volume in this period
              </div>
            )}
          </div>

          {/* Daily TX Count Chart */}
          <div className="glass-panel">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-secondary" />
              <span className="font-semibold text-sm">Transaction Count ({period})</span>
            </div>
            {dailyData.some(d => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={dailyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="count" name="Transactions" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-36 flex items-center justify-center text-muted-foreground text-sm">
                No transactions in this period
              </div>
            )}
          </div>

          {/* Top Links by Revenue */}
          {linkRevenue.length > 0 && (
            <div className="glass-panel">
              <div className="flex items-center gap-2 mb-4">
                <Package className="w-4 h-4 text-accent" />
                <span className="font-semibold text-sm">Top Payment Links by Revenue</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={linkRevenue}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {linkRevenue.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 flex flex-col justify-center">
                  {linkRevenue.map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="truncate max-w-[120px] font-mono">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold">{item.value.toFixed(2)} HSMC</span>
                        <span className="text-muted-foreground ml-1">({item.count} pays)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {totalVolume === 0 && totalCount === 0 && (
            <div className="glass-panel text-center py-10 text-muted-foreground">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No payment data for this period.</p>
              <p className="text-xs mt-1">Share your payment links and QR codes to start receiving HSMC.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MerchantAnalytics;
