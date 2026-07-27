import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Code2, ChevronDown, ChevronUp, Loader2, Upload, Play, Info, Zap, Trash2, Cpu } from 'lucide-react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAddress } from '@/utils/blockchain-generator';
import { toast } from '@/hooks/use-toast';

interface OnChainContract {
  address: string;
  owner: string;
  code_hash: string;
  bytecode_len: number;
  deployment_block: number;
  call_count: number;
  state_root: string;
  state_entries?: number;
  name?: string;
}

interface ContractInteraction {
  id: string;
  function_name: string;
  caller_address: string;
  tx_hash: string;
  status: string;
  gas_used: number;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SAMPLE_WASM_HEX =
  '0061736d01000000010c0260037f7f7f017f60027f7f017f021a0103656e760e686' +
  '736d635f6b656363616b3235360000030201010503010001071302066d656d6f72790' +
  '20009746573745f6861736800010a0b0109002000200141800210000b';

export const SmartContractsExplorer = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [contracts, setContracts] = useState<OnChainContract[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<Record<string, ContractInteraction[]>>({});
  const [loading, setLoading] = useState(true);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [calling, setCalling] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    bytecode_hex: '',
    deployer_address: '',
  });
  const [callForm, setCallForm] = useState({
    contract_address: '',
    function_name: '',
    args_hex: '',
    gas_limit: '',
  });

  // Read user's configured Rust node URL
  const getRustNodeUrl = async (): Promise<string | null> => {
    if (!user) return null;
    const { data } = await supabase
      .from('user_settings')
      .select('setting_value')
      .eq('user_id', user.id)
      .eq('setting_key', 'rust_node_url')
      .maybeSingle();
    const v = data?.setting_value?.trim();
    return v && /^https?:\/\//.test(v) ? v : null;
  };

  // Fetch on-chain contracts from Rust node VM
  const fetchContracts = async () => {
    setLoading(true);
    const rustUrl = await getRustNodeUrl();
    if (!rustUrl) {
      setLoading(false);
      return;
    }
    try {
      const resp = await fetch(`${rustUrl}/vm/contracts`);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      if (data.contracts) {
        setContracts(data.contracts as OnChainContract[]);
      }
    } catch {
      // Node may not be available — that's OK
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchContracts();

    // Real-time: poll every 15 seconds while visible
    const interval = setInterval(fetchContracts, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const handleDeploy = async () => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }
    const bytecodeHex = form.bytecode_hex.trim() || SAMPLE_WASM_HEX;
    if (!bytecodeHex) {
      toast({ title: 'Bytecode required', variant: 'destructive' });
      return;
    }
    setDeploying(true);
    try {
      const rustUrl = await getRustNodeUrl();
      if (!rustUrl) {
        toast({
          title: 'Rust node required',
          description: 'Configure rust_node_url in Settings → Node.',
          variant: 'destructive',
        });
        setDeploying(false);
        return;
      }

      const resp = await fetch(`${rustUrl}/vm/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployer_address: wallet.address,
          bytecode_hex: bytecodeHex,
          name: form.name.trim() || 'unnamed',
        }),
      });
      const result = await resp.json();
      if (!resp.ok || result.error) {
        toast({
          title: 'Deploy failed',
          description: result.error || `${resp.status}`,
          variant: 'destructive',
        });
        setDeploying(false);
        return;
      }

      toast({
        title: 'Contract deployed!',
        description: `Address: ${formatAddress(result.contract_address, 10)} | ${result.bytecode_len} bytes`,
      });

      // Refresh contract list
      await fetchContracts();
      setShowDeploy(false);
      setForm({ name: '', bytecode_hex: '', deployer_address: '' });
    } catch (err: unknown) {
      toast({ title: 'Network error', description: String(err), variant: 'destructive' });
    } finally {
      setDeploying(false);
    }
  };

  const handleCall = async (contractAddress: string, fnName: string) => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }
    setCalling(contractAddress + fnName);
    const rustUrl = await getRustNodeUrl();
    if (!rustUrl) {
      toast({
        title: 'Rust node required',
        description: 'Configure rust_node_url in Settings → Node.',
        variant: 'destructive',
      });
      setCalling(null);
      return;
    }

    try {
      const resp = await fetch(`${rustUrl}/vm/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_address: contractAddress,
          caller_address: wallet.address,
          function_name: fnName,
          args_hex: '',
          gas_limit: 2_000_000,
        }),
      });
      const result = await resp.json();
      if (!resp.ok || result.error) {
        toast({
          title: 'Call failed',
          description: result.error || `${resp.status}`,
          variant: 'destructive',
        });
        setCalling(null);
        return;
      }

      toast({
        title: `${fnName}() executed!`,
        description: `Gas: ${result.gas_used?.toLocaleString() || 'N/A'} | Events: ${result.events_count || 0}`,
      });

      // Refresh to get updated call counts
      await fetchContracts();
    } catch (err: unknown) {
      toast({ title: 'Network error', description: String(err), variant: 'destructive' });
    } finally {
      setCalling(null);
    }
  };

  const handleGasEstimate = async () => {
    const addr = callForm.contract_address.trim();
    const fn = callForm.function_name.trim();
    if (!addr || !fn) {
      toast({ title: 'Address and function name required', variant: 'destructive' });
      return;
    }
    setEstimating(true);
    setGasEstimate(null);
    const rustUrl = await getRustNodeUrl();
    if (!rustUrl) {
      toast({ title: 'Rust node required', variant: 'destructive' });
      setEstimating(false);
      return;
    }

    try {
      const resp = await fetch(`${rustUrl}/vm/gas-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_address: addr,
          function_name: fn,
          args_hex: callForm.args_hex || '',
        }),
      });
      const result = await resp.json();
      if (!resp.ok || result.error) {
        toast({ title: 'Estimate failed', description: result.error, variant: 'destructive' });
        setEstimating(false);
        return;
      }
      setGasEstimate(result.estimated_gas);
      toast({ title: `Estimated gas: ${result.estimated_gas?.toLocaleString()}` });
    } catch (err: unknown) {
      toast({ title: 'Network error', description: String(err), variant: 'destructive' });
    } finally {
      setEstimating(false);
    }
  };

  const PUBLIC_FUNCTIONS: Record<string, string[]> = {
    token: ['transfer', 'balanceOf', 'approve', 'totalSupply'],
    defi: ['swap', 'addLiquidity', 'removeLiquidity', 'getPrice'],
    nft: ['mint', 'transfer', 'ownerOf', 'tokenURI'],
    custom: ['run', 'test_hash', 'roundtrip', 'loop_forever'],
  };

  return (
    <section id="contracts" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            WASM Smart <span className="gradient-text">Contracts</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Deploy and execute WebAssembly smart contracts on the HSMC VM — real bytecode execution, gas metering, and state isolation via wasmtime
          </p>
        </motion.div>

        <div className="flex flex-wrap justify-end gap-3 mb-6">
          <Button variant="hero" size="sm" className="gap-2" onClick={() => setShowDeploy(!showDeploy)}>
            <Upload className="w-4 h-4" />
            Deploy WASM Contract
          </Button>
        </div>

        {/* Deploy Form */}
        <AnimatePresence>
          {showDeploy && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="glass-panel mb-6"
            >
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-primary" />
                Deploy WASM Contract
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Contract Name</label>
                  <Input
                    placeholder="e.g. PrivacyToken"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">
                    WASM Bytecode (hex-encoded)
                  </label>
                  <textarea
                    className="w-full bg-black/50 border border-border rounded-lg p-3 font-mono text-xs outline-none focus:border-primary/50 resize-none"
                    rows={6}
                    placeholder={SAMPLE_WASM_HEX}
                    value={form.bytecode_hex}
                    onChange={e => setForm(f => ({ ...f, bytecode_hex: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Paste hex-encoded <code>.wasm</code> binary. Leave blank to deploy the sample contract.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="hero" onClick={handleDeploy} disabled={deploying} className="gap-2">
                    {deploying && <Loader2 className="w-4 h-4 animate-spin" />}
                    Deploy to VM
                  </Button>
                  <Button variant="outline" onClick={() => setShowDeploy(false)}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gas Estimator */}
        <div className="glass-panel mb-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-primary" />
            Gas Estimator
          </h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Contract Address</label>
              <Input
                placeholder="0x..."
                className="font-mono text-xs"
                value={callForm.contract_address}
                onChange={e => setCallForm(f => ({ ...f, contract_address: e.target.value }))}
              />
            </div>
            <div className="w-40">
              <label className="text-xs text-muted-foreground mb-1 block">Function</label>
              <Input
                placeholder="run"
                value={callForm.function_name}
                onChange={e => setCallForm(f => ({ ...f, function_name: e.target.value }))}
              />
            </div>
            <div className="w-32">
              <label className="text-xs text-muted-foreground mb-1 block">Args (hex)</label>
              <Input
                placeholder="optional"
                className="font-mono text-xs"
                value={callForm.args_hex}
                onChange={e => setCallForm(f => ({ ...f, args_hex: e.target.value }))}
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleGasEstimate} disabled={estimating}>
              {estimating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Estimate'}
            </Button>
            {gasEstimate !== null && (
              <span className="text-sm text-green-400 font-mono">
                ~{gasEstimate.toLocaleString()} gas
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : contracts.length === 0 ? (
          <div className="glass-panel text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
            <Cpu className="w-10 h-10 text-muted-foreground/40" />
            <p>No WASM contracts deployed yet.</p>
            <p className="text-xs">Deploy the first contract on the HSMC VM.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {contracts.map((contract, idx) => {
              const isExp = expanded === contract.address;
              const fns = PUBLIC_FUNCTIONS.custom;
              return (
                <motion.div
                  key={contract.address}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.05 }}
                  className="glass-card overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(isExp ? null : contract.address)}
                    className="w-full p-4 flex items-center justify-between hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Cpu className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold">{contract.name || 'WASM Contract'}</div>
                        <div className="font-mono text-xs text-muted-foreground">{formatAddress(contract.address, 10)}</div>
                      </div>
                      <span className="px-2 py-0.5 text-xs rounded border border-primary/30 text-primary">
                        WASM
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs">
                        <div className="font-medium">{contract.call_count}</div>
                        <div className="text-muted-foreground">calls</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {contract.bytecode_len.toLocaleString()} bytes
                      </div>
                      {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExp && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-border"
                      >
                        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Contract Info */}
                          <div>
                            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Contract Info</h4>
                            <div className="space-y-2 text-xs font-mono">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Address:</span>
                                <span className="text-primary">{formatAddress(contract.address, 12)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Owner:</span>
                                <span>{formatAddress(contract.owner, 8)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Code Hash:</span>
                                <span>{formatAddress(contract.code_hash, 8)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Size:</span>
                                <span>{contract.bytecode_len.toLocaleString()} bytes</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Deployed:</span>
                                <span>Block #{contract.deployment_block}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Calls:</span>
                                <span>{contract.call_count}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">State Root:</span>
                                <span>{formatAddress(contract.state_root, 6)}</span>
                              </div>
                              {contract.state_entries !== undefined && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">State Entries:</span>
                                  <span>{contract.state_entries}</span>
                                </div>
                              )}
                            </div>

                            {/* Call Functions */}
                            <h4 className="text-sm font-medium mt-3 mb-2 text-muted-foreground">Execute Function</h4>
                            <div className="flex flex-wrap gap-2">
                              {fns.map(fn => (
                                <Button
                                  key={fn}
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1 border-primary/30 text-primary"
                                  onClick={() => handleCall(contract.address, fn)}
                                  disabled={calling === contract.address + fn}
                                >
                                  {calling === contract.address + fn ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Play className="w-3 h-3" />
                                  )}
                                  {fn}()
                                </Button>
                              ))}
                            </div>
                          </div>

                          {/* State & Events */}
                          <div>
                            <h4 className="text-sm font-medium mb-2 text-muted-foreground flex items-center gap-1">
                              <Info className="w-3 h-3" /> VM Info
                            </h4>
                            <div className="space-y-2 text-xs text-muted-foreground">
                              <p>This contract runs on the <strong>HSMC WASM VM</strong> powered by <code>wasmtime</code>.</p>
                              <ul className="list-disc list-inside space-y-1">
                                <li>Gas-metered execution (fuel = gas)</li>
                                <li>Up to 16 MB contract memory</li>
                                <li>Isolated key-value state store</li>
                                <li>Host functions: keccak256, sha512, state read/write</li>
                                <li>Atomic execution (all or nothing)</li>
                              </ul>
                              <div className="mt-3 p-2 bg-black/30 rounded text-xs font-mono">
                                <div className="text-green-400">// Deploy WASM via CLI:</div>
                                <div>curl -X POST {'{node}'}/vm/deploy \</div>
                                <div>  -d {'{"bytecode_hex":"0061...","deployer_address":"HSMC_..."}'}</div>
                                <div className="mt-1 text-green-400">// Call:</div>
                                <div>curl -X POST {'{node}'}/vm/call \</div>
                                <div>  -d {'{"contract_address":"0x...","function_name":"run"}'}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default SmartContractsExplorer;
