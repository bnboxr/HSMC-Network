import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, ShieldOff, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface KillSwitchState {
  kill_switch_active: boolean;
  mode: 'normal' | 'p2p_only';
}

const API_BASE = '/admin/kill-switch';

export function useKillSwitch() {
  const [state, setState] = useState<KillSwitchState>({ kill_switch_active: false, mode: 'normal' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(API_BASE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: KillSwitchState = await res.json();
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    // Poll every 30 seconds
    const interval = setInterval(fetchState, 30_000);
    return () => clearInterval(interval);
  }, [fetchState]);

  const toggle = useCallback(async (action: 'activate' | 'deactivate') => {
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setState({ kill_switch_active: data.kill_switch_active, mode: data.kill_switch_active ? 'p2p_only' : 'normal' });
      return data;
    } catch (err) {
      throw err;
    }
  }, []);

  return { state, loading, error, refetch: fetchState, toggle };
}

interface KillSwitchBannerProps {
  /** If true, only the admin panel is shown (compact mode for narrow spaces) */
  compact?: boolean;
}

export const KillSwitchBanner = ({ compact = false }: KillSwitchBannerProps) => {
  const { state, loading, error, refetch, toggle } = useKillSwitch();
  const [toggling, setToggling] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  const handleToggle = async (action: 'activate' | 'deactivate') => {
    setToggling(true);
    try {
      await toggle(action);
    } catch (err) {
      console.error('[KillSwitch] Toggle failed:', err);
    } finally {
      setToggling(false);
    }
  };

  if (loading && !state.kill_switch_active) {
    // Don't show anything while loading if kill-switch is inactive (avoid flicker)
    return null;
  }

  if (error && !state.kill_switch_active) {
    // Only show error if kill-switch might be active but we can't tell
    return null;
  }

  if (!state.kill_switch_active && !showAdmin) {
    // Normal mode — show nothing, but allow admin access via a small toggle
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setShowAdmin(true)}
          className="p-2 bg-muted/50 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
          title="Admin: Kill-Switch Panel"
        >
          <ShieldOff className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ── Red Banner (visible when active) ──────────────────────────── */}
      {state.kill_switch_active && (
        <div className="sticky top-0 z-50 w-full bg-destructive text-destructive-foreground">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 animate-pulse" />
              <span className="font-semibold text-sm sm:text-base truncate">
                ⚠️ KILL-SWITCH ACTIVE — Card payments disabled. P2P mode only.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => refetch()}
                className="p-1.5 hover:bg-destructive-foreground/10 rounded transition-colors"
                title="Refresh status"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowAdmin(!showAdmin)}
                className="p-1.5 hover:bg-destructive-foreground/10 rounded transition-colors"
                title="Admin controls"
              >
                <ShieldOff className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin Panel (dropdown) ────────────────────────────────────── */}
      {showAdmin && (
        <div className="fixed top-12 right-4 z-50 w-80 bg-card border border-border rounded-xl shadow-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <ShieldOff className="w-4 h-4 text-destructive" />
              Kill-Switch Admin
            </h3>
            <button
              onClick={() => setShowAdmin(false)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Status */}
          <div className={`p-3 rounded-lg border ${state.kill_switch_active ? 'bg-destructive/10 border-destructive/30' : 'bg-secondary/10 border-secondary/30'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              <span className={`text-sm font-bold ${state.kill_switch_active ? 'text-destructive' : 'text-secondary'}`}>
                {state.kill_switch_active ? '🔴 ACTIVE' : '🟢 NORMAL'}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Mode: {state.mode === 'p2p_only' ? 'P2P Only' : 'Full (Stripe + P2P)'}
            </div>
          </div>

          {/* Toggle buttons */}
          <div className="space-y-2">
            <Button
              variant="destructive"
              className="w-full"
              disabled={toggling || state.kill_switch_active}
              onClick={() => handleToggle('activate')}
            >
              {toggling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
              Activate Kill-Switch
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={toggling || !state.kill_switch_active}
              onClick={() => handleToggle('deactivate')}
            >
              {toggling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Deactivate Kill-Switch
            </Button>
          </div>

          {/* Info */}
          <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded-lg">
            <p><strong>When active:</strong></p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>All Visa/Mastercard (Stripe) endpoints disabled</li>
              <li>P2P transfers only (HSMC direct)</li>
              <li>Stripe webhooks still process existing payments</li>
              <li>All toggles logged in audit_log</li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

export default KillSwitchBanner;
