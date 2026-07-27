import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, AlertTriangle, ArrowRight, Plus, Shield, Coins, TrendingDown } from 'lucide-react';

const NODE_URL = '/api/rpc';

type StablecoinType = 'USDHSMC' | 'EURHSMC' | 'XAUHSMC';

export default function StablecoinPanel() {
  const [prices, setPrices] = useState<any>(null);
  const [tokens, setTokens] = useState<Record<string, any>>({});
  const [cdpIdInput, setCdpIdInput] = useState('');
  const [cdpInfo, setCdpInfo] = useState<any>(null);
  const [liquidatable, setLiquidatable] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Create form
  const [cOwner, setCOwner] = useState('');
  const [cCollateral, setCCollateral] = useState('');
  const [cType, setCType] = useState<StablecoinType>('USDHSMC');

  // Liquidate form
  const [lCdpId, setLCdpId] = useState('');
  const [lAddr, setLAddr] = useState('');

  // Repay form
  const [rCdpId, setRCdpId] = useState('');
  const [rAmt, setRAmt] = useState('');
  const [rAction, setRAction] = useState<'close'|'partial'>('close');

  const fetchPrices = useCallback(async () => {
    try { const r = await fetch(`${NODE_URL}/stablecoin/prices`); setPrices(await r.json()); } catch {}
  }, []);
  const fetchTokens = useCallback(async () => {
    for (const t of ['USDHSMC','EURHSMC','XAUHSMC']) {
      try { const r = await fetch(`${NODE_URL}/stablecoin/token/${t}`); const d = await r.json();
        if (!d.error) setTokens(prev=>({...prev,[t]:d})); } catch {}
    }
  }, []);
  const fetchLiq = useCallback(async () => {
    try { const r = await fetch(`${NODE_URL}/stablecoin/liquidatable`); const d = await r.json();
      if (d.liquidatable_cdps) setLiquidatable(d.liquidatable_cdps); } catch {}
  }, []);

  useEffect(() => { fetchPrices(); fetchTokens(); fetchLiq(); const iv = setInterval(()=>{fetchPrices();fetchTokens();fetchLiq();},30000); return ()=>clearInterval(iv); }, []);

  const lookupCdp = async () => { setLoading(true); setError(null); try {
    const r = await fetch(`${NODE_URL}/stablecoin/cdp/${cdpIdInput}`); const d = await r.json();
    d.error ? setError(d.error) : setCdpInfo(d); } catch(e:any){setError(e.message)} setLoading(false); };

  const createCdp = async () => { setLoading(true); setError(null); try {
    const r = await fetch(`${NODE_URL}/stablecoin/create`, {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({owner:cOwner,collateral_hsmc:parseFloat(cCollateral),stablecoin_type:cType})});
    const d = await r.json(); d.error?setError(d.error):setResult(`CDP #${d.cdp_id} created! ${d.debt?.toFixed(4)} ${cType}`); fetchTokens();
  } catch(e:any){setError(e.message)} setLoading(false); };

  const liquidate = async () => { setLoading(true); setError(null); try {
    const r = await fetch(`${NODE_URL}/stablecoin/liquidate`, {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({cdp_id:parseInt(lCdpId),liquidator:lAddr})});
    const d = await r.json(); d.error?setError(d.error):setResult(`Liquidated #${d.cdp_id}! Reward: ${d.liquidator_reward?.toFixed(4)} HSMC`); fetchLiq();
  } catch(e:any){setError(e.message)} setLoading(false); };

  const repay = async () => { setLoading(true); setError(null); try {
    const body:any = {cdp_id:parseInt(rCdpId),action:rAction}; if(rAction==='partial')body.repay_amount=parseFloat(rAmt);
    const r = await fetch(`${NODE_URL}/stablecoin/repay`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d = await r.json(); d.error?setError(d.error):setResult(d.closed?`CDP #${rCdpId} closed!`:`Partial: ${d.released_collateral_hsmc?.toFixed(4)} HSMC`); fetchTokens();
  } catch(e:any){setError(e.message)} setLoading(false); };

  const fmt = (v:any)=>v!=null?`$${Number(v).toFixed(4)}`:'--';
  const rc = (bps:number,liq:number)=>bps>=liq?'text-green-400':bps>0?'text-red-400':'text-gray-400';

  return (<div className="space-y-6">
    <div className="flex items-center gap-3 mb-2"><Coins className="w-6 h-6 text-primary"/><h2 className="text-2xl font-bold">Stablecoins (CDP Engine)</h2></div>
    <p className="text-sm text-muted-foreground">Over-collateralized stablecoins: lock HSMC to mint USDHSMC, EURHSMC, or XAUHSMC. DAI/MakerDAO-style CDPs.</p>

    <div className="grid grid-cols-3 gap-4">
      {[{l:'HSMC/USD',v:prices?.hsmc_usd},{l:'EUR/USD',v:prices?.eur_usd},{l:'XAU/USD',v:prices?.xau_usd}].map(p=>(
        <Card key={p.l}><CardHeader className="pb-2"><CardTitle className="text-sm">{p.l}</CardTitle></CardHeader><CardContent><span className="text-xl font-mono">{fmt(p.v)}</span></CardContent></Card>))}
    </div>

    <div className="grid grid-cols-3 gap-4">
      {(['USDHSMC','EURHSMC','XAUHSMC'] as StablecoinType[]).map(t=>{const i=tokens[t];return(
        <Card key={t}><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-primary"/>{t}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <div>Supply: {i?.total_supply?.toLocaleString(undefined,{maximumFractionDigits:2})??'--'}</div>
          <div>Min: {i?.min_collateral_ratio_percent?.toFixed(0)??'--'}% | Liq: {i?.liquidation_ratio_percent?.toFixed(0)??'--'}%</div>
          <div>Penalty: {i?.liquidation_penalty_percent?.toFixed(1)??'--'}% | APR: {i?.stability_fee_apr_percent?.toFixed(1)??'--'}%</div>
        </CardContent></Card>);})}
    </div>

    <Tabs defaultValue="create"><TabsList className="grid grid-cols-4"><TabsTrigger value="create">Create CDP</TabsTrigger><TabsTrigger value="manage">Manage</TabsTrigger><TabsTrigger value="liquidate">Liquidate</TabsTrigger><TabsTrigger value="browse">Browse</TabsTrigger></TabsList>

    <TabsContent value="create"><Card><CardHeader><CardTitle>Open CDP</CardTitle><CardDescription>Lock HSMC to mint stablecoins</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div><Label>Owner</Label><Input placeholder="HSMC_..." value={cOwner} onChange={e=>setCOwner(e.target.value)}/></div>
      <div><Label>Collateral (HSMC, min 100)</Label><Input type="number" placeholder="500" value={cCollateral} onChange={e=>setCCollateral(e.target.value)}/></div>
      <div><Label>Type</Label><select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={cType} onChange={e=>setCType(e.target.value as StablecoinType)}>
        <option value="USDHSMC">USDHSMC</option><option value="EURHSMC">EURHSMC</option><option value="XAUHSMC">XAUHSMC</option></select></div>
      <Button onClick={createCdp} disabled={loading||!cOwner||!cCollateral}>{loading?<Loader2 className="w-4 h-4 animate-spin mr-2"/>:<Plus className="w-4 h-4 mr-2"/>}Create CDP</Button>
    </CardContent></Card></TabsContent>

    <TabsContent value="manage"><Card><CardHeader><CardTitle>Repay & Close</CardTitle><CardDescription>Repay debt to release collateral</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div><Label>CDP ID</Label><Input type="number" placeholder="1" value={rCdpId} onChange={e=>setRCdpId(e.target.value)}/></div>
      <div><Label>Action</Label><select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={rAction} onChange={e=>setRAction(e.target.value as 'close'|'partial')}>
        <option value="close">Close (full repay)</option><option value="partial">Partial Repay</option></select></div>
      {rAction==='partial'&&<div><Label>Amount</Label><Input type="number" placeholder="10" value={rAmt} onChange={e=>setRAmt(e.target.value)}/></div>}
      <Button onClick={repay} disabled={loading||!rCdpId}>{loading?<Loader2 className="w-4 h-4 animate-spin mr-2"/>:<ArrowRight className="w-4 h-4 mr-2"/>}Repay</Button>
    </CardContent></Card></TabsContent>

    <TabsContent value="liquidate"><Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-400"/>Liquidate</CardTitle><CardDescription>Repay debt + claim collateral + 13% penalty</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div><Label>CDP ID</Label><Input type="number" placeholder="1" value={lCdpId} onChange={e=>setLCdpId(e.target.value)}/></div>
      <div><Label>Liquidator Address</Label><Input placeholder="HSMC_..." value={lAddr} onChange={e=>setLAddr(e.target.value)}/></div>
      <Button onClick={liquidate} disabled={loading||!lCdpId||!lAddr} variant="destructive">{loading?<Loader2 className="w-4 h-4 animate-spin mr-2"/>:<TrendingDown className="w-4 h-4 mr-2"/>}Liquidate</Button>
      {liquidatable.length>0&&<div className="mt-4 pt-4 border-t"><h4 className="text-sm font-semibold mb-2">Liquidatable ({liquidatable.length})</h4>
      <div className="space-y-2 max-h-60 overflow-y-auto">{liquidatable.map(c=>(
        <div key={c.cdp_id} className="flex justify-between p-2 rounded bg-red-950/30 text-xs">
          <div><span className="font-mono text-red-300">#{c.cdp_id}</span><span className="ml-2">{c.stablecoin_type}</span></div>
          <div className="text-right"><div>{c.collateral_hsmc?.toFixed(2)} HSMC</div><div className="text-red-400">{c.debt?.toFixed(4)} debt</div></div></div>))}</div></div>}
    </CardContent></Card></TabsContent>

    <TabsContent value="browse"><Card><CardHeader><CardTitle>CDP Lookup</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex gap-2"><Input type="number" placeholder="CDP ID" value={cdpIdInput} onChange={e=>setCdpIdInput(e.target.value)}/>
      <Button onClick={lookupCdp} disabled={loading||!cdpIdInput}>{loading?<Loader2 className="w-4 h-4 animate-spin"/>:'Lookup'}</Button></div>
      {cdpInfo&&<div className="p-4 rounded-lg border space-y-2">
        <div className="flex justify-between"><span className="font-mono text-sm">CDP #{cdpInfo.cdp_id}</span>
        <Badge variant={cdpInfo.is_healthy?'default':'destructive'}>{cdpInfo.is_healthy?'Healthy':'UNDERCOLLATERALIZED'}</Badge></div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>Type: <span className="text-foreground">{cdpInfo.stablecoin_type}</span></div>
          <div>Owner: <span className="text-foreground font-mono">{cdpInfo.owner?.slice(0,12)}...</span></div>
          <div>Collateral: <span className="text-foreground">{cdpInfo.collateral_hsmc?.toFixed(2)} HSMC</span></div>
          <div>Debt: <span className="text-foreground">{cdpInfo.debt?.toFixed(6)}</span></div>
          <div>Ratio: <span className={rc(cdpInfo.ratio_bps,cdpInfo.liquidation_ratio_bps)}>{cdpInfo.ratio_percent?.toFixed(2)}%</span></div>
          <div>Liq Price: <span className="text-foreground">{cdpInfo.liquidation_price!=null?`$${cdpInfo.liquidation_price.toFixed(6)}`:'--'}</span></div>
        </div></div>}
    </CardContent></Card></TabsContent>
    </Tabs>
    {error&&<div className="p-3 rounded bg-red-950/50 border border-red-800 text-red-300 text-sm">{error}</div>}
    {result&&<div className="p-3 rounded bg-green-950/50 border border-green-800 text-green-300 text-sm">{result}</div>}
  </div>);
}
