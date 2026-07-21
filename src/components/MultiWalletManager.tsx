import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Check, Star, ArrowLeftRight,
  Loader2, ChevronDown, Eye, EyeOff, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMultiWallet } from '@/hooks/useMultiWallet';
import { formatAddress } from '@/utils/blockchain-generator';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const MultiWalletManager = ({ isOpen, onClose }: Props) => {
  const { wallets, activeWalletId, switchWallet, createWallet, setPrimary, internalTransfer, loading } = useMultiWallet();
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!newLabel || newPassword.length < 8) return;
    setIsCreating(true);
    const wallet = await createWallet(newLabel, newPassword);
    if (wallet) {
      setCreating(false);
      setNewLabel('');
      setNewPassword('');
      switchWallet(wallet.id);
    }
    setIsCreating(false);
  };

  const handleTransfer = async () => {
    if (!fromId || !toId || !transferAmount) return;
    setTransferring(true);
    const ok = await internalTransfer(fromId, toId, parseFloat(transferAmount), transferNote);
    if (ok) {
      setShowTransfer(false);
      setTransferAmount('');
      setTransferNote('');
    }
    setTransferring(false);
  };

  const fromWallet = wallets.find(w => w.id === fromId);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <Wallet className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-bold">Multi-Wallet Manager</h2>
                <p className="text-xs text-muted-foreground">{wallets.length} wallet{wallets.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            {/* Wallet List */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-2">
                {wallets.map(wallet => (
                  <div
                    key={wallet.id}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      activeWalletId === wallet.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 bg-muted/10'
                    }`}
                    onClick={() => { switchWallet(wallet.id); }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                          wallet.is_primary ? 'bg-primary/15' : 'bg-muted/30'
                        }`}>
                          <Wallet className={`w-4 h-4 ${wallet.is_primary ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{wallet.label}</span>
                            {wallet.is_primary && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">Primary</span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">{formatAddress(wallet.address, 8)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-mono font-bold text-sm">{wallet.balance.toFixed(4)}</div>
                          <div className="text-[10px] text-muted-foreground">HSMC</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {activeWalletId === wallet.id && (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                              <Check className="w-3 h-3 text-primary-foreground" />
                            </div>
                          )}
                          {!wallet.is_primary && (
                            <button
                              onClick={e => { e.stopPropagation(); setPrimary(wallet.id); }}
                              className="p-1 hover:bg-muted rounded transition-colors"
                              title="Set as primary"
                            >
                              <Star className="w-3 h-3 text-muted-foreground hover:text-yellow-400" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-2"
                onClick={() => setCreating(!creating)}
              >
                <Plus className="w-4 h-4" /> New Wallet
              </Button>
              {wallets.length >= 2 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={() => {
                    setShowTransfer(!showTransfer);
                    setFromId(wallets.find(w => w.id === activeWalletId)?.id || wallets[0].id);
                    setToId(wallets.find(w => w.id !== activeWalletId)?.id || wallets[1].id);
                  }}
                >
                  <ArrowLeftRight className="w-4 h-4" /> Transfer
                </Button>
              )}
            </div>

            {/* Create Wallet Form */}
            <AnimatePresence>
              {creating && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 bg-muted/20 rounded-xl border border-border space-y-3"
                >
                  <h4 className="font-semibold text-sm">Create New Wallet</h4>
                  <Input
                    placeholder="Wallet name (e.g. Savings, Trading)"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                  />
                  <div className="relative">
                    <Input
                      type={showPw ? 'text' : 'password'}
                      placeholder="Encryption password (min 8 chars)"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      {showPw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">A new BIP39 seed phrase will be generated and encrypted for this wallet.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCreating(false)} className="flex-1">Cancel</Button>
                    <Button
                      variant="hero"
                      size="sm"
                      className="flex-1"
                      disabled={!newLabel || newPassword.length < 8 || isCreating}
                      onClick={handleCreate}
                    >
                      {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                      Create
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Internal Transfer Form */}
            <AnimatePresence>
              {showTransfer && wallets.length >= 2 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 bg-muted/20 rounded-xl border border-border space-y-3"
                >
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-primary" />
                    Internal Transfer
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-secondary/15 text-secondary border border-secondary/20">Zero Fee</span>
                  </h4>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">From</label>
                    <select
                      value={fromId}
                      onChange={e => setFromId(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    >
                      {wallets.map(w => (
                        <option key={w.id} value={w.id}>{w.label} ({w.balance.toFixed(4)} HSMC)</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">To</label>
                    <select
                      value={toId}
                      onChange={e => setToId(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    >
                      {wallets.filter(w => w.id !== fromId).map(w => (
                        <option key={w.id} value={w.id}>{w.label} ({w.balance.toFixed(4)} HSMC)</option>
                      ))}
                    </select>
                  </div>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={transferAmount}
                      onChange={e => setTransferAmount(e.target.value)}
                      className="font-mono pr-16"
                    />
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium"
                      onClick={() => fromWallet && setTransferAmount(fromWallet.balance.toString())}
                    >
                      MAX
                    </button>
                  </div>
                  <Input
                    placeholder="Note (optional)"
                    value={transferNote}
                    onChange={e => setTransferNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowTransfer(false)} className="flex-1">Cancel</Button>
                    <Button
                      variant="hero"
                      size="sm"
                      className="flex-1"
                      disabled={!fromId || !toId || !transferAmount || fromId === toId || transferring}
                      onClick={handleTransfer}
                    >
                      {transferring ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                      Transfer
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MultiWalletManager;
