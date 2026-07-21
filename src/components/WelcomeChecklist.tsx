/**
 * WelcomeChecklist — post-onboarding action guide
 * Persisted in localStorage; hidden once all steps are completed & dismissed
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, X, Zap, ArrowUpDown, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface CheckItem {
  id: string;
  label: string;
  description: string;
  icon: typeof Zap;
  href: string;
}

const ITEMS: CheckItem[] = [
  {
    id: 'stake',
    label: 'Stake HSMC',
    description: 'Earn rewards by staking tokens in a validator pool',
    icon: Zap,
    href: '#staking',
  },
  {
    id: 'swap',
    label: 'Make a swap',
    description: 'Exchange HSMC for another token on the DEX',
    icon: ArrowUpDown,
    href: '#swap',
  },
  {
    id: 'explore',
    label: 'Explore the blockchain',
    description: 'View live blocks and transactions in the Explorer',
    icon: Search,
    href: '#explorer',
  },
];

function storageKey(userId: string) {
  return `hsmc_welcome_checklist_${userId}`;
}

function loadState(userId: string): { completed: string[]; dismissed: boolean } {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { completed: [], dismissed: false };
}

function saveState(userId: string, state: { completed: string[]; dismissed: boolean }) {
  localStorage.setItem(storageKey(userId), JSON.stringify(state));
}

export const WelcomeChecklist = () => {
  const { user } = useAuth();
  const [completed, setCompleted] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!user) return;
    const state = loadState(user.id);
    setCompleted(state.completed);
    setDismissed(state.dismissed);
  }, [user]);

  if (!user || dismissed) return null;

  const allDone = ITEMS.every(item => completed.includes(item.id));
  const doneCount = completed.length;

  const toggleDone = (id: string) => {
    if (!user) return;
    const next = completed.includes(id)
      ? completed.filter(c => c !== id)
      : [...completed, id];
    setCompleted(next);
    saveState(user.id, { completed: next, dismissed });
  };

  const handleDismiss = () => {
    if (!user) return;
    setDismissed(true);
    saveState(user.id, { completed, dismissed: true });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        className="mb-6"
      >
        <div className="glass-panel border border-primary/20 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                {allDone
                  ? <CheckCircle2 className="w-4 h-4 text-secondary" />
                  : <Zap className="w-4 h-4 text-primary" />
                }
              </div>
              <div>
                <p className="text-sm font-bold">
                  {allDone ? '🎉 All steps complete!' : 'Get started with HSMC'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {doneCount}/{ITEMS.length} steps completed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
              <button
                onClick={handleDismiss}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(doneCount / ITEMS.length) * 100}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: allDone ? 'hsl(var(--secondary))' : 'hsl(var(--primary))' }}
            />
          </div>

          {/* Items */}
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-2">
                  {ITEMS.map(item => {
                    const done = completed.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer group ${
                          done
                            ? 'bg-secondary/5 border-secondary/20'
                            : 'bg-muted/20 border-border/30 hover:border-primary/40 hover:bg-primary/5'
                        }`}
                        onClick={() => toggleDone(item.id)}
                      >
                        <div className="shrink-0">
                          {done
                            ? <CheckCircle2 className="w-5 h-5 text-secondary" />
                            : <Circle className="w-5 h-5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium transition-colors ${done ? 'line-through text-muted-foreground' : ''}`}>
                            {item.label}
                          </p>
                          <p className="text-xs text-muted-foreground/60">{item.description}</p>
                        </div>
                        {!done && (
                          <a
                            href={item.href}
                            onClick={e => e.stopPropagation()}
                            className="shrink-0 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                          >
                            Go →
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>

                {allDone && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-center"
                  >
                    <p className="text-xs text-secondary font-medium">
                      You're all set! Explore the full dashboard for more features.
                    </p>
                    <button
                      onClick={handleDismiss}
                      className="mt-2 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      Dismiss checklist
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default WelcomeChecklist;
