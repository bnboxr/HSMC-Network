import { useState } from 'react';
import { motion } from 'framer-motion';
import { Github, Mail, ExternalLink, Activity, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { toast } from '@/hooks/use-toast';

// Anon client for unauthenticated newsletter inserts
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dHp5bndxaWtqanB4c3dnamthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NzYzOTIsImV4cCI6MjA4NDQ1MjM5Mn0.mnTjonQh-LcpzpN8DCthtf0bEBvbNw2JxncBNQE7nEE';
const API_URL = 'https://xztzynwqikjjpxswgjka.supabase.co';

const footerLinks = {
  product: [
    { name: 'Dashboard', href: '/app', external: false },
    { name: 'Explorer', href: '/app#explorer', external: false },
    { name: 'Terminal', href: '/app#terminal', external: false },
    { name: 'Documentation', href: '/whitepaper', external: false },
  ],
  developers: [
    { name: 'API Reference', href: '/whitepaper#api', external: false },
    { name: 'CLI Tools', href: '/mainnet#node', external: false },
    { name: 'Bridge Docs', href: '/whitepaper#bridge', external: false },
  ],
  community: [
    { name: 'GitHub', href: 'https://github.com/XMC-OXR', external: true },
    { name: 'Email', href: 'mailto:contact@hsmc.io', external: true },
  ],
  company: [
    { name: 'About', href: '/#about', external: false },
    { name: 'Investors', href: '/investors', external: false },
    { name: 'Listing Kit', href: '/listing-kit', external: false },
    { name: 'Mainnet Hub', href: '/mainnet', external: false },
  ],
};

const socialLinks = [
  { icon: Github, href: 'https://github.com/XMC-OXR', label: 'GitHub' },
  { icon: Mail, href: 'mailto:contact@hsmc.io', label: 'Email' },
];

const teamMembers = [
  { name: 'Ifrim George', role: 'Founder & CEO', initials: 'IG', color: 'var(--gradient-primary)' },
  { name: 'Sarah Kim', role: 'CTO', initials: 'SK', color: 'var(--gradient-accent)' },
  { name: 'OXR.org', role: 'Lead Engineer', initials: 'OX', color: 'var(--gradient-gold)' },
  { name: 'Elena Rodriguez', role: 'Protocol Architect', initials: 'ER', color: 'var(--gradient-primary)' },
];

const NewsletterForm = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      toast({ title: 'Email invalid', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      // Use REST API directly with anon key — works without auth for public INSERT
      const res = await fetch(
        `${API_URL}/rest/v1/newsletter_subscribers`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': ANON_KEY,
            'Authorization': `Bearer ${ANON_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ email: email.trim().toLowerCase(), source: 'footer' }),
        }
      );
      if (res.status === 409) {
        // Already subscribed — treat as success, not error
        setDone(true);
        setEmail('');
        toast({ title: '✅ Deja abonat!', description: 'Acest email este deja înregistrat.' });
      } else if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Subscribe failed');
      } else {
        setDone(true);
        setEmail('');
        toast({ title: '✅ Abonat!', description: 'Vei primi actualizările HSMC.' });
      }
    } catch (err: unknown) {
      toast({ title: 'Eroare', description: String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2 text-secondary text-sm">
        <CheckCircle2 className="w-4 h-4" />
        <span>Subscribed! Thank you.</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubscribe} className="flex gap-2 mt-2">
      <Input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="h-8 text-xs bg-muted/30 border-border/40"
      />
      <Button type="submit" size="sm" className="h-8 px-3 gap-1.5" disabled={loading}>
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        {loading ? '' : 'Sub'}
      </Button>
    </form>
  );
};

export const Footer = () => {
  return (
    <>
      {/* About Section */}
      <section id="about" className="py-24 gradient-mesh border-t border-border/40">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="section-eyebrow mb-4">About Us</p>
            <h2 className="text-3xl sm:text-4xl font-black mb-4" style={{ fontFamily: 'var(--font-serif)' }}>
              Building the Future of{' '}
              <span className="gradient-text">Decentralized Finance</span>
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              HSMC Chain — privacy-first, multichain, production-grade blockchain infrastructure.
            </p>
          </motion.div>

          {/* Mission */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto mb-16"
          >
            <div className="glass-panel text-center">
              <h3 className="text-lg font-semibold mb-3">Our Mission</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">
                HSMC was founded to create a blockchain network combining the privacy and 
                security of Monero-style cryptography with the performance required for enterprise 
                and consumer applications. We implement Ring Signatures, Stealth Addresses, and 
                RingCT to ensure financial privacy without compromise. Our team of cryptographers, 
                distributed systems engineers, and blockchain pioneers are dedicated to pushing 
                the boundaries of what's possible.
              </p>
            </div>
          </motion.div>

          {/* Team */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <h3 className="text-lg font-semibold text-center mb-8 text-muted-foreground uppercase tracking-wider text-sm">Core Team</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={member.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.08 }}
                  className="glass-card p-5 text-center group hover:border-primary/30 transition-all duration-200"
                >
                  <div
                    className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center text-primary-foreground font-bold text-sm"
                    style={{ background: member.color }}
                  >
                    {member.initials}
                  </div>
                  <div className="font-semibold text-sm">{member.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{member.role}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center"
          >
            <div className="inline-block glass-panel max-w-md w-full">
              <h3 className="text-xl font-bold mb-2">Ready to Build?</h3>
              <p className="text-muted-foreground text-sm mb-5">
                Join the HSMC ecosystem
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button size="sm" className="gap-2 bg-primary text-primary-foreground">
                  Get Started
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm">
                  Join Community
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-12 bg-background/50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-8 mb-10">
            <div className="col-span-2">
              <a href="#" className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--gradient-primary)' }}>
                  <Activity className="w-4.5 h-4.5 text-primary-foreground" />
                </div>
                <div className="flex flex-col leading-none">
                  <span className="text-sm font-black gradient-text" style={{ fontFamily: 'var(--font-serif)' }}>HSMC</span>
                  <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-widest -mt-0.5">Chain v2.1.4</span>
                </div>
              </a>
              <p className="text-xs text-muted-foreground mb-4 max-w-xs leading-relaxed">
                Next-generation privacy blockchain. Ring Signatures · Stealth Addresses · RingCT · wHSMC on BSC, Ethereum & Polygon.
              </p>
              <div className="flex items-center gap-2 mb-5">
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-muted/40 hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                    aria-label={social.label}
                  >
                    <social.icon className="w-3.5 h-3.5" />
                  </a>
                ))}
              </div>
              {/* Newsletter */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-1">Stay updated</p>
                <p className="text-xs text-muted-foreground mb-2">Get HSMC news & releases</p>
                <NewsletterForm />
              </div>
            </div>

            {Object.entries(footerLinks).map(([section, links]) => (
              <div key={section}>
                <h4 className="font-semibold mb-3 text-xs uppercase tracking-widest text-muted-foreground">{section}</h4>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noopener noreferrer' : undefined}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 group"
                      >
                        {link.name}
                        {link.external && <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="pt-6 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground font-mono">© 2026 HSMC. All rights reserved.</span>
            <div className="flex items-center gap-5 text-xs text-muted-foreground">
              <a href="/whitepaper#privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
              <a href="/whitepaper#terms" className="hover:text-foreground transition-colors">Terms of Service</a>
              <a href="/whitepaper#cookies" className="hover:text-foreground transition-colors">Cookie Policy</a>
            </div>
            <span className="text-xs font-mono text-muted-foreground/50">Built by Ifrim George & OXR.org</span>
          </div>
        </div>
      </footer>
    </>
  );
};

export default Footer;
