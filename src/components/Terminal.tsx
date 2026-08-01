import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Terminal as TerminalIcon, Maximize2, Minimize2, X, Copy, Check } from 'lucide-react';
import { useBlockchain, DbNetworkStats, DbBlock, DbTransaction } from '@/hooks/useBlockchain';
import { formatNumber, formatAddress, formatRelativeTime } from '@/utils/blockchain-generator';
import { supabase } from '@/integrations/db/client';

interface TerminalEntry {
  input: string;
  output: string;
  timestamp: number;
  type: 'success' | 'error' | 'info' | 'default';
}

// Platform stats type for real uptime data
interface PlatformStats {
  uptime_percent: number;
  developers_count: number;
  tvl: number;
  countries_count: number;
}

// Peer type
interface PeerInfo {
  peer_id: string;
  ip_address: string;
  port: number;
  status: string;
  latency: number;
  version: string;
  region: string;
}

const buildCommands = (platformStats: PlatformStats | null, peers: PeerInfo[]): Record<string, {
  description: string;
  execute: (stats: DbNetworkStats | null, blocks: DbBlock[], transactions: DbTransaction[]) => { output: string; type: TerminalEntry['type'] };
}> => ({
  help: {
    description: 'List all available commands',
    execute: () => ({
      output: `Available commands:
  status      - Display network status
  blocks      - Show recent blocks
  tx          - Show recent transactions
  stats       - Display network statistics
  consensus   - Show current consensus state
  peers       - Show connected peers
  node        - Show current node info
  version     - Display software version
  clear       - Clear terminal
  help        - Show this help message`,
      type: 'info',
    }),
  },
  status: {
    description: 'Display network status',
    execute: (stats) => {
      if (!stats) return { output: 'Error: Unable to fetch network stats — node may be offline', type: 'error' };
      return {
        output: `Network Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Status:       ${stats.consensus_state === 'STABLE' ? 'ONLINE' : 'DEGRADED'}
  TPS:          ${formatNumber(stats.tps)}
  Block Height: ${formatNumber(stats.block_height)}
  Latency:      ${stats.latency}ms
  Hash Rate:    ${stats.hash_rate}
  Consensus:    ${stats.consensus_state}`,
        type: stats.consensus_state === 'STABLE' ? 'success' : 'info',
      };
    },
  },
  blocks: {
    description: 'Show recent blocks',
    execute: (_stats, blocks) => ({
      output: blocks.length === 0
        ? 'No blocks found in database'
        : `Recent Blocks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${blocks
  .slice(0, 5)
  .map(
    (b) =>
      `  #${formatNumber(b.block_number)}  ${b.hash.slice(0, 18)}...  ${b.transactions_count} txns  ${formatRelativeTime(b.created_at)}`
  )
  .join('\n')}`,
      type: 'info',
    }),
  },
  tx: {
    description: 'Show recent transactions',
    execute: (_stats, _blocks, transactions) => ({
      output: transactions.length === 0
        ? 'No transactions found in database'
        : `Recent Transactions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${transactions
  .slice(0, 5)
  .map(
    (t) =>
      `  ${t.hash.slice(0, 18)}...  ${t.amount.toFixed(2)} HSMC  [${t.status}]  ${formatRelativeTime(t.created_at)}`
  )
  .join('\n')}`,
      type: 'info',
    }),
  },
  stats: {
    description: 'Display network statistics',
    execute: (stats) => {
      if (!stats) return { output: 'Error: Unable to fetch network stats', type: 'error' };
      return {
        output: `Network Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Transactions: ${formatNumber(stats.total_transactions)}
  Network Difficulty: ${formatNumber(stats.network_difficulty)}
  Active Nodes:       ${formatNumber(stats.active_nodes)}
  Block Height:       ${formatNumber(stats.block_height)}
  Hash Rate:          ${stats.hash_rate}
  Network Uptime:     ${platformStats ? platformStats.uptime_percent.toFixed(2) + '%' : 'Fetching...'}`,
        type: 'success',
      };
    },
  },
  consensus: {
    description: 'Show current consensus state',
    execute: (stats) => {
      if (!stats) return { output: 'Error: Unable to fetch network stats', type: 'error' };
      return {
        output: `Consensus State: ${stats.consensus_state}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Algorithm:     SHA-256d PoW
  Nodes:         ${formatNumber(stats.active_nodes)}
  Finality:      2 blocks (~24s)
  Current Epoch: ${Math.floor(stats.block_height / 32)}`,
        type: stats.consensus_state === 'STABLE' ? 'success' : 'info',
      };
    },
  },
  peers: {
    description: 'Show connected peers',
    execute: () => {
      if (peers.length === 0) return { output: 'No peers connected', type: 'error' };
      const connected = peers.filter(p => p.status === 'connected');
      const syncing = peers.filter(p => p.status === 'syncing');
      return {
        output: `Network Peers (${peers.length} total)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Connected: ${connected.length}  |  Syncing: ${syncing.length}  |  Disconnected: ${peers.length - connected.length - syncing.length}

${peers.slice(0, 8).map(p => 
  `  ${p.peer_id.padEnd(26)} ${p.ip_address}:${p.port}  [${p.status}]  ${p.latency}ms  ${p.region}`
).join('\n')}`,
        type: 'info',
      };
    },
  },
  node: {
    description: 'Show current node info',
    execute: (stats) => {
      const connectedPeers = peers.filter(p => p.status === 'connected').length;
      const nodeVersion = peers.length > 0 ? peers[0].version : 'v2.1.4';
      return {
        output: `Node Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Node ID:       hsmc-node-primary
  Listen Port:   30303
  Client:        HSMC/${nodeVersion}
  Peers:         ${connectedPeers} connected
  Sync Status:   ${stats?.consensus_state === 'STABLE' ? 'SYNCED' : stats?.consensus_state || 'UNKNOWN'}
  Block Height:  ${stats ? formatNumber(stats.block_height) : 'N/A'}`,
        type: 'info',
      };
    },
  },
  version: {
    description: 'Display software version',
    execute: () => {
      const nodeVersion = peers.length > 0 ? peers[0].version : 'v2.1.4';
      return {
        output: `HSMC ${nodeVersion}
Build: 2026.03.03-stable
Protocol: hsmc/2.0`,
        type: 'info',
      };
    },
  },
});

export const Terminal = () => {
  const [history, setHistory] = useState<TerminalEntry[]>([
    {
      input: '',
      output: `HSMC Terminal v2.1.4
Connected to live network. Type 'help' for available commands.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      timestamp: Date.now(),
      type: 'info',
    },
  ]);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const { networkStats, blocks, transactions } = useBlockchain();

  // Fetch platform stats for uptime
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('platform_stats')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setPlatformStats(data as PlatformStats);
    };
    fetch();
  }, []);

  // Fetch peers for node/peers commands
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('network_peers')
        .select('*')
        .order('latency', { ascending: true });
      if (data) setPeers(data as PeerInfo[]);
    };
    fetch();
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const COMMANDS = buildCommands(platformStats, peers);

  const executeCommand = useCallback((cmd: string) => {
    const trimmedCmd = cmd.trim().toLowerCase();
    if (!trimmedCmd) return;

    if (trimmedCmd === 'clear') {
      setHistory([]);
      return;
    }

    const commands = buildCommands(platformStats, peers);
    const commandFn = commands[trimmedCmd];
    let result: { output: string; type: TerminalEntry['type'] };

    if (commandFn) {
      result = commandFn.execute(networkStats, blocks, transactions);
    } else {
      result = {
        output: `Command not found: ${trimmedCmd}\nType 'help' for available commands.`,
        type: 'error',
      };
    }

    setHistory((prev) => [
      ...prev,
      { input: cmd, output: result.output, timestamp: Date.now(), type: result.type },
    ]);
  }, [networkStats, blocks, transactions, platformStats, peers]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand(input);
      setCommandHistory((prev) => [input, ...prev]);
      setHistoryIndex(-1);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const matches = Object.keys(COMMANDS).filter((c) => c.startsWith(input.toLowerCase()));
      if (matches.length === 1) setInput(matches[0]);
    }
  };

  const copyOutput = () => {
    const output = history.map((h) => h.output).join('\n');
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="terminal" className="py-20 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Embedded <span className="gradient-text">Terminal</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Interact with the network directly through the command line
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className={`mx-auto transition-all duration-300 ${isFullscreen ? 'fixed inset-4 z-50 max-w-none' : 'max-w-4xl'}`}>
          <div className="terminal rounded-xl overflow-hidden border border-border shadow-2xl">
            {/* Terminal Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TerminalIcon className="w-4 h-4" />
                  <span>hsmc@node:~</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={copyOutput} className="p-1.5 hover:bg-muted/50 rounded transition-colors" title="Copy output">
                  {copied ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                </button>
                <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1.5 hover:bg-muted/50 rounded transition-colors">
                  {isFullscreen ? <Minimize2 className="w-4 h-4 text-muted-foreground" /> : <Maximize2 className="w-4 h-4 text-muted-foreground" />}
                </button>
                {isFullscreen && (
                  <button onClick={() => setIsFullscreen(false)} className="p-1.5 hover:bg-muted/50 rounded transition-colors">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Terminal Output */}
            <div ref={outputRef} className={`p-4 overflow-y-auto custom-scrollbar ${isFullscreen ? 'h-[calc(100vh-12rem)]' : 'h-80'}`} onClick={() => inputRef.current?.focus()}>
              {history.map((entry, index) => (
                <div key={index} className="mb-2">
                  {entry.input && (
                    <div className="flex items-center gap-2">
                <span className="terminal-prompt">hsmc@node:~$</span>
                  <span>{entry.input}</span>
                    </div>
                  )}
                  <pre className={`whitespace-pre-wrap text-sm mt-1 ${
                    entry.type === 'error' ? 'terminal-error' : entry.type === 'success' ? 'terminal-success' : entry.type === 'info' ? 'terminal-info' : 'terminal-output'
                  }`}>
                    {entry.output}
                  </pre>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="terminal-prompt">hsmc@node:~$</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent outline-none caret-primary"
                  autoFocus
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Terminal Footer */}
            <div className="px-4 py-2 bg-black/30 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
              <span>Press Tab for autocomplete • ↑↓ for history</span>
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${networkStats?.consensus_state === 'STABLE' ? 'bg-secondary animate-pulse' : 'bg-destructive'}`} />
                {networkStats?.consensus_state === 'STABLE' ? 'Connected to live network' : 'Network status: ' + (networkStats?.consensus_state || 'OFFLINE')}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Quick Commands */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
          className="mt-8 flex flex-wrap justify-center gap-2 max-w-4xl mx-auto">
          {Object.keys(COMMANDS).map((cmd) => (
            <button
              key={cmd}
              onClick={() => { setInput(cmd); inputRef.current?.focus(); }}
              className="px-3 py-1.5 text-xs font-mono bg-muted/50 hover:bg-muted rounded-md transition-colors border border-border hover:border-primary/50"
            >
              {cmd}
            </button>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default Terminal;
