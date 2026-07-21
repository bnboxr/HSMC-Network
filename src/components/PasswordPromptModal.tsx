/**
 * PasswordPromptModal — secure in-memory password entry for seed decryption.
 *
 * Replaces prompt() dialogs (C9) and sessionStorage password storage (C7).
 * Password stays in a React ref — never persisted to disk/sessionStorage/localStorage.
 * Rate-limited: max 3 attempts, then locked for 30 seconds.
 */
import { motion } from 'framer-motion';
import { Lock, ShieldAlert, X, Loader2, AlertOctagon } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PasswordPromptModalProps {
  isOpen: boolean;
  title?: string;
  description?: string;
  onPassword: (password: string) => Promise<boolean>; // returns true if password was correct
  onCancel: () => void;
}

const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

export const PasswordPromptModal = ({
  isOpen,
  title = 'Enter Password',
  description = 'Enter your wallet password to proceed.',
  onPassword,
  onCancel,
}: PasswordPromptModalProps) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remainingLockSeconds, setRemainingLockSeconds] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError('');
      setLoading(false);
      // Don't reset attempts — they persist across modal re-opens for rate limiting
      if (lockedUntil === null) {
        // Focus input after render
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
    return () => { mountedRef.current = false; };
  }, [isOpen]);

  // Lockout countdown
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setRemainingLockSeconds(0);
        setAttempts(0);
        setError('');
      } else {
        setRemainingLockSeconds(remaining);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const handleSubmit = useCallback(async () => {
    if (!password || loading || lockedUntil !== null) return;

    setLoading(true);
    setError('');

    try {
      const success = await onPassword(password);
      if (success) {
        // Password correct — reset attempts, clear state, close is handled by parent
        setAttempts(0);
        setPassword('');
      } else {
        // Wrong password
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          setError(`Too many attempts. Locked for ${LOCKOUT_SECONDS} seconds.`);
        } else {
          setError(`Wrong password. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} remaining.`);
        }
        setPassword('');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Decryption failed');
      setPassword('');
    } finally {
      setLoading(false);
    }
  }, [password, loading, lockedUntil, attempts, onPassword]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const isLocked = lockedUntil !== null;

  return (
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isLocked ? 'bg-destructive/20' : 'bg-primary/20'}`}>
              {isLocked ? (
                <AlertOctagon className="w-4 h-4 text-destructive" />
              ) : (
                <Lock className="w-4 h-4 text-primary" />
              )}
            </div>
            <div>
              <h2 className="font-bold">{title}</h2>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-muted rounded-lg transition-colors" type="button">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {isLocked ? (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
              <AlertOctagon className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-destructive">Rate limit exceeded</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Too many incorrect attempts. Please wait {remainingLockSeconds} seconds before trying again.
                </p>
              </div>
            </div>
          ) : (
            <>
              {attempts > 0 && (
                <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                  <ShieldAlert className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-destructive font-medium">
                      {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts === 1 ? '' : 's'} remaining
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Your wallet will be temporarily locked after {MAX_ATTEMPTS} failed attempts.
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  {error}
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-2 block">Wallet Password</label>
                <Input
                  ref={inputRef}
                  type="password"
                  placeholder="Enter your wallet password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="off"
                  disabled={loading}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Your password is never stored on disk or sent over the network.
                </p>
              </div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onCancel} type="button">
              Cancel
            </Button>
            <Button
              variant="hero"
              className="flex-1"
              onClick={handleSubmit}
              disabled={!password || loading || isLocked}
              type="button"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Lock className="w-4 h-4 mr-1" />
              )}
              {isLocked ? `Wait ${remainingLockSeconds}s` : 'Unlock'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PasswordPromptModal;
