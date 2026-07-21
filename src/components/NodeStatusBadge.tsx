/**
 * NodeStatusBadge — compact badge shown in the Navbar and MiningDashboard
 * Pulses green when online, grey when offline, spinner when checking
 */
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useNodeHealth, NodeStatus } from '@/hooks/useNodeHealth';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const STATUS_CONFIG: Record<NodeStatus, { colorClass: string; dotClass: string; label: string; border: string; bg: string; hover: string }> = {
  online:   {
    colorClass: 'text-secondary',
    dotClass:   'bg-secondary',
    label:  'Node Online',
    border: 'border-secondary/30',
    bg:     'bg-secondary/10',
    hover:  'hover:bg-secondary/20',
  },
  offline:  {
    colorClass: 'text-muted-foreground',
    dotClass:   'bg-muted-foreground',
    label:  'Node Offline',
    border: 'border-border',
    bg:     'bg-muted/50',
    hover:  'hover:bg-muted',
  },
  checking: {
    colorClass: 'text-primary',
    dotClass:   'bg-primary',
    label:  'Checking...',
    border: 'border-primary/30',
    bg:     'bg-primary/10',
    hover:  '',
  },
};

interface NodeStatusBadgeProps {
  showDetails?: boolean;
  className?: string;
}

export const NodeStatusBadge = ({ showDetails = false, className = '' }: NodeStatusBadgeProps) => {
  const { health, refresh } = useNodeHealth();
  const cfg = STATUS_CONFIG[health.status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={refresh}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-colors ${cfg.border} ${cfg.bg} ${cfg.hover} ${className}`}
          >
            {/* Pulse dot */}
            <span className="relative flex h-2 w-2">
              {health.status === 'online' && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotClass} opacity-75`} />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dotClass}`} />
            </span>

            {health.status === 'checking' ? (
              <Loader2 className={`w-3 h-3 ${cfg.colorClass} animate-spin`} />
            ) : health.status === 'online' ? (
              <Wifi className={`w-3 h-3 ${cfg.colorClass}`} />
            ) : (
              <WifiOff className={`w-3 h-3 ${cfg.colorClass}`} />
            )}

            {showDetails && (
              <AnimatePresence mode="wait">
                <motion.span
                  key={health.status}
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className={`text-xs font-mono whitespace-nowrap overflow-hidden ${cfg.colorClass}`}
                >
                  {health.status === 'online'
                    ? `Node ${health.latencyMs}ms${health.blockHeight ? ` · #${health.blockHeight.toLocaleString()}` : ''}`
                    : cfg.label}
                </motion.span>
              </AnimatePresence>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-mono space-y-1 p-3 max-w-xs">
          <p className={`font-semibold ${cfg.colorClass}`}>
            {health.status === 'online' ? '✅ Rust Node Online' : health.status === 'checking' ? '⏳ Connecting...' : '❌ Node Offline'}
          </p>
          {health.status === 'online' && (
            <>
              {health.latencyMs != null && (
                <p className="text-muted-foreground">Latency: <span className="text-foreground">{health.latencyMs}ms</span></p>
              )}
              {health.blockHeight != null && (
                <p className="text-muted-foreground">Block: <span className="text-foreground">#{health.blockHeight.toLocaleString()}</span></p>
              )}
              {health.version && (
                <p className="text-muted-foreground">Version: <span className="text-foreground">{health.version}</span></p>
              )}
            </>
          )}
          {health.status === 'offline' && (
            <p className="text-muted-foreground text-[11px]">
              Configurează RUST_NODE_URL în Settings → Secrets pentru nod real.
            </p>
          )}
          {health.lastChecked && (
            <p className="text-muted-foreground/60 text-[10px]">
              Verificat la {health.lastChecked.toLocaleTimeString()}
            </p>
          )}
          <p className="text-muted-foreground/60 text-[10px]">Click pentru a reîncerca</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default NodeStatusBadge;
