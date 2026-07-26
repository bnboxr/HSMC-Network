import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Usb,
  Wallet,
  Loader2,
  AlertTriangle,
  CheckCircle,
  X,
  Copy,
  Check,
  Shield,
  ArrowRight,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  connectHardwareWallet,
  signLedgerTransaction,
  signTrezorTransaction,
  detectHardwareWalletSupport,
  type HardwareWalletType,
  type HardwareWalletConnection,
  type HardwareWalletTransaction,
  type SignedTransaction,
} from '@/utils/hardware-wallet';

// ─── Types ──────────────────────────────────────────────────────────────────────

type ConnectionState =
  | { stage: 'idle' }
  | { stage: 'connecting'; walletType: HardwareWalletType }
  | { stage: 'connected'; connection: HardwareWalletConnection }
  | { stage: 'signing'; connection: HardwareWalletConnection }
  | { stage: 'error'; walletType: HardwareWalletType; message: string };

interface ConnectHardwareWalletProps {
  /** Called when a transaction is successfully signed */
  onSignComplete?: (signed: SignedTransaction) => void;
  /** Called when a wallet connects successfully */
  onConnect?: (connection: HardwareWalletConnection) => void;
  /** Pre-fill transaction details for signing */
  pendingTx?: HardwareWalletTransaction;
  /** Custom derivation path (default: "m/44'/60'/0'/0/0") */
  derivationPath?: string;
  /** Show as inline card instead of dialog trigger */
  inline?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PATH = "m/44'/60'/0'/0/0";

const LEDGER_SETUP_GUIDE_URL = 'https://support.ledger.com/hc/en-us/articles/4404389609489-Connect-your-Ledger-to-a-web-wallet';
const TREZOR_SETUP_GUIDE_URL = 'https://trezor.io/learn/a/trezor-suite-web';

// ─── Component ──────────────────────────────────────────────────────────────────

export const ConnectHardwareWallet: React.FC<ConnectHardwareWalletProps> = ({
  onSignComplete,
  onConnect,
  pendingTx,
  derivationPath,
  inline = false,
}) => {
  const [state, setState] = useState<ConnectionState>({ stage: 'idle' });
  const [selectedType, setSelectedType] = useState<HardwareWalletType>('ledger');
  const [path, setPath] = useState(derivationPath || DEFAULT_PATH);
  const [copied, setCopied] = useState(false);
  const [signingAmount, setSigningAmount] = useState('');
  const [open, setOpen] = useState(false);

  const support = detectHardwareWalletSupport();

  // ── Reset on close ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      // Don't reset if we just signed — keep the connected state visible
      if (state.stage !== 'signing' && state.stage !== 'connected') {
        setState({ stage: 'idle' });
      }
    }
  }, [open]);

  // ── Connect ───────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    setState({ stage: 'connecting', walletType: selectedType });
    try {
      const connection = await connectHardwareWallet(selectedType, path);
      setState({ stage: 'connected', connection });
      onConnect?.(connection);
    } catch (err) {
      setState({
        stage: 'error',
        walletType: selectedType,
        message: err instanceof Error ? err.message : 'Unknown connection error',
      });
    }
  }, [selectedType, path, onConnect]);

  // ── Sign Transaction ──────────────────────────────────────────────────────

  const handleSignTransaction = useCallback(async () => {
    if (state.stage !== 'connected') return;

    const tx: HardwareWalletTransaction = pendingTx || {
      to: '0x0000000000000000000000000000000000000000',
      value: signingAmount ? `0x${BigInt(signingAmount).toString(16)}` : '0x0',
      chainId: 1,
    };

    setState({ stage: 'signing', connection: state.connection });

    try {
      let signed: SignedTransaction;
      if (state.connection.type === 'ledger') {
        signed = await signLedgerTransaction(tx, path);
      } else {
        signed = await signTrezorTransaction(tx, path);
      }
      onSignComplete?.(signed);
      // Stay on connected state but show success implicitly
      setState({ stage: 'connected', connection: state.connection });
    } catch (err) {
      setState({
        stage: 'error',
        walletType: state.connection.type,
        message: err instanceof Error ? err.message : 'Signing failed',
      });
    }
  }, [state, pendingTx, signingAmount, path, onSignComplete]);

  // ── Disconnect ────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(async () => {
    if (state.stage === 'connected' || state.stage === 'signing') {
      await state.connection.disconnect().catch(() => {});
    }
    setState({ stage: 'idle' });
  }, [state]);

  // ── Copy address ──────────────────────────────────────────────────────────

  const handleCopyAddress = useCallback(async () => {
    if (state.stage === 'connected') {
      await navigator.clipboard.writeText(state.connection.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [state]);

  // ── Render: Connection form ───────────────────────────────────────────────

  const renderConnectionForm = () => (
    <div className="space-y-4">
      {/* Wallet type selector */}
      <div className="space-y-2">
        <Label>Hardware Wallet</Label>
        <Select
          value={selectedType}
          onValueChange={(v) => setSelectedType(v as HardwareWalletType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select wallet type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ledger">
              <span className="flex items-center gap-2">
                <Usb className="h-4 w-4" />
                Ledger (Nano S / S Plus / X / Stax)
              </span>
            </SelectItem>
            <SelectItem value="trezor">
              <span className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                Trezor (Model T / Safe 3 / Safe 5)
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        {selectedType === 'ledger' && !support.ledger && (
          <p className="text-xs text-amber-500 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            WebUSB not detected. Use Chrome/Edge/Brave or enable{' '}
            <code className="bg-muted px-1 rounded">dom.webusb.enabled</code> in Firefox.
          </p>
        )}
      </div>

      {/* Derivation path */}
      <div className="space-y-2">
        <Label>Derivation Path</Label>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={DEFAULT_PATH}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          BIP44 path for EVM-compatible address derivation
        </p>
      </div>

      {/* Setup guides */}
      <div className="flex gap-2 text-xs text-muted-foreground">
        <a
          href={selectedType === 'ledger' ? LEDGER_SETUP_GUIDE_URL : TREZOR_SETUP_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-primary transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          {selectedType === 'ledger' ? 'Ledger setup guide' : 'Trezor setup guide'}
        </a>
      </div>

      <Button
        className="w-full"
        onClick={handleConnect}
        disabled={state.stage === 'connecting'}
      >
        {state.stage === 'connecting' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Usb className="mr-2 h-4 w-4" />
            Connect {selectedType === 'ledger' ? 'Ledger' : 'Trezor'}
          </>
        )}
      </Button>
    </div>
  );

  // ── Render: Connected state ───────────────────────────────────────────────

  const renderConnected = () => {
    if (state.stage !== 'connected' && state.stage !== 'signing') return null;

    const { connection } = state;
    const isSigning = state.stage === 'signing';

    return (
      <div className="space-y-4">
        {/* Success banner */}
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-green-600 dark:text-green-400">
              Connected to {connection.deviceModel}
            </p>
            <p className="text-xs text-muted-foreground">
              {connection.type === 'ledger' ? 'Ledger' : 'Trezor'} · {connection.path}
            </p>
          </div>
        </div>

        {/* Address display */}
        <div className="space-y-1.5">
          <Label className="text-xs">Wallet Address</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all font-mono">
              {connection.address}
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopyAddress}
              className="h-8 w-8 flex-shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Transaction signing section */}
        {!pendingTx && (
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Test Sign (optional)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Amount (wei)"
                value={signingAmount}
                onChange={(e) => setSigningAmount(e.target.value)}
                className="font-mono text-sm"
                disabled={isSigning}
              />
              <Button
                variant="outline"
                onClick={handleSignTransaction}
                disabled={isSigning}
                className="flex-shrink-0"
              >
                {isSigning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Sign pending transaction button */}
        {pendingTx && (
          <Button
            className="w-full"
            onClick={handleSignTransaction}
            disabled={isSigning}
          >
            {isSigning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirm on {connection.type === 'ledger' ? 'Ledger' : 'Trezor'}...
              </>
            ) : (
              <>
                <Shield className="mr-2 h-4 w-4" />
                Sign Transaction on Device
              </>
            )}
          </Button>
        )}

        {/* Disconnect */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={handleDisconnect}
          disabled={isSigning}
        >
          <X className="mr-1 h-3 w-3" />
          Disconnect
        </Button>
      </div>
    );
  };

  // ── Render: Error state ───────────────────────────────────────────────────

  const renderError = () => {
    if (state.stage !== 'error') return null;

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-red-600 dark:text-red-400">Connection Failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">{state.message}</p>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 p-3 rounded-md">
          <p className="font-medium">Troubleshooting tips:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {state.walletType === 'ledger' && (
              <>
                <li>Make sure your Ledger is unlocked</li>
                <li>Open the Ethereum app on your Ledger device</li>
                <li>Enable "Blind Signing" in the Ethereum app settings</li>
                <li>Use a Chromium-based browser (Chrome, Edge, Brave)</li>
              </>
            )}
            {state.walletType === 'trezor' && (
              <>
                <li>Make sure Trezor Bridge is installed</li>
                <li>Allow pop-ups for this site</li>
                <li>Unlock your Trezor and enter your PIN</li>
              </>
            )}
          </ul>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setState({ stage: 'idle' })}
        >
          <ArrowRight className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    );
  };

  // ── Render: inline mode ───────────────────────────────────────────────────

  if (inline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Usb className="h-5 w-5" />
            Hardware Wallet
          </CardTitle>
          <CardDescription>
            Connect your Ledger or Trezor hardware wallet
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.stage === 'idle' && renderConnectionForm()}
          {renderConnected()}
          {renderError()}
        </CardContent>
      </Card>
    );
  }

  // ── Render: dialog mode ───────────────────────────────────────────────────

  const hasConnection = state.stage === 'connected' || state.stage === 'signing';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          {hasConnection ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="max-w-[120px] truncate">
                {state.stage === 'connected' && state.connection.address.slice(0, 10)}...
              </span>
            </>
          ) : (
            <>
              <Wallet className="h-4 w-4" />
              Connect Hardware Wallet
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Hardware Wallet
          </DialogTitle>
          <DialogDescription>
            {state.stage === 'idle'
              ? 'Securely connect your hardware wallet to sign transactions'
              : state.stage === 'connected'
                ? 'Your hardware wallet is connected'
                : state.stage === 'signing'
                  ? 'Confirm the transaction on your device'
                  : 'Connection error'}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          <motion.div
            key={state.stage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {state.stage === 'idle' && renderConnectionForm()}
            {renderConnected()}
            {renderError()}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default ConnectHardwareWallet;
