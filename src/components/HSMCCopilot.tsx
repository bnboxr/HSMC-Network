/**
 * HSMC Co-Pilot — floating AI chat panel powered by Lovable AI Gateway.
 * Streams SSE from local copilot-server (port 3002) and renders incremental tokens.
 * Wallet context loaded from local SQLite DB, identified by x-user-id header.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

type Msg = { role: 'user' | 'assistant'; content: string };

const LS_KEY = 'hsmc_copilot_history';

export default function HSMCCopilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as Msg[]) : [];
    } catch { return []; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(messages.slice(-30))); } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Copilot server URL — can be overridden via env var
  const COPILOT_URL = import.meta.env.VITE_COPILOT_URL || 'http://localhost:3002/copilot/chat';

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    // Refuse if the user is pasting a seed phrase.
    const wc = text.split(/\s+/).length;
    if (wc >= 12 && wc <= 25 && /^[a-z\s]+$/i.test(text)) {
      toast({
        title: 'Never share your seed phrase',
        description: 'I refuse to process anything that looks like a seed phrase. Keep it offline.',
        variant: 'destructive',
      });
      return;
    }

    const next: Msg[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(next);
    setInput('');
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // Get user ID from localStorage (set during wallet connect/login)
      const userId = localStorage.getItem('hsmc_user_id') || 'demo-user';

      const res = await fetch(COPILOT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          messages: next.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
          user_id: userId,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length) {
              acc += delta;
              setMessages(prev => {
                const copy = prev.slice();
                copy[copy.length - 1] = { role: 'assistant', content: acc };
                return copy;
              });
            }
          } catch { /* keep buffering */ }
        }
      }
      if (!acc) {
        setMessages(prev => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: 'assistant', content: '_(no response)_' };
          return copy;
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const fallback = msg.includes('Failed to fetch') || msg.includes('NetworkError')
        ? '⚠️ Co-Pilot server is not running. Start it with: `LOVABLE_API_KEY=sk-... bun run copilot-server.ts` (port 3002)'
        : `⚠️ ${msg}`;
      setMessages(prev => {
        const copy = prev.slice();
        copy[copy.length - 1] = { role: 'assistant', content: fallback };
        return copy;
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();
  const clearChat = () => { setMessages([]); localStorage.removeItem(LS_KEY); };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open HSMC Co-Pilot"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-lg shadow-primary/40 flex items-center justify-center hover:scale-105 transition-transform"
      >
        {open ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-24 right-6 z-50 w-[min(420px,calc(100vw-2rem))] h-[min(560px,calc(100vh-8rem))] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <div>
                  <div className="text-sm font-bold">HSMC Co-Pilot</div>
                  <div className="text-[10px] font-mono text-muted-foreground">gemini-3-flash · live</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={clearChat} className="text-xs h-7">Clear</Button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
              {messages.length === 0 && (
                <div className="text-muted-foreground text-center py-8 space-y-2">
                  <Bot className="w-10 h-10 mx-auto opacity-60" />
                  <p>Ask me about your wallet, staking, mining, swaps, or how HSMC works.</p>
                  <p className="text-xs">I see your balance and recent transactions (read-only).</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground border border-border'
                    }`}
                  >
                    {m.content || <Loader2 className="w-4 h-4 animate-spin" />}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="border-t border-border p-3 flex gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder="Ask about your wallet, staking, mining…"
                rows={1}
                className="flex-1 resize-none bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring max-h-32"
                disabled={busy}
              />
              {busy ? (
                <Button type="button" variant="destructive" size="icon" onClick={stop}>
                  <X className="w-4 h-4" />
                </Button>
              ) : (
                <Button type="submit" size="icon" disabled={!input.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
