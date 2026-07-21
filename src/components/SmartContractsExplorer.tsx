import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Code2, ChevronDown, ChevronUp, Loader2, Upload, Play, Info, Zap } from 'lucide-react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAddress } from '@/utils/blockchain-generator';
import { toast } from '@/hooks/use-toast';

interface SmartContract {
  id: string;
  address: string;
  name: string;
  deployer_address: string;
  contract_type: string;
  status: string;
  version: string;
  interactions_count: number;
  source_code: string | null;
  deployed_at: string;
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

const SAMPLE_SOURCE = `// HSMC Smart Contract — Privacy Token
pragma hsmc ^2.0;

contract PrivacyToken {
  mapping(address => uint256) private balances;
  uint256 public totalSupply;
  string public name = "HSMC Token";
  
  event Transfer(address indexed from, address indexed to, uint256 amount);
  
  function transfer(address to, uint256 amount) public returns (bool) {
    require(balances[msg.sender] >= amount, "Insufficient balance");
    balances[msg.sender] -= amount;
    balances[to] += amount;
    emit Transfer(msg.sender, to, amount);
    return true;
  }
  
  function balanceOf(address owner) public view returns (uint256) {
    return balances[owner];
  }
}`;

export const SmartContractsExplorer = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [contracts, setContracts] = useState<SmartContract[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<Record<string, ContractInteraction[]>>({});
  const [loading, setLoading] = useState(true);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [calling, setCalling] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contract_type: 'token', source_code: SAMPLE_SOURCE });

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('smart_contracts')
        .select('*')
        .order('deployed_at', { ascending: false });
      if (data) setContracts(data as SmartContract[]);
      setLoading(false);
    };
    fetch();

    const channel = supabase
      .channel('contracts-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'smart_contracts' }, (payload) => {
        setContracts(prev => [payload.new as SmartContract, ...prev]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'smart_contracts' }, (payload) => {
        setContracts(prev => prev.map(c => c.id === payload.new.id ? payload.new as SmartContract : c));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchInteractions = async (contractId: string) => {
    if (interactions[contractId]) return;
    const { data } = await supabase
      .from('contract_interactions')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setInteractions(prev => ({ ...prev, [contractId]: data as ContractInteraction[] }));
  };

  const handleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      fetchInteractions(id);
    }
  };

  // Read user's configured Rust node URL from Settings Hub
  const getUserRustNodeUrl = async (): Promise<string | null> => {
    if (!user) return null;
    const { data } = await supabase
      .from('user_settings')
      .select('setting_value')
      .eq('user_id', user.id)
      .eq('setting_key', 'rust_node_url')
      .maybeSingle();
    const v = data?.setting_value?.trim();
    return (v && /^https?:\/\//.test(v)) ? v : null;
  };

  const handleDeploy = async () => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }
    if (!form.name.trim()) {
      toast({ title: 'Contract name required', variant: 'destructive' });
      return;
    }
    setDeploying(true);
    try {
      const rustUrl = await getUserRustNodeUrl();
      if (!rustUrl) {
        toast({
          title: 'Rust node required',
          description: 'Smart contract deployment requires a real Rust node. Configure rust_node_url in Settings → Node.',
          variant: 'destructive',
        });
        setDeploying(false);
        return;
      }
      // Real on-chain deploy via Rust node
      const resp = await fetch(`${rustUrl}/contracts/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployer_address: wallet.address,
          name: form.name.trim(),
          contract_type: form.contract_type,
          source_code: form.source_code,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        toast({ title: 'Deploy failed at node', description: `${resp.status}: ${errText}`, variant: 'destructive' });
        setDeploying(false);
        return;
      }
      const result = await resp.json();
      // Persist deployed contract returned by node (real address + bytecode)
      const { error } = await supabase.from('smart_contracts').insert({
        address: result.address,
        name: form.name.trim(),
        deployer_address: wallet.address,
        user_id: user.id,
        contract_type: form.contract_type,
        source_code: form.source_code,
        bytecode: result.bytecode ?? null,
        abi: result.abi ?? null,
        status: 'active',
      });
      if (error) {
        toast({ title: 'DB insert failed', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Contract deployed on-chain', description: `Address: ${formatAddress(result.address, 10)}` });
        setShowDeploy(false);
        setForm({ name: '', contract_type: 'token', source_code: SAMPLE_SOURCE });
      }
    } catch (err: unknown) {
      toast({ title: 'Network error', description: String(err), variant: 'destructive' });
    } finally {
      setDeploying(false);
    }
  };

  const handleCall = async (contractId: string, fnName: string) => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }
    setCalling(contractId + fnName);

    const rustUrl = await getUserRustNodeUrl();
    if (!rustUrl) {
      toast({
        title: 'Rust node required',
        description: 'Contract calls require a real Rust node. Configure rust_node_url in Settings → Node.',
        variant: 'destructive',
      });
      setCalling(null);
      return;
    }

    const contract = contracts.find(c => c.id === contractId);
    if (!contract) { setCalling(null); return; }

    // Real on-chain call — node returns real tx hash and gas used
    let callResult: { tx_hash: string; gas_used: number; status: string } | null = null;
    try {
      const resp = await fetch(`${rustUrl}/contracts/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_address: contract.address,
          caller_address: wallet.address,
          function: fnName,
          args: [],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        toast({ title: 'Call failed at node', description: `${resp.status}: ${errText}`, variant: 'destructive' });
        setCalling(null);
        return;
      }
      callResult = await resp.json();
    } catch (err: unknown) {
      toast({ title: 'Network error', description: String(err), variant: 'destructive' });
      setCalling(null);
      return;
    }
    if (!callResult?.tx_hash) {
      toast({ title: 'Node returned no tx_hash', variant: 'destructive' });
      setCalling(null);
      return;
    }
    const { tx_hash: txHash, gas_used: gasUsed } = callResult;

    // Record contract interaction in DB
    const { error: interactionError } = await supabase.from('contract_interactions').insert({
      contract_id: contractId,
      function_name: fnName,
      caller_address: wallet.address,
      tx_hash: txHash,
      status: callResult.status ?? 'success',
      gas_used: gasUsed,
    });

    if (interactionError) {
      toast({ title: 'Call failed', description: interactionError.message, variant: 'destructive' });
      setCalling(null);
      return;
    }

    // Contract interactions are recorded only in contract_interactions table — NOT as 0-amount transactions

    toast({ title: `${fnName}() called!`, description: `Tx: ${formatAddress(txHash, 8)} | Gas: ${gasUsed.toLocaleString()}` });

    // Increment interactions count
    await supabase.from('smart_contracts').update({ interactions_count: contract.interactions_count + 1 }).eq('id', contractId);

    // Refresh interactions list
    const { data } = await supabase
      .from('contract_interactions')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setInteractions(prev => ({ ...prev, [contractId]: data as ContractInteraction[] }));
    setCalling(null);
  };

  const PUBLIC_FUNCTIONS: Record<string, string[]> = {
    token: ['transfer()', 'balanceOf()', 'approve()', 'totalSupply()'],
    defi: ['swap()', 'addLiquidity()', 'removeLiquidity()', 'getPrice()'],
    nft: ['mint()', 'transfer()', 'ownerOf()', 'tokenURI()'],
    custom: ['execute()', 'query()', 'update()'],
  };

  return (
    <section id="contracts" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Smart <span className="gradient-text">Contracts</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Deploy and interact with smart contracts on the HSMC chain — privacy-preserving execution environment
          </p>
        </motion.div>

        <div className="flex justify-end mb-6">
          <Button variant="hero" size="sm" className="gap-2" onClick={() => setShowDeploy(!showDeploy)}>
            <Upload className="w-4 h-4" />
            Deploy Contract
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
                <Code2 className="w-5 h-5 text-primary" />
                Deploy New Contract
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Contract Name</label>
                    <Input placeholder="e.g. PrivacyToken" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Type</label>
                    <select
                      className="w-full bg-muted/20 border border-border rounded-lg p-2 text-sm outline-none"
                      value={form.contract_type}
                      onChange={e => setForm(f => ({ ...f, contract_type: e.target.value }))}
                    >
                      <option value="token">Token</option>
                      <option value="defi">DeFi</option>
                      <option value="nft">NFT</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Source Code (HSMC pragma)</label>
                  <textarea
                    className="w-full bg-black/50 border border-border rounded-lg p-3 font-mono text-xs outline-none focus:border-primary/50 resize-none"
                    rows={8}
                    value={form.source_code}
                    onChange={e => setForm(f => ({ ...f, source_code: e.target.value }))}
                  />
                </div>
                <div className="flex gap-3">
                  <Button variant="hero" onClick={handleDeploy} disabled={deploying} className="gap-2">
                    {deploying && <Loader2 className="w-4 h-4 animate-spin" />}
                    Deploy
                  </Button>
                  <Button variant="outline" onClick={() => setShowDeploy(false)}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : contracts.length === 0 ? (
          <div className="glass-panel text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
            <Info className="w-10 h-10 text-muted-foreground/40" />
            <p>No smart contracts deployed yet.</p>
            <p className="text-xs">Deploy the first contract on the HSMC chain.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {contracts.map((contract, idx) => {
              const isExp = expanded === contract.id;
              const fns = PUBLIC_FUNCTIONS[contract.contract_type] || PUBLIC_FUNCTIONS.custom;
              return (
                <motion.div
                  key={contract.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.05 }}
                  className="glass-card overflow-hidden"
                >
                  <button
                    onClick={() => handleExpand(contract.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Code2 className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold">{contract.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{formatAddress(contract.address, 10)}</div>
                      </div>
                      <span className="px-2 py-0.5 text-xs rounded border border-border text-muted-foreground">
                        {contract.contract_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs">
                        <div className="font-medium">{contract.interactions_count}</div>
                        <div className="text-muted-foreground">calls</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{timeAgo(contract.deployed_at)}</div>
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
                          {/* Source Code */}
                          <div>
                            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Source Code</h4>
                            <pre className="bg-black/50 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 text-secondary/90 custom-scrollbar">
                              {contract.source_code || '// Source not available'}
                            </pre>

                            {/* Public Functions */}
                            <h4 className="text-sm font-medium mt-3 mb-2 text-muted-foreground">Public Functions</h4>
                            <div className="flex flex-wrap gap-2">
                              {fns.map(fn => (
                                <Button
                                  key={fn}
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1 border-primary/30 text-primary"
                                  onClick={() => handleCall(contract.id, fn.replace('()', ''))}
                                  disabled={calling === contract.id + fn.replace('()', '')}
                                >
                                  {calling === contract.id + fn.replace('()', '') ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Play className="w-3 h-3" />
                                  )}
                                  {fn}
                                </Button>
                              ))}
                            </div>
                          </div>

                          {/* Recent Interactions */}
                          <div>
                            <h4 className="text-sm font-medium mb-2 text-muted-foreground flex items-center gap-1">
                              <Zap className="w-3 h-3" /> Recent Interactions
                            </h4>
                            <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                              {(interactions[contract.id] || []).length === 0 ? (
                                <p className="text-xs text-muted-foreground py-4 text-center">No interactions yet</p>
                              ) : (
                                interactions[contract.id].map(ix => (
                                  <div key={ix.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
                                    <div>
                                      <span className="font-mono text-primary">{ix.function_name}()</span>
                                      <span className="text-muted-foreground ml-2">by {formatAddress(ix.caller_address, 6)}</span>
                                    </div>
                                    <div className="text-right text-muted-foreground">
                                      <div>{ix.gas_used.toLocaleString()} gas</div>
                                      <div>{timeAgo(ix.created_at)}</div>
                                    </div>
                                  </div>
                                ))
                              )}
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
