import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Circle, ExternalLink, Loader2, Pencil, ShieldCheck, Radio, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/db/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type DBStatus = "pending" | "deployed" | "verified" | "live" | "failed";

type Step = {
  id: string;
  title: string;
  artifact?: string;
  notes: string;
  cost?: string;
  manual?: boolean; // not deployable on-chain (legal/audit/etc)
};

const STEPS: Step[] = [
  { id: "whsmc-contract", title: "wHSMC BEP-20 / ERC-20 contract", artifact: "contracts/bridge/WHSMC.sol",
    notes: "OpenZeppelin v5, 8 decimals, Pausable, multisig-gated mint." },
  { id: "bridge-minter", title: "BridgeMinter multisig (M-of-N)", artifact: "contracts/bridge/BridgeMinter.sol",
    notes: "ECDSA-attested mint gate cu replay protection." },
  { id: "deploy-bsc", title: "Deploy WHSMC + BridgeMinter pe BSC", artifact: "contracts/Makefile",
    notes: "Rulează `cd contracts && make deploy-testnet` (apoi mainnet) pe laptopul tău. Vezi DEPLOY_GUIDE.md." },
  { id: "pancake-pool", title: "Pool wHSMC/WBNB pe PancakeSwap", artifact: "contracts/scripts/createPancakePool.ts",
    cost: "≥ $5k testnet / ≥ $50k mainnet liquidity",
    notes: "Rulează `make seed-pool-testnet` după deploy." },
  { id: "relayer-daemon", title: "Bridge relayer (5 instanțe)", artifact: "contracts/relayer/relayer.ts",
    notes: "Pornește `npx tsx relayer/relayer.ts` pe 5 VPS-uri (1 per validator)." },
  { id: "seed-nodes", title: "5 seed VPS noduri publice", artifact: "rust-node/seed-bootstrap.sh",
    cost: "~$140/lună", notes: "One-line bootstrap Ubuntu 22.04." },
  { id: "whitepaper-ipfs", title: "Whitepaper → IPFS + GitHub Pages", artifact: "ipfs-publish/publish.sh",
    notes: "Returnează ipfs:// CID + URL Pages." },
  { id: "cmc-listing", title: "CoinMarketCap submission", artifact: "listings/coinmarketcap.json",
    notes: "Submit la coinmarketcap.com/request după deploy + audit." },
  { id: "coingecko-listing", title: "CoinGecko submission", artifact: "listings/coingecko.json",
    notes: "Submit la coingecko.com/en/coins/new." },
  { id: "mexc-listing", title: "MEXC + Gate.io listing", artifact: "listings/MEXC_GATE_README.md",
    cost: "100k–500k USDT escrow", notes: "Comercial, nu tehnic.", manual: true },
  { id: "audit", title: "Trail of Bits / Certik audit", cost: "$30k–$150k",
    notes: "Obligatoriu înainte de orice listing.", manual: true },
  { id: "legal", title: "Foundation + KYC/AML + ToS", artifact: "legal/README.md",
    cost: "€20k–80k", notes: "Necesită avocat real.", manual: true },
];

type DepRow = {
  id: string;
  step_id: string;
  network: string;
  contract_address: string | null;
  tx_hash: string | null;
  pair_address: string | null;
  status: DBStatus;
  explorer_url: string | null;
  notes: string | null;
  updated_at: string;
};

const STATUS_BADGE: Record<DBStatus | "manual", { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  pending:  { label: "Pending",          cls: "bg-muted/30 text-muted-foreground border-muted/50",      Icon: Circle },
  deployed: { label: "Deployed",         cls: "bg-blue-500/15 text-blue-500 border-blue-500/30",      Icon: ShieldCheck },
  verified: { label: "Verified",         cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", Icon: CheckCircle2 },
  live:     { label: "Live",             cls: "bg-green-500/15 text-green-500 border-green-500/30",   Icon: Radio },
  failed:   { label: "Failed",           cls: "bg-rose-500/15 text-rose-500 border-rose-500/30",      Icon: AlertCircle },
  manual:   { label: "External / manual",cls: "bg-amber-500/15 text-amber-500 border-amber-500/30",   Icon: Circle },
};

export default function MainnetReadinessPage() {
  const { user } = useAuth();
  const [network, setNetwork] = useState<string>("bsc-testnet");
  const [rows, setRows] = useState<DepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Step | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("deployment_status")
      .select("*")
      .eq("network", network)
      .order("updated_at", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    setRows((data ?? []) as DepRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [network]);

  // realtime
  useEffect(() => {
    const ch = supabase
      .channel("deployment_status_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "deployment_status" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [network]);

  const byStep = useMemo(() => {
    const m = new Map<string, DepRow>();
    rows.forEach(r => m.set(r.step_id, r));
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    let live = 0, verified = 0, deployed = 0, failed = 0;
    STEPS.forEach(s => {
      if (s.manual) return;
      const r = byStep.get(s.id);
      if (r?.status === "live") live++;
      else if (r?.status === "verified") verified++;
      else if (r?.status === "deployed") deployed++;
      else if (r?.status === "failed") failed++;
    });
    return { live, verified, deployed, failed, total: STEPS.filter(s => !s.manual).length };
  }, [byStep]);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-4xl font-display font-bold mb-2">Mainnet Readiness</h1>
        <p className="text-muted-foreground max-w-2xl mb-4">
          Status REAL al fiecărui pas, citit live din baza de date. Marchează manual când rulezi
          un pas de pe laptopul tău (ex: <code className="text-xs">make deploy-testnet</code>).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <Label className="text-xs text-muted-foreground">Network:</Label>
          <Select value={network} onValueChange={setNetwork}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bsc-testnet">BSC Testnet</SelectItem>
              <SelectItem value="bsc">BSC Mainnet</SelectItem>
              <SelectItem value="ethereum">Ethereum</SelectItem>
              <SelectItem value="polygon">Polygon</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground ml-auto font-mono">
            {counts.live}🟢 {counts.verified}✅ {counts.deployed}🔵 {counts.failed}🔴 / {counts.total}
          </div>
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      <div className="grid gap-4">
        {STEPS.map(step => {
          const r = byStep.get(step.id);
          const status: DBStatus | "manual" = step.manual ? "manual" : (r?.status ?? "pending");
          const meta = STATUS_BADGE[status];
          const Icon = meta.Icon;
          return (
            <Card key={step.id} className="p-5 bg-card/50 backdrop-blur border-border/50">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-[280px]">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold">{step.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{step.notes}</p>
                  {step.artifact && (
                    <div className="flex items-center gap-2 text-xs font-mono text-primary mb-1">
                      <ExternalLink className="h-3 w-3" /> {step.artifact}
                    </div>
                  )}
                  {step.cost && <p className="text-xs text-amber-500 mb-1">Cost: {step.cost}</p>}
                  {r?.contract_address && (
                    <p className="text-xs font-mono mt-2 break-all">
                      📜 <a href={r.explorer_url ?? `https://bscscan.com/address/${r.contract_address}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-primary hover:underline">{r.contract_address}</a>
                    </p>
                  )}
                  {r?.tx_hash && (
                    <p className="text-xs font-mono break-all text-muted-foreground">tx: {r.tx_hash}</p>
                  )}
                  {r?.pair_address && (
                    <p className="text-xs font-mono break-all">🔗 pair: {r.pair_address}</p>
                  )}
                  {r?.notes && <p className="text-xs text-muted-foreground mt-1 italic">{r.notes}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={meta.cls}><Icon className="h-3 w-3 mr-1" />{meta.label}</Badge>
                  {!step.manual && user && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(step)}>
                      <Pencil className="h-3 w-3 mr-1" /> Update
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {editing && (
        <UpdateDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          step={editing}
          network={network}
          existing={byStep.get(editing.id) ?? null}
          userId={user?.id}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {!user && (
        <Card className="mt-8 p-5 bg-amber-500/5 border-amber-500/20">
          <p className="text-sm text-muted-foreground">
            🔐 Sign in pentru a marca pașii ca deployed/verified/live.
          </p>
        </Card>
      )}
    </div>
  );
}

function UpdateDialog({
  open, onOpenChange, step, network, existing, userId, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  step: Step;
  network: string;
  existing: DepRow | null;
  userId?: string;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<DBStatus>(existing?.status ?? "deployed");
  const [contractAddress, setContractAddress] = useState(existing?.contract_address ?? "");
  const [txHash, setTxHash] = useState(existing?.tx_hash ?? "");
  const [pairAddress, setPairAddress] = useState(existing?.pair_address ?? "");
  const [explorerUrl, setExplorerUrl] = useState(existing?.explorer_url ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!userId) return;
    // basic validation
    if (contractAddress && !/^0x[a-fA-F0-9]{40}$/.test(contractAddress.trim())) {
      toast({ title: "Invalid address", description: "Must be 0x + 40 hex chars", variant: "destructive" }); return;
    }
    if (txHash && !/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
      toast({ title: "Invalid tx hash", description: "Must be 0x + 64 hex chars", variant: "destructive" }); return;
    }
    setSaving(true);
    const payload = {
      step_id: step.id,
      network,
      status,
      contract_address: contractAddress.trim() || null,
      tx_hash: txHash.trim() || null,
      pair_address: pairAddress.trim() || null,
      explorer_url: explorerUrl.trim() || null,
      notes: notes.trim() || null,
      created_by: userId,
    };
    const { error } = existing
      ? await supabase.from("deployment_status").update(payload).eq("id", existing.id)
      : await supabase.from("deployment_status").insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: `${step.title} → ${status}` });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{step.title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as DBStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="deployed">Deployed</SelectItem>
                <SelectItem value="verified">Verified (source published)</SelectItem>
                <SelectItem value="live">Live (in production)</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Contract address</Label>
            <Input placeholder="0x..." value={contractAddress} onChange={e => setContractAddress(e.target.value)} />
          </div>
          <div>
            <Label>Tx hash (deploy)</Label>
            <Input placeholder="0x..." value={txHash} onChange={e => setTxHash(e.target.value)} />
          </div>
          {step.id === "pancake-pool" && (
            <div>
              <Label>Pair address</Label>
              <Input placeholder="0x..." value={pairAddress} onChange={e => setPairAddress(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Explorer URL (BscScan etc.)</Label>
            <Input placeholder="https://bscscan.com/address/0x..." value={explorerUrl} onChange={e => setExplorerUrl(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
