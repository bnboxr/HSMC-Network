import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Vote, Plus, ChevronDown, ChevronUp, Loader2, Clock, Users, CheckCircle, XCircle, Info } from 'lucide-react';
import { supabase } from '@/integrations/db/client';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

interface Proposal {
  id: string;
  title: string;
  description: string;
  proposer_address: string;
  proposal_type: string;
  status: string;
  votes_for: number;
  votes_against: number;
  quorum_required: number;
  parameter_key: string | null;
  parameter_value: string | null;
  ends_at: string;
  created_at: string;
}

function timeLeft(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

export const GovernanceSection = () => {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voting, setVoting] = useState<string | null>(null);
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', proposal_type: 'parameter_change', parameter_key: '', parameter_value: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('governance_proposals')
        .select('*')
        .order('created_at', { ascending: false });
      if (data) setProposals(data as Proposal[]);
      setLoading(false);
    };
    fetch();

    // Fetch user's existing votes
    if (user) {
      supabase
        .from('governance_votes')
        .select('proposal_id, vote_choice')
        .eq('user_id', user.id)
        .then(({ data }) => {
          if (data) {
            const map: Record<string, string> = {};
            data.forEach(v => { map[v.proposal_id] = v.vote_choice; });
            setUserVotes(map);
          }
        });
    }

    const channel = supabase
      .channel('governance-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'governance_proposals' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setProposals(prev => [payload.new as Proposal, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setProposals(prev => prev.map(p => p.id === payload.new.id ? payload.new as Proposal : p));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleVote = async (proposalId: string, choice: 'for' | 'against') => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }
    if (userVotes[proposalId]) {
      toast({ title: 'Already voted', description: 'You have already voted on this proposal.', variant: 'destructive' });
      return;
    }

    setVoting(proposalId + choice);
    const { error } = await supabase.from('governance_votes').insert({
      proposal_id: proposalId,
      user_id: user.id,
      voter_address: wallet.address,
      vote_choice: choice,
      vote_weight: Math.max(1, Math.floor(wallet.balance / 100)),
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setUserVotes(prev => ({ ...prev, [proposalId]: choice }));
      // Update vote counts locally
      const weight = Math.max(1, Math.floor(wallet.balance / 100));
      setProposals(prev => prev.map(p => {
        if (p.id !== proposalId) return p;
        return choice === 'for'
          ? { ...p, votes_for: p.votes_for + weight }
          : { ...p, votes_against: p.votes_against + weight };
      }));
      toast({ title: `Voted ${choice}!`, description: `Your vote has been recorded with weight ${weight}.` });
    }
    setVoting(null);
  };

  const handleCreate = async () => {
    if (!user || !wallet) {
      toast({ title: 'Sign in required', variant: 'destructive' });
      return;
    }
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: 'Fill in all fields', variant: 'destructive' });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from('governance_proposals').insert({
      title: form.title.trim(),
      description: form.description.trim(),
      proposer_address: wallet.address,
      user_id: user.id,
      proposal_type: form.proposal_type,
      parameter_key: form.parameter_key || null,
      parameter_value: form.parameter_value || null,
    });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Proposal created!', description: 'Your proposal is now live for voting.' });
      setForm({ title: '', description: '', proposal_type: 'parameter_change', parameter_key: '', parameter_value: '' });
      setShowCreate(false);
    }
    setCreating(false);
  };

  return (
    <section id="governance" className="py-20">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            On-Chain <span className="gradient-text">Governance</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Vote on protocol changes — APR, ring size, block reward, and more. Real on-chain governance stored in the database.
          </p>
        </motion.div>

        {/* Create Proposal Button */}
        <div className="flex justify-end mb-6">
          <Button
            variant="hero"
            size="sm"
            className="gap-2"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </Button>
        </div>

        {/* Create Form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="glass-panel mb-6"
            >
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Vote className="w-5 h-5 text-primary" />
                Create Governance Proposal
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Title</label>
                  <Input placeholder="e.g. Increase Staking APR to 18%" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Description</label>
                  <textarea
                    className="w-full bg-muted/20 border border-border rounded-lg p-3 text-sm outline-none focus:border-primary/50 resize-none"
                    rows={3}
                    placeholder="Detailed explanation of the proposal..."
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Type</label>
                    <select
                      className="w-full bg-muted/20 border border-border rounded-lg p-2 text-sm outline-none"
                      value={form.proposal_type}
                      onChange={e => setForm(f => ({ ...f, proposal_type: e.target.value }))}
                    >
                      <option value="parameter_change">Parameter Change</option>
                      <option value="upgrade">Protocol Upgrade</option>
                      <option value="treasury">Treasury Spend</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Parameter Key (optional)</label>
                    <Input placeholder="e.g. staking_apr" value={form.parameter_key} onChange={e => setForm(f => ({ ...f, parameter_key: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="hero" onClick={handleCreate} disabled={creating} className="gap-2">
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    Submit Proposal
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Proposals */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : proposals.length === 0 ? (
          <div className="glass-panel text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
            <Info className="w-10 h-10 text-muted-foreground/40" />
            <p>No governance proposals yet.</p>
            <p className="text-xs">Be the first to submit a proposal for the HSMC protocol.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal, idx) => {
              const total = proposal.votes_for + proposal.votes_against;
              const forPct = total > 0 ? (proposal.votes_for / total) * 100 : 0;
              const againstPct = total > 0 ? (proposal.votes_against / total) * 100 : 0;
              const quorumPct = Math.min(100, (total / proposal.quorum_required) * 100);
              const myVote = userVotes[proposal.id];
              const isExpanded = expanded === proposal.id;

              return (
                <motion.div
                  key={proposal.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.05 }}
                  className="glass-card overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : proposal.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`px-2 py-1 text-xs rounded-full border flex-shrink-0 ${
                        proposal.status === 'active' ? 'border-secondary text-secondary' :
                        proposal.status === 'passed' ? 'border-green-500 text-green-500' :
                        'border-destructive text-destructive'
                      }`}>
                        {proposal.status}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{proposal.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {timeLeft(proposal.ends_at)}
                          <Users className="w-3 h-3 ml-2" />
                          {total} votes
                        </div>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-border"
                      >
                        <div className="p-4 space-y-4">
                          <p className="text-sm text-muted-foreground">{proposal.description}</p>

                          {proposal.parameter_key && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">Parameter:</span>
                              <span className="font-mono bg-muted/30 px-2 py-0.5 rounded">{proposal.parameter_key}</span>
                              {proposal.parameter_value && (
                                <>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-mono bg-primary/10 px-2 py-0.5 rounded text-primary">{proposal.parameter_value}</span>
                                </>
                              )}
                            </div>
                          )}

                          {/* Vote bars */}
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-secondary flex items-center gap-1"><CheckCircle className="w-3 h-3" /> For</span>
                                <span>{proposal.votes_for} ({forPct.toFixed(0)}%)</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-secondary rounded-full transition-all" style={{ width: `${forPct}%` }} />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-destructive flex items-center gap-1"><XCircle className="w-3 h-3" /> Against</span>
                                <span>{proposal.votes_against} ({againstPct.toFixed(0)}%)</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-destructive rounded-full transition-all" style={{ width: `${againstPct}%` }} />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-muted-foreground">Quorum</span>
                                <span>{total}/{proposal.quorum_required} ({quorumPct.toFixed(0)}%)</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${quorumPct}%` }} />
                              </div>
                            </div>
                          </div>

                          {/* Voting buttons */}
                          {proposal.status === 'active' && (
                            <div className="flex gap-3">
                              {myVote ? (
                                <div className={`text-sm px-3 py-1.5 rounded-lg ${myVote === 'for' ? 'bg-secondary/20 text-secondary' : 'bg-destructive/20 text-destructive'}`}>
                                  You voted: {myVote}
                                </div>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    className="gap-1 bg-secondary/20 hover:bg-secondary/40 text-secondary border border-secondary/30"
                                    variant="outline"
                                    onClick={() => handleVote(proposal.id, 'for')}
                                    disabled={voting === proposal.id + 'for'}
                                  >
                                    {voting === proposal.id + 'for' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                    Vote For
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 border-destructive/30 text-destructive hover:bg-destructive/20"
                                    onClick={() => handleVote(proposal.id, 'against')}
                                    disabled={voting === proposal.id + 'against'}
                                  >
                                    {voting === proposal.id + 'against' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                    Vote Against
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
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

export default GovernanceSection;
