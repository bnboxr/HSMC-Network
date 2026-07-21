import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, X, Sun, Moon, LogOut, User, FileText, Cpu,
  LayoutDashboard, ChevronDown, Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NotificationsPanel from '@/components/NotificationsPanel';
import NodeStatusBadge from '@/components/NodeStatusBadge';
import { useAuth } from '@/hooks/useAuth';
import hsmcLogo from '@/assets/hsmc-logo.png';

const PRIMARY_NAV = [
  { name: 'Dashboard',   href: '#dashboard' },
  { name: 'Staking',     href: '#staking' },
  { name: 'Explorer',    href: '#explorer' },
  { name: 'Wallet',      href: '#wallet' },
  { name: 'Mining',      href: '#mining' },
  { name: 'Governance',  href: '#governance' },
  { name: 'Swap',        href: '#swap' },
];

const MORE_NAV = [
  { name: 'Tokenomics',  href: '#tokenomics' },
  { name: 'Privacy',     href: '#privacy' },
  { name: 'Network',     href: '#network' },
  { name: 'Mempool',     href: '#mempool' },
  { name: 'Contracts',   href: '#contracts' },
  { name: 'Merchant',    href: '#merchant' },
  { name: 'RPC Mining',  href: '#mining-rpc' },
  { name: 'Terminal',    href: '#terminal' },
  { name: 'Docs',        href: '#docs' },
];

const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV];

// Apply persisted theme on load
const getInitialTheme = () => {
  try { return localStorage.getItem('hsmc-theme') !== 'light'; } catch { return true; }
};

const applyTheme = (dark: boolean) => {
  const html = document.documentElement;
  if (dark) {
    html.classList.add('dark');
    html.classList.remove('light');
  } else {
    html.classList.remove('dark');
    html.classList.add('light');
  }
  try { localStorage.setItem('hsmc-theme', dark ? 'dark' : 'light'); } catch {}
};

export const Navbar = () => {
  const [isScrolled, setIsScrolled]         = useState(false);
  const [isMobileOpen, setIsMobileOpen]     = useState(false);
  const [isMoreOpen, setIsMoreOpen]         = useState(false);
  const [isDark, setIsDark]                 = useState(getInitialTheme);
  const [activeSection, setActiveSection]   = useState('');
  const { user, signOut } = useAuth();

  // Apply persisted theme on mount
  useEffect(() => { applyTheme(isDark); }, []);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close More dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
      const sections = ALL_NAV.map(n => n.href.replace('#', ''));
      let current = '';
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 100 && rect.bottom >= 100) { current = id; break; }
        }
      }
      setActiveSection(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const id = href.replace('#', '');
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    setIsMobileOpen(false);
    setIsMoreOpen(false);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next);
  };

  const isMoreActive = MORE_NAV.some(n => n.href.replace('#', '') === activeSection);

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'glass py-2' : 'bg-transparent py-4'
      }`}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-4">

          {/* ── Logo ───────────────────────────────────────────── */}
          <a
            href="#"
            onClick={e => handleNavClick(e as any, '#')}
            className="flex items-center gap-2.5 group shrink-0"
          >
            <img
              src={hsmcLogo}
              alt="HSMC Logo"
              className="h-8 w-auto object-contain drop-shadow-[0_0_8px_rgba(59,130,246,0.6)] group-hover:drop-shadow-[0_0_14px_rgba(59,130,246,0.9)] transition-all duration-300"
            />
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold gradient-text">HSMC</span>
              <span className="text-[10px] text-muted-foreground">Network</span>
            </div>
          </a>

          {/* ── Desktop primary nav ────────────────────────────── */}
          <div className="hidden lg:flex items-center">
            {PRIMARY_NAV.map((item) => {
              const id = item.href.replace('#', '');
              const isActive = activeSection === id;
              return (
                <a
                  key={item.name}
                  href={item.href}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={`relative px-2.5 py-2 text-xs font-mono whitespace-nowrap transition-colors group ${
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {item.name}
                  <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 bg-gradient-to-r from-primary to-secondary transition-all duration-300 ${isActive ? 'w-full' : 'w-0 group-hover:w-full'}`} />
                </a>
              );
            })}

            {/* More dropdown */}
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setIsMoreOpen(v => !v)}
                className={`flex items-center gap-1 px-2.5 py-2 text-xs font-mono transition-colors rounded ${
                  isMoreActive || isMoreOpen
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                More
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isMoreOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {isMoreOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1 w-40 glass rounded-xl border border-border/50 shadow-lg overflow-hidden"
                  >
                    {MORE_NAV.map((item) => {
                      const id = item.href.replace('#', '');
                      const isActive = activeSection === id;
                      return (
                        <a
                          key={item.name}
                          href={item.href}
                          onClick={(e) => handleNavClick(e, item.href)}
                          className={`block px-4 py-2.5 text-xs font-mono transition-colors ${
                            isActive
                              ? 'text-primary bg-primary/10'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          }`}
                        >
                          {item.name}
                        </a>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Spacer ─────────────────────────────────────────── */}
          <div className="flex-1" />

          {/* ── Right controls ─────────────────────────────────── */}
          <div className="flex items-center gap-1">
            <NodeStatusBadge className="hidden 2xl:flex" />

            <a
              href="/whitepaper"
              className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Whitepaper
            </a>
            <a
              href="/mainnet"
              className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Cpu className="w-3.5 h-3.5" />
              Mainnet
            </a>

            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground w-8 h-8">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            <NotificationsPanel />

            {user ? (
              <div className="flex items-center gap-1">
                <a href="/app">
                  <Button variant="hero" size="sm" className="gap-1.5 h-8 text-xs px-3">
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Platform</span>
                  </Button>
                </a>
                <a
                  href="/app/settings"
                  className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/50 rounded-lg hover:bg-muted/70 transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </a>
                <a
                  href="/app/profile"
                  className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-muted rounded-lg hover:bg-muted/70 transition-colors max-w-[140px]"
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-foreground truncate font-mono">
                    {user.email?.includes('@hsmc.wallet')
                      ? `${user.email.split('@')[0].slice(0, 6)}...${user.email.split('@')[0].slice(-4)}`
                      : user.email?.split('@')[0]}
                  </span>
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => signOut()}
                  className="text-muted-foreground hover:text-destructive w-8 h-8"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <a href="/onboarding">
                <Button variant="hero" size="sm" className="hidden sm:flex h-8 text-xs px-3">
                  Launch App
                </Button>
              </a>
            )}

            {/* Mobile hamburger */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden w-8 h-8"
              onClick={() => setIsMobileOpen(v => !v)}
            >
              {isMobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Mobile Menu ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden glass mt-2 mx-4 rounded-xl overflow-hidden"
          >
            <div className="p-4 space-y-1 max-h-[70vh] overflow-y-auto">
              {ALL_NAV.map((item) => {
                const id = item.href.replace('#', '');
                const isActive = activeSection === id;
                return (
                  <a
                    key={item.name}
                    href={item.href}
                    className={`block px-4 py-2.5 rounded-lg transition-colors text-sm font-mono ${
                      isActive
                        ? 'text-primary bg-primary/10 border border-primary/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                    onClick={(e) => handleNavClick(e, item.href)}
                  >
                    {item.name}
                  </a>
                );
              })}

              <div className="pt-2 border-t border-border/50 flex flex-col gap-2">
                <a href="/whitepaper">
                  <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                    <FileText className="w-3.5 h-3.5" /> Whitepaper
                  </Button>
                </a>
                <a href="/mainnet">
                  <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                    <Cpu className="w-3.5 h-3.5" /> Mainnet
                  </Button>
                </a>
                {user ? (
                  <Button variant="outline" className="w-full gap-2 text-xs" onClick={() => signOut()}>
                    <LogOut className="w-3.5 h-3.5" /> Sign Out
                  </Button>
                ) : (
                  <a href="/onboarding" className="block">
                    <Button variant="hero" className="w-full" onClick={() => setIsMobileOpen(false)}>
                      Launch App
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};

export default Navbar;
