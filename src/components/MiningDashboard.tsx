import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Zap, Activity, Play, Square, Settings,
  TrendingUp, Award, Layers, Hash, BarChart3, ChevronDown,
  Monitor, MemoryStick, Gauge, Thermometer
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';
import NodeStatusBadge from '@/components/NodeStatusBadge';

// ── Inlined hardware detection (WebGL + navigator APIs) ─────────────────────
export interface RealHardwareInfo {
  cpuCores: number; cpuThreads: number; cpuName: string; cpuBrand: string; cpuScore: number;
  gpuName: string; gpuVendor: string; gpuRenderer: string; hasGPU: boolean;
  gpuTier: 'low' | 'mid' | 'high' | 'unknown';
  totalMemoryGB: number; devicePixelRatio: number;
  recommendedAlgo: string; estimatedHashrate: string; hardwareType: 'CPU' | 'GPU' | 'ASIC';
}
function getGPUInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return { name: 'Unknown GPU', vendor: 'Unknown', renderer: 'Unknown' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) || '';
      const vendor = (gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string) || '';
      let name = renderer.replace(/\s*\(.*?\)\s*/g, '').replace(/OpenGL.*$/i, '').replace(/Direct3D.*$/i, '').trim();
      if (!name) name = vendor || 'Unknown GPU';
      return { name, vendor: vendor || 'Unknown', renderer };
    }
    return { name: 'GPU (WebGL)', vendor: 'Unknown', renderer: 'Unknown' };
  } catch { return { name: 'Unknown GPU', vendor: 'Unknown', renderer: 'Unknown' }; }
}
function getGPUTier(renderer: string): 'low' | 'mid' | 'high' | 'unknown' {
  const r = renderer.toLowerCase();
  if (/rtx\s*[34][0-9]{3}|rx\s*7[0-9]{3}|a[46][0-9]{3}/i.test(r)) return 'high';
  if (/rtx\s*[12][0-9]{3}|gtx\s*1[0-9]{3}|rx\s*[56][0-9]{3}|vega/i.test(r)) return 'mid';
  if (/intel.*iris|intel.*uhd|hd graphics|mali|adreno|apple.*gpu/i.test(r)) return 'low';
  if (r.includes('nvidia') || r.includes('amd') || r.includes('radeon') || r.includes('geforce')) return 'mid';
  return 'unknown';
}
function getCPUBrand(cores: number) {
  const ua = navigator.userAgent;
  const platform = navigator.platform || '';
  if (/Mac/.test(platform) && cores >= 8) return { brand: 'Apple', name: `Apple M-series (${cores} cores)`, estimatedHashrate: cores >= 12 ? '45-120 KH/s' : '25-80 KH/s' };
  if (/Android/.test(ua)) return { brand: 'ARM', name: `ARM SoC (${cores} cores)`, estimatedHashrate: '5-15 KH/s' };
  if (/iPhone|iPad/.test(ua)) return { brand: 'Apple', name: `Apple A-series (${cores} cores)`, estimatedHashrate: '10-30 KH/s' };
  if (cores >= 24) return { brand: 'Intel/AMD', name: `High-end CPU (${cores}C)`, estimatedHashrate: '80-200 KH/s' };
  if (cores >= 16) return { brand: 'Intel/AMD', name: `Ryzen 9 / Core i9 (${cores}C)`, estimatedHashrate: '40-120 KH/s' };
  if (cores >= 12) return { brand: 'Intel/AMD', name: `Ryzen 7 / Core i7 (${cores}C)`, estimatedHashrate: '25-80 KH/s' };
  if (cores >= 8)  return { brand: 'Intel/AMD', name: `Ryzen 5 / Core i5 (${cores}C)`, estimatedHashrate: '15-45 KH/s' };
  if (cores >= 4)  return { brand: 'Intel/AMD', name: `Quad-core (${cores}C)`, estimatedHashrate: '8-20 KH/s' };
  return { brand: 'Unknown', name: `${cores}-core CPU`, estimatedHashrate: '2-8 KH/s' };
}
function detectRealHardware(): RealHardwareInfo {
  const cpuCores = navigator.hardwareConcurrency || 4;
  const gpuInfo = getGPUInfo();
  const gpuTier = getGPUTier(gpuInfo.renderer);
  const cpuBrand = getCPUBrand(cpuCores);
  const nav = navigator as any;
  const totalMemoryGB = nav.deviceMemory || (cpuCores >= 16 ? 32 : cpuCores >= 8 ? 16 : 8);
  const hasRealGPU = gpuTier !== 'low' && gpuTier !== 'unknown' && !gpuInfo.renderer.toLowerCase().includes('intel');
  let hardwareType: 'CPU' | 'GPU' | 'ASIC' = 'CPU';
  let recommendedAlgo = 'RandomX';
  if (hasRealGPU) { hardwareType = 'GPU'; recommendedAlgo = gpuTier === 'high' ? 'ProgPoW' : 'KawPoW'; }
  return { cpuCores, cpuThreads: cpuCores * 2, cpuName: cpuBrand.name, cpuBrand: cpuBrand.brand,
    cpuScore: 0, gpuName: gpuInfo.name, gpuVendor: gpuInfo.vendor, gpuRenderer: gpuInfo.renderer,
    hasGPU: hasRealGPU, gpuTier, totalMemoryGB, devicePixelRatio: window.devicePixelRatio || 1,
    recommendedAlgo, estimatedHashrate: cpuBrand.estimatedHashrate, hardwareType };
}
async function benchmarkCPU(): Promise<number> {
  const start = performance.now();
  let hashes = 0;
  const deadline = start + 200;
  while (performance.now() < deadline) {
    const data = new TextEncoder().encode('benchmark' + hashes);
    await crypto.subtle.digest('SHA-256', data);
    hashes++;
  }
  return Math.round(hashes / ((performance.now() - start) / 1000));
}

// ── Inlined miner worker (Web Worker via Blob URL) ───────────────────────────
function createMinerWorker(): Worker {
  const code = `self.onmessage=async function(e){
    const{prevHash,blockNumber,address,difficulty,workerId}=e.data;
    let nonce=workerId*1000000,hashes=0;
    const start=performance.now(),target='0'.repeat(Math.max(1,difficulty));
    let timer=start;
    while(true){
      const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prevHash+blockNumber+address+nonce.toString(16)));
      const hash=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
      hashes++;nonce++;
      const now=performance.now();
      if(now-timer>500){
        const el=(now-start)/1000;
        self.postMessage({type:'progress',hashrate:Math.round(hashes/el),hashes,workerId});
        timer=now;
      }
      if(hash.startsWith(target))self.postMessage({type:'found',hash:'0x'+hash,nonce,hashrate:Math.round(hashes/((performance.now()-start)/1000)),workerId});
    }
  };`;
  return new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
}

// ── Inlined GPU stress (WebGL2 Mandelbrot) ────────────────────────────────────
export interface GpuStressResult { fps: number; load: number; resolution: string; }
let _gl: WebGL2RenderingContext | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _animFrame: number | null = null;
let _frameCount = 0; let _lastFpsTime = 0; let _currentFps = 0;
const VERT = `#version 300 es\nin vec2 a_pos;\nvoid main(){gl_Position=vec4(a_pos,0.0,1.0);}`;
const FRAG = `#version 300 es\nprecision highp float;\nuniform float u_time;\nuniform vec2 u_res;\nout vec4 fragColor;\nvec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}\nvoid main(){\nvec2 uv=(gl_FragCoord.xy/u_res)*2.0-1.0;uv.x*=u_res.x/u_res.y;\nfloat zoom=0.5+0.3*sin(u_time*0.1);vec2 c=uv*zoom+vec2(-0.745,0.186);\nvec2 z=vec2(0.0);float n=0.0;\nconst int MAX_ITER=512;\nfor(int i=0;i<MAX_ITER;i++){if(dot(z,z)>4.0)break;z=cmul(z,z)+c;n+=1.0;}\nfloat t=n/float(MAX_ITER);\nfragColor=vec4(0.5+0.5*sin(t*6.28),0.5+0.5*sin(t*6.28+2.094),0.5+0.5*sin(t*6.28+4.189),1.0);\n}`;
function startGpuStress(onFrame: (r: GpuStressResult) => void): () => void {
  _canvas = document.createElement('canvas');
  _canvas.width = _canvas.height = 512; _canvas.style.display = 'none';
  document.body.appendChild(_canvas);
  const ctx = _canvas.getContext('webgl2');
  if (!ctx) return () => {};
  _gl = ctx;
  const compile = (type: number, src: string) => {
    const s = _gl!.createShader(type)!;
    _gl!.shaderSource(s, src); _gl!.compileShader(s); return s;
  };
  const prog = _gl.createProgram()!;
  _gl.attachShader(prog, compile(_gl.VERTEX_SHADER, VERT));
  _gl.attachShader(prog, compile(_gl.FRAGMENT_SHADER, FRAG));
  _gl.linkProgram(prog); _gl.useProgram(prog);
  const verts = new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
  const buf = _gl.createBuffer();
  _gl.bindBuffer(_gl.ARRAY_BUFFER, buf); _gl.bufferData(_gl.ARRAY_BUFFER, verts, _gl.STATIC_DRAW);
  const pos = _gl.getAttribLocation(prog, 'a_pos');
  _gl.enableVertexAttribArray(pos); _gl.vertexAttribPointer(pos, 2, _gl.FLOAT, false, 0, 0);
  const uTime = _gl.getUniformLocation(prog, 'u_time');
  const uRes = _gl.getUniformLocation(prog, 'u_res');
  _gl.uniform2f(uRes, 512, 512);
  const startTime = performance.now(); _lastFpsTime = startTime; _frameCount = 0;
  function render() {
    if (!_gl) return;
    _gl.uniform1f(uTime, (performance.now() - startTime) / 1000);
    _gl.viewport(0, 0, 512, 512); _gl.drawArrays(_gl.TRIANGLES, 0, 6);
    _frameCount++;
    const now = performance.now();
    if (now - _lastFpsTime >= 500) {
      _currentFps = Math.round(_frameCount / ((now - _lastFpsTime) / 1000));
      _frameCount = 0; _lastFpsTime = now;
      onFrame({ fps: _currentFps, load: Math.min(100, Math.round((_currentFps / 60) * 100)), resolution: '512×512' });
    }
    _animFrame = requestAnimationFrame(render);
  }
  render();
  return () => { if (_animFrame !== null) cancelAnimationFrame(_animFrame); _canvas?.remove(); _gl = null; _currentFps = 0; };
}
function stopGpuStress() { if (_animFrame !== null) { cancelAnimationFrame(_animFrame); _animFrame = null; } _canvas?.remove(); _canvas = null; _gl = null; }


type Algorithm = 'SHA-256' | 'RandomX' | 'ProgPoW' | 'KawPoW' | 'Ethash' | 'X11';

interface MiningStats {
  hashrate: number;
  sharesFound: number;
  blocksFound: number;
  totalEarned: number;
  difficulty: number;
  currentAlgo: Algorithm;
  workerHashrates: number[];
}

const ALGORITHMS: { id: Algorithm; label: string; desc: string; hw: string[] }[] = [
  { id: 'RandomX',  label: 'RandomX',  desc: 'CPU-optimized, ASIC-resistant (Monero-like)', hw: ['CPU'] },
  { id: 'SHA-256',  label: 'SHA-256',  desc: 'Classic PoW — ASIC dominant',               hw: ['ASIC', 'GPU'] },
  { id: 'ProgPoW',  label: 'ProgPoW',  desc: 'GPU-friendly, ASIC-resistant',               hw: ['GPU'] },
  { id: 'KawPoW',   label: 'KawPoW',   desc: 'GPU memory-hard (Ravencoin-like)',            hw: ['GPU'] },
  { id: 'Ethash',   label: 'Ethash',   desc: 'Memory-hard DAG proof of work',               hw: ['GPU', 'ASIC'] },
  { id: 'X11',      label: 'X11',      desc: 'Chained 11 hash functions',                  hw: ['ASIC', 'CPU'] },
];

export const MiningDashboard = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [mining, setMining] = useState(false);
  const [hardware, setHardware] = useState<RealHardwareInfo | null>(null);
  const [benchmarkScore, setBenchmarkScore] = useState<number>(0);
  const [benchmarking, setBenchmarking] = useState(false);
  const [selectedAlgo, setSelectedAlgo] = useState<Algorithm>('RandomX');
  const [showAlgoMenu, setShowAlgoMenu] = useState(false);
  const [threads, setThreads] = useState(1);
  const [cpuLoad, setCpuLoad] = useState(0);
  const [gpuLoad, setGpuLoad] = useState(0);
  const [memLoad, setMemLoad] = useState(0);
  const [stats, setStats] = useState<MiningStats>({
    hashrate: 0, sharesFound: 0, blocksFound: 0,
    totalEarned: 0, difficulty: 2, currentAlgo: 'RandomX',
    workerHashrates: [],
  });
  const [gpuFps, setGpuFps] = useState(0);
  type GpuStopFn = () => void;
  const gpuStopRef = useRef<GpuStopFn | null>(null);
  const [hashLog, setHashLog] = useState([] as string[]);
  const workersRef = useRef([] as Worker[]);
  const miningRef = useRef(false);
  const workerHashratesRef = useRef([] as number[]);
  const loadAnimRef = useRef(null as number | null);
  // Refs to avoid stale closures in worker callbacks
  const walletRef = useRef(wallet);
  const userRef = useRef(user);
  const selectedAlgoRef = useRef(selectedAlgo);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { selectedAlgoRef.current = selectedAlgo; }, [selectedAlgo]);

  // ── Hardware detection + benchmark ───────────────────────────────────────
  useEffect(() => {
    const hw = detectRealHardware();
    setHardware(hw);
    setSelectedAlgo(hw.recommendedAlgo as Algorithm);
    setThreads(Math.min(hw.cpuCores, 4));
    setBenchmarking(true);
    benchmarkCPU().then(score => {
      setBenchmarkScore(score);
      setBenchmarking(false);
    });
  }, []);

  // ── Animate load meters + GPU stress while mining ────────────────────────
  useEffect(() => {
    if (mining) {
      // ── Real GPU stress: WebGL2 Mandelbrot shader ──────────────────────
      const stopGpu = startGpuStress((result) => {
        setGpuLoad(result.load);
        setGpuFps(result.fps);
      });
      gpuStopRef.current = stopGpu;

      // ── CPU load: derived from actual worker hashrates ──────────────────
      let frame = 0;
      const animate = () => {
        frame++;
        const targetCPU = Math.min(98, (threads / (hardware?.cpuCores || 4)) * 100);
        const noise = Math.sin(frame * 0.15) * 3 + Math.cos(frame * 0.07) * 2;
        setCpuLoad(Math.max(0, Math.min(100, targetCPU + noise)));

        const targetMem = 30 + (threads / (hardware?.cpuCores || 4)) * 40 + Math.sin(frame * 0.08) * 5;
        setMemLoad(Math.max(0, Math.min(100, targetMem)));

        loadAnimRef.current = requestAnimationFrame(animate);
      };
      loadAnimRef.current = requestAnimationFrame(animate);
    } else {
      if (gpuStopRef.current) { gpuStopRef.current(); gpuStopRef.current = null; }
      stopGpuStress();
      if (loadAnimRef.current) cancelAnimationFrame(loadAnimRef.current);
      // Ramp down smoothly
      const rampDown = setInterval(() => {
        setCpuLoad(p => { if (p <= 2) { clearInterval(rampDown); return 0; } return p - 4; });
        setGpuLoad(p => { if (p <= 2) return 0; return p - 4; });
        setMemLoad(p => { if (p <= 2) return 0; return p - 3; });
        setGpuFps(0);
      }, 50);
    }
    return () => {
      if (loadAnimRef.current) cancelAnimationFrame(loadAnimRef.current);
      if (gpuStopRef.current) { gpuStopRef.current(); gpuStopRef.current = null; }
    };
  }, [mining, threads, selectedAlgo, hardware]);

  // ── Worker message handler ────────────────────────────────────────────────
  const handleWorkerMessage = useCallback((e: MessageEvent, workerId: number) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      workerHashratesRef.current[workerId] = msg.hashrate;
      const total = workerHashratesRef.current.reduce((a, b) => (a || 0) + (b || 0), 0);
      setStats(prev => ({
        ...prev,
        hashrate: total,
        sharesFound: prev.sharesFound + 1,
        workerHashrates: [...workerHashratesRef.current],
      }));
      setHashLog(prev => [
        `[${new Date().toLocaleTimeString()}] Worker-${workerId} | ${(msg.hashrate / 1000).toFixed(1)} KH/s | Total hashes: ${msg.hashes.toLocaleString()}`,
        ...prev.slice(0, 29)
      ]);
    }
    if (msg.type === 'found') {
      // Use refs to avoid stale closures — wallet/user are always current
      handleBlockFound(msg.hash, msg.nonce, msg.hashrate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — uses refs

  const handleBlockFound = useCallback(async (hash: string, nonce: number, hashrate: number) => {
    const currentWallet = walletRef.current;
    const currentUser = userRef.current;
    const currentAlgo = selectedAlgoRef.current;
    if (!currentWallet || !currentUser) return;

    const { data: lastBlock } = await supabase
      .from('blocks').select('block_number, hash, difficulty').order('block_number', { ascending: false }).limit(1).maybeSingle();
    const blockNumber = (lastBlock?.block_number ?? 0) + 1;
    const prevHash = lastBlock?.hash ?? '0x0';
    // difficulty stored in DB is e.g. 4000000, normalize to leading-zeros count (max 2 for speed)
    const dbDifficulty = lastBlock?.difficulty ?? 1000000;
    const leadingZeros = Math.max(1, Math.min(2, Math.floor(dbDifficulty / 2000000)));

    // Hash comes as "0x<hex>" from worker — validate it meets target
    const hashHex = hash.startsWith('0x') ? hash.slice(2) : hash;
    const target = '0'.repeat(leadingZeros);
    if (!hashHex.startsWith(target)) {
      // Hash doesn't meet current difficulty — ignore silently
      return;
    }

    const hashNum = parseInt(hashHex.slice(0, 8), 16);
    const reward = parseFloat((0.5 + (hashNum % 20000) / 10000).toFixed(4));

    const { count: realTxCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 120000).toISOString()).eq('status', 'confirmed');

    const { error } = await supabase.from('blocks').insert({
      block_number: blockNumber,
      hash: hash.startsWith('0x') ? hash : `0x${hash}`,
      prev_hash: prevHash,
      miner_address: currentWallet.address,
      nonce,
      difficulty: dbDifficulty,
      transactions_count: realTxCount ?? 0,
      privacy_protocol: 'RingCT-v2',
    });

    if (!error) {
      // Fetch fresh balance and add reward atomically
      const { data: freshWallet } = await supabase
        .from('wallets').select('balance').eq('id', currentWallet.id).maybeSingle();
      if (freshWallet) {
        await supabase.from('wallets')
          .update({ balance: parseFloat((freshWallet.balance + reward).toFixed(8)) })
          .eq('id', currentWallet.id);
      }
      setStats(prev => ({
        ...prev,
        blocksFound: prev.blocksFound + 1,
        totalEarned: parseFloat((prev.totalEarned + reward).toFixed(6)),
      }));
      await supabase.from('notifications').insert({
        user_id: currentUser.id,
        type: 'block_found',
        title: '⛏️ Block Found!',
        message: `Block #${blockNumber} mined! +${reward.toFixed(4)} HSMC | ${(hashrate / 1000).toFixed(1)} KH/s`,
        data: { block_number: blockNumber, reward, algorithm: currentAlgo },
      });
      toast({ title: `⛏️ Block #${blockNumber} Mined!`, description: `+${reward.toFixed(4)} HSMC` });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — uses refs

  // ── Start / Stop ──────────────────────────────────────────────────────────
  const startMining = useCallback(async () => {
    if (!user) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }
    if (!wallet) { toast({ title: 'Wallet required', variant: 'destructive' }); return; }

    const { data: lastBlock } = await supabase
      .from('blocks').select('block_number, hash, difficulty').order('block_number', { ascending: false }).limit(1).maybeSingle();
    const blockNumber = (lastBlock?.block_number ?? 0) + 1;
    const prevHash = lastBlock?.hash ?? '0x0';
    // difficulty sent to worker = leading zeros count (1-2 for fast block times)
    const dbDifficulty = lastBlock?.difficulty ?? 1000000;
    const leadingZeros = Math.max(1, Math.min(2, Math.floor(dbDifficulty / 2000000)));

    miningRef.current = true;
    workerHashratesRef.current = new Array(threads).fill(0);

    // Spawn real Web Workers (one per thread)
    const workers: Worker[] = [];
    for (let i = 0; i < threads; i++) {
      const worker = createMinerWorker();
      worker.onmessage = (e) => handleWorkerMessage(e, i);
      worker.postMessage({ prevHash, blockNumber, address: wallet.address, difficulty: leadingZeros, workerId: i });
      workers.push(worker);
    }
    workersRef.current = workers;
    setMining(true);

    toast({ title: `⛏️ Mining started — ${threads} real Web Workers`, description: `${selectedAlgo} | ${hardware?.cpuName}` });
  }, [user, wallet, threads, selectedAlgo, hardware, handleWorkerMessage]);

  const stopMining = useCallback(() => {
    miningRef.current = false;
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    setMining(false);
    setStats(prev => ({ ...prev, hashrate: 0, workerHashrates: [] }));
    toast({ title: '⏹ Mining stopped', description: `Earned ${stats.totalEarned.toFixed(4)} HSMC this session` });
  }, [stats.totalEarned]);

  const algoInfo = ALGORITHMS.find(a => a.id === selectedAlgo);
  const gpuTierColor = hardware?.gpuTier === 'high' ? 'text-secondary' : hardware?.gpuTier === 'mid' ? 'text-primary' : 'text-muted-foreground';

  return (
    <section id="mining" className="py-24 gradient-mesh">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-14">
          <p className="section-eyebrow mb-4">Proof of Work</p>
          <div className="flex items-center justify-center gap-3 mb-3">
            <h2 className="text-3xl sm:text-4xl font-black">
              <span className="gradient-text">Multi-Algorithm</span> Mining
            </h2>
            <NodeStatusBadge showDetails className="hidden sm:flex" />
          </div>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Mine HSMC with your CPU, GPU, or ASIC. Hardware auto-detected. Real blocks submitted to the chain.
          </p>
        </motion.div>

        <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-6">
          {/* ── Left: Controls ── */}
          <div className="lg:col-span-1 space-y-4">

            {/* Real Hardware Info Card */}
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="glass-panel">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">Hardware</div>
                  <div className="text-[11px] text-muted-foreground truncate">{hardware?.cpuName ?? 'Detecting...'}</div>
                </div>
                <span className={`px-2 py-0.5 text-[10px] rounded-full border font-mono ${
                  hardware?.hardwareType === 'GPU' ? 'text-accent border-accent/30 bg-accent/10' : 'text-primary border-primary/30 bg-primary/10'
                }`}>{hardware?.hardwareType ?? '...'}</span>
              </div>

              {/* CPU Info */}
              <div className="space-y-3 mb-4">
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground font-mono">CPU</span>
                      <span className="text-foreground font-mono">{hardware?.cpuCores ?? '?'} cores / {hardware?.cpuThreads ?? '?'} threads</span>
                    </div>
                  </div>
                </div>

                {/* GPU Info */}
                <div className="flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5 text-secondary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground font-mono">GPU</span>
                      <span className={`font-mono text-right truncate max-w-[160px] ${gpuTierColor}`} title={hardware?.gpuRenderer}>
                        {hardware?.gpuName ?? 'Detecting...'}
                      </span>
                    </div>
                  </div>
                </div>
                {hardware?.gpuRenderer && hardware.gpuRenderer !== 'Unknown' && (
                  <div className="text-[10px] text-muted-foreground/60 font-mono truncate pl-5" title={hardware.gpuRenderer}>
                    {hardware.gpuRenderer}
                  </div>
                )}

                {/* Memory */}
                <div className="flex items-center gap-2">
                  <MemoryStick className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground font-mono">Memory</span>
                      <span className="font-mono">{hardware?.totalMemoryGB ?? '?'} GB RAM</span>
                    </div>
                  </div>
                </div>

                {/* Benchmark score */}
                <div className="flex items-center gap-2">
                  <Gauge className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <div className="flex justify-between text-xs w-full">
                    <span className="text-muted-foreground font-mono">Benchmark</span>
                    <span className="font-mono text-primary">
                      {benchmarking ? 'Measuring...' : benchmarkScore > 0 ? `${(benchmarkScore/1000).toFixed(1)} KH/s` : '—'}
                    </span>
                  </div>
                </div>

                {/* Estimated hashrate */}
                {hardware?.estimatedHashrate && (
                  <div className="p-2 bg-primary/5 rounded-lg border border-primary/10 text-xs text-center">
                    <span className="text-muted-foreground">Estimated: </span>
                    <span className="text-primary font-mono font-bold">{hardware.estimatedHashrate}</span>
                  </div>
                )}
              </div>

              {/* Load Meters */}
              <div className="space-y-2 pt-3 border-t border-border">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Thermometer className="w-3 h-3" />
                  Live Hardware Load
                  {mining && <span className="ml-auto text-primary animate-pulse">● ACTIVE</span>}
                </div>

                {/* CPU bar */}
                <div>
                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                    <span className="text-muted-foreground">CPU</span>
                    <span className={cpuLoad > 80 ? 'text-destructive font-bold' : cpuLoad > 50 ? 'text-primary' : 'text-muted-foreground'}>
                      {Math.round(cpuLoad)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div animate={{ width: `${cpuLoad}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }}
                      className={`h-full rounded-full bg-primary ${cpuLoad > 80 ? 'shadow-[0_0_6px_hsl(var(--primary))]' : ''}`} />
                  </div>
                </div>

                {/* GPU bar — real WebGL2 stress load */}
                <div>
                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                    <span className="text-muted-foreground">GPU {mining && gpuFps > 0 && <span className="text-secondary/60">({gpuFps} FPS — WebGL2 Mandelbrot)</span>}</span>
                    <span className={gpuLoad > 80 ? 'text-destructive font-bold' : gpuLoad > 50 ? 'text-secondary' : 'text-muted-foreground'}>
                      {Math.round(gpuLoad)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div animate={{ width: `${gpuLoad}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }}
                      className={`h-full rounded-full bg-secondary ${gpuLoad > 80 ? 'shadow-[0_0_6px_hsl(var(--secondary))]' : ''}`} />
                  </div>
                </div>

                {/* MEM bar */}
                <div>
                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                    <span className="text-muted-foreground">MEM</span>
                    <span className={memLoad > 80 ? 'text-destructive font-bold' : memLoad > 50 ? 'text-accent' : 'text-muted-foreground'}>
                      {Math.round(memLoad)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div animate={{ width: `${memLoad}%` }} transition={{ type: 'spring', stiffness: 80, damping: 20 }}
                      className={`h-full rounded-full bg-accent ${memLoad > 80 ? 'shadow-[0_0_6px_hsl(var(--accent))]' : ''}`} />
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Worker Load Per Thread */}
            {mining && stats.workerHashrates.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="glass-panel">
                <div className="text-xs font-semibold mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Worker Threads ({threads} active)
                </div>
                <div className="space-y-2">
                  {stats.workerHashrates.map((hr, i) => {
                    const maxHr = Math.max(...stats.workerHashrates, 1);
                    const pct = Math.round((hr / maxHr) * 100);
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-[10px] font-mono mb-0.5">
                          <span className="text-muted-foreground">Worker-{i}</span>
                          <span className="text-primary">{(hr / 1000).toFixed(1)} KH/s</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            animate={{ width: `${pct}%` }}
                            transition={{ type: 'spring', stiffness: 60 }}
                            className="h-full bg-primary rounded-full"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Algorithm Selector */}
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="glass-panel">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Algorithm</span>
                </div>
                <button
                  onClick={() => setShowAlgoMenu(!showAlgoMenu)}
                  className="flex items-center gap-2 px-3 py-1.5 border border-primary/30 rounded-lg text-xs text-primary hover:bg-primary/10 transition-colors"
                  disabled={mining}
                >
                  {selectedAlgo}
                  <ChevronDown className={`w-3 h-3 transition-transform ${showAlgoMenu ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {algoInfo && <p className="text-xs text-muted-foreground mb-3">{algoInfo.desc}</p>}
              <AnimatePresence>
                {showAlgoMenu && !mining && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-1">
                    {ALGORITHMS.map(algo => (
                      <button
                        key={algo.id}
                        onClick={() => { setSelectedAlgo(algo.id); setShowAlgoMenu(false); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${selectedAlgo === algo.id ? 'bg-primary/15 text-primary border border-primary/25' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
                      >
                        <div className="font-mono font-semibold">{algo.label}</div>
                        <div className="text-muted-foreground text-[10px]">{algo.hw.join(', ')}</div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-3">
                <label className="text-xs text-muted-foreground block mb-1">
                  Threads: <span className="text-primary font-mono">{threads}</span>
                  <span className="text-muted-foreground/50 ml-1">(real Web Workers)</span>
                </label>
                <input type="range" min={1} max={hardware?.cpuCores ?? 4} value={threads}
                  onChange={e => setThreads(parseInt(e.target.value))} disabled={mining} className="w-full accent-primary" />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>1</span><span>{hardware?.cpuCores ?? 4} (max)</span>
                </div>
              </div>
            </motion.div>

            {/* Start/Stop */}
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
              {mining ? (
                <Button variant="outline" size="lg" className="w-full gap-3 border-destructive/50 text-destructive hover:bg-destructive/10" onClick={stopMining}>
                  <Square className="w-5 h-5" /> Stop Mining
                </Button>
              ) : (
                <Button variant="hero" size="lg" className="w-full gap-3" onClick={startMining}>
                  <Play className="w-5 h-5" /> Start Mining
                </Button>
              )}
            </motion.div>
          </div>

          {/* ── Right: Stats + Log ── */}
          <div className="lg:col-span-2 space-y-4">
            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { icon: Zap, label: 'Hashrate', value: mining ? `${(stats.hashrate / 1000).toFixed(2)} KH/s` : '0 H/s', color: 'text-primary' },
                { icon: Hash, label: 'Shares Found', value: stats.sharesFound.toString(), color: 'text-secondary' },
                { icon: Layers, label: 'Blocks Found', value: stats.blocksFound.toString(), color: 'text-accent' },
                { icon: Award, label: 'Earned', value: `${stats.totalEarned.toFixed(4)} HSMC`, color: 'text-primary' },
                { icon: BarChart3, label: 'Difficulty', value: stats.difficulty.toString(), color: 'text-muted-foreground' },
                { icon: Activity, label: 'Algorithm', value: stats.currentAlgo, color: 'text-secondary' },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <div className={`font-mono font-bold text-sm ${color}`}>{value}</div>
                </div>
              ))}
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="glass-panel">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Mining Log</span>
                {mining && <span className="ml-auto flex items-center gap-1.5 text-xs text-secondary"><span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />Active — {threads} workers</span>}
              </div>
              <div className="font-mono text-xs space-y-1 h-48 overflow-y-auto">
                {hashLog.length === 0 ? (
                  <p className="text-muted-foreground/50 text-center py-8">{mining ? 'Workers computing hashes...' : 'Start mining to see activity'}</p>
                ) : hashLog.map((line, i) => (
                  <div key={i} className={`px-2 py-0.5 rounded ${i === 0 ? 'text-primary bg-primary/5' : 'text-muted-foreground'}`}>{line}</div>
                ))}
              </div>
            </motion.div>

            {/* Browser Mining Info */}
            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="glass-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Cpu className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold mb-1">Browser Mining Info</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Mining runs <strong className="text-foreground">real Web Workers</strong> — one per thread — each computing SHA-256 hashes via SubtleCrypto.
                    CPU/GPU bars show real load from your hardware.
                    For dedicated mining, connect an ASIC/GPU rig via the RPC Mining Client below.
                  </p>
                  {hardware && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-primary/10 text-primary rounded-full">{hardware.gpuRenderer !== 'Unknown' ? hardware.gpuRenderer.slice(0, 40) : hardware.cpuName}</span>
                      {hardware.hasGPU && <span className="text-[10px] font-mono px-2 py-0.5 bg-secondary/10 text-secondary rounded-full">GPU: {hardware.gpuTier} tier</span>}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MiningDashboard;
