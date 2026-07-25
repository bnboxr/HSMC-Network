/// On-chain governance: proposals, voting, parameter changes, treasury
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use thiserror::Error;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalType {
    ParameterChange {
        key: String,
        old_value: String,
        new_value: String,
    },
    TreasurySpend {
        recipient: String,
        amount_hsmc: u64,
        purpose: String,
    },
    TextProposal {
        title: String,
        description: String,
    },
    EmergencyUpgrade {
        version: String,
        upgrade_height: u64,
        checksum: String,
    },
    SlashingProposal {
        validator_address: String,
        slash_percent: u8,
        evidence_hash: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalStatus {
    Draft,
    Active,
    Passed,
    Rejected,
    Enacted,
    Expired,
    Vetoed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteChoice {
    pub voter: String,
    pub choice: VoteOption,
    pub weight: u64,       // voting power (staked balance)
    pub timestamp: i64,
    pub signature: String, // proof of voting key ownership
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteOption {
    Yes,
    No,
    Abstain,
    NoWithVeto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceProposal {
    pub id: String,
    pub proposer: String,
    pub proposal_type: ProposalType,
    pub status: ProposalStatus,
    pub deposit: u64,             // HSMC deposit to prevent spam
    pub min_deposit: u64,
    pub submit_time: DateTime<Utc>,
    pub deposit_end_time: DateTime<Utc>,
    pub voting_start_time: Option<DateTime<Utc>>,
    pub voting_end_time: Option<DateTime<Utc>>,
    pub tally: TallyResult,
    pub votes: HashMap<String, VoteChoice>, // voter_address → choice
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TallyResult {
    pub yes:          u64,
    pub no:           u64,
    pub abstain:      u64,
    pub no_with_veto: u64,
    pub total_voting_power: u64,
}

impl TallyResult {
    pub fn yes_ratio(&self) -> f64 {
        if self.total_voting_power == 0 { return 0.0; }
        self.yes as f64 / self.total_voting_power as f64
    }

    pub fn veto_ratio(&self) -> f64 {
        if self.total_voting_power == 0 { return 0.0; }
        self.no_with_veto as f64 / self.total_voting_power as f64
    }

    pub fn quorum_ratio(&self) -> f64 {
        if self.total_voting_power == 0 { return 0.0; }
        let voted = self.yes + self.no + self.abstain + self.no_with_veto;
        voted as f64 / self.total_voting_power as f64
    }
}

// ─── Governance Parameters ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceParams {
    pub min_deposit_hsmc: u64,      // Minimum deposit to enter voting: default 1000 HSMC
    pub max_deposit_period_secs: i64, // 48 hours
    pub voting_period_secs: i64,    // 7 days
    pub quorum: f64,                // 33.4% of total staked must vote
    pub threshold: f64,             // 50% of YES votes must pass
    pub veto_threshold: f64,        // 33.4% NO_WITH_VETO rejects
    pub min_proposal_deposit: u64,
    pub deposit_refund_on_pass: bool,
    pub deposit_burn_on_veto: bool,
    pub timelock_hours: u64,           // delay before proposal enactment (default: 48 hours)
}

impl Default for GovernanceParams {
    fn default() -> Self {
        Self {
            min_deposit_hsmc: 1_000 * 100_000_000, // 1000 HSMC in satoshis
            max_deposit_period_secs: 48 * 3600,
            voting_period_secs: 7 * 24 * 3600,
            quorum: 0.334,
            threshold: 0.5,
            veto_threshold: 0.334,
            min_proposal_deposit: 100 * 100_000_000,
            deposit_refund_on_pass: true,
            deposit_burn_on_veto: true,
            timelock_hours: 48,
        }
    }
}

// ─── Governance Timelock ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceTimelock {
    pub proposal_id: String,
    pub enacted_at: DateTime<Utc>,
    pub executable_at: DateTime<Utc>,
}

impl GovernanceTimelock {
    pub fn is_executable(&self) -> bool {
        Utc::now() >= self.executable_at
    }
}

// ─── Governance Engine ────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum GovernanceError {
    #[error("Insufficient deposit: need {needed}, got {provided}")]
    InsufficientDeposit { needed: u64, provided: u64 },
    #[error("Proposal not found: {0}")]
    ProposalNotFound(String),
    #[error("Voting not active for proposal {0}")]
    VotingNotActive(String),
    #[error("Voter already voted")]
    AlreadyVoted,
    #[error("Voter not found: {0}")]
    VoterNotFound(String),
    #[error("Invalid vote weight: {0}")]
    InvalidWeight(u64),
    #[error("Proposal already in status: {:?}", .0)]
    InvalidStatus(ProposalStatus),
    #[error("Timelock not yet expired for proposal {0}")]
    TimelockNotExpired(String),
    #[error("No timelock found for proposal {0}")]
    NoTimelockFound(String),
    #[error("Proposal already enacted: {0}")]
    AlreadyEnacted(String),
    #[error("Only passed proposals can be executed, got: {:?}", .0)]
    NotPassed(ProposalStatus),
    #[error("Parameter key too long: {0}")]
    ParameterTooLong(String),
    #[error("Invalid parameter value for key {key}: {value}")]
    InvalidParameter { key: String, value: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryRecord {
    pub balance_hsmc: u64,
    pub total_collected: u64,
    pub total_spent: u64,
    pub spend_history: Vec<TreasurySpendRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasurySpendRecord {
    pub proposal_id: String,
    pub recipient: String,
    pub amount_hsmc: u64,
    pub purpose: String,
    pub executed_at: DateTime<Utc>,
    pub tx_hash: String,
}

// ─── Governance Snapshot (for persistence) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceSnapshot {
    pub proposals: Vec<GovernanceProposal>,
    pub enacted_parameters: HashMap<String, String>,
    pub timelocks: Vec<GovernanceTimelock>,
    pub treasury: TreasuryRecord,
    pub params: GovernanceParams,
}

pub struct GovernanceEngine {
    pub proposals: HashMap<String, GovernanceProposal>,
    pub params: GovernanceParams,
    pub enacted_parameters: HashMap<String, String>,
    pub timelocks: HashMap<String, GovernanceTimelock>,
    pub treasury: TreasuryRecord,
}

impl GovernanceEngine {
    pub fn new() -> Self {
        let mut enacted_parameters = HashMap::new();
        // Default chain parameters controlled by governance
        enacted_parameters.insert("block_reward_initial".into(), "5000000000".into()); // 50 HSMC
        enacted_parameters.insert("halving_interval".into(), "210000".into());
        enacted_parameters.insert("max_block_size".into(), "4000000".into()); // 4MB
        enacted_parameters.insert("target_block_time_secs".into(), "120".into()); // 2 min
        enacted_parameters.insert("min_fee_rate".into(), "1000".into()); // 1000 sat/byte
        enacted_parameters.insert("max_tx_per_block".into(), "5000".into());
        enacted_parameters.insert("ring_size_min".into(), "11".into());
        enacted_parameters.insert("ring_size_max".into(), "50".into());
        enacted_parameters.insert("staking_min_amount".into(), "100000000".into()); // 1 HSMC
        enacted_parameters.insert("treasury_tax_bps".into(), "200".into()); // 2%

        let treasury = TreasuryRecord {
            balance_hsmc: 0,
            total_collected: 0,
            total_spent: 0,
            spend_history: Vec::new(),
        };

        Self {
            proposals: HashMap::new(),
            params: GovernanceParams::default(),
            enacted_parameters,
            timelocks: HashMap::new(),
            treasury,
        }
    }

    /// Submit a new governance proposal
    pub fn submit_proposal(
        &mut self,
        id: String,
        proposer: String,
        proposal_type: ProposalType,
        initial_deposit: u64,
    ) -> Result<&GovernanceProposal, GovernanceError> {
        if initial_deposit < self.params.min_proposal_deposit {
            return Err(GovernanceError::InsufficientDeposit {
                needed: self.params.min_proposal_deposit,
                provided: initial_deposit,
            });
        }

        let now = Utc::now();
        let deposit_end = now + chrono::Duration::seconds(self.params.max_deposit_period_secs);

        let proposal = GovernanceProposal {
            id: id.clone(),
            proposer,
            proposal_type,
            status: if initial_deposit >= self.params.min_deposit_hsmc {
                ProposalStatus::Active
            } else {
                ProposalStatus::Draft
            },
            deposit: initial_deposit,
            min_deposit: self.params.min_deposit_hsmc,
            submit_time: now,
            deposit_end_time: deposit_end,
            voting_start_time: if initial_deposit >= self.params.min_deposit_hsmc {
                Some(now)
            } else {
                None
            },
            voting_end_time: if initial_deposit >= self.params.min_deposit_hsmc {
                Some(now + chrono::Duration::seconds(self.params.voting_period_secs))
            } else {
                None
            },
            tally: TallyResult::default(),
            votes: HashMap::new(),
            metadata: HashMap::new(),
        };

        self.proposals.insert(id.clone(), proposal);
        self.proposals.get(&id)
            .ok_or_else(|| GovernanceError::ProposalNotFound(id.clone()))
    }

    /// Cast a vote on a proposal
    pub fn vote(
        &mut self,
        proposal_id: &str,
        voter: String,
        choice: VoteOption,
        weight: u64,
        signature: String,
    ) -> Result<(), GovernanceError> {
        let proposal = self.proposals.get_mut(proposal_id)
            .ok_or_else(|| GovernanceError::ProposalNotFound(proposal_id.into()))?;

        if proposal.status != ProposalStatus::Active {
            return Err(GovernanceError::VotingNotActive(proposal_id.into()));
        }

        if proposal.votes.contains_key(&voter) {
            // Allow vote change — remove old tally
            let old_vote = proposal.votes.remove(&voter)
                .ok_or_else(|| GovernanceError::VoterNotFound(voter.clone()))?;
            Self::subtract_tally(&mut proposal.tally, old_vote.choice, old_vote.weight);
        }

        // Add new vote
        Self::add_tally(&mut proposal.tally, choice, weight);
        proposal.votes.insert(voter.clone(), VoteChoice {
            voter,
            choice,
            weight,
            timestamp: Utc::now().timestamp(),
            signature,
        });

        Ok(())
    }

    fn add_tally(tally: &mut TallyResult, choice: VoteOption, weight: u64) {
        match choice {
            VoteOption::Yes => tally.yes += weight,
            VoteOption::No => tally.no += weight,
            VoteOption::Abstain => tally.abstain += weight,
            VoteOption::NoWithVeto => tally.no_with_veto += weight,
        }
    }

    fn subtract_tally(tally: &mut TallyResult, choice: VoteOption, weight: u64) {
        match choice {
            VoteOption::Yes => tally.yes = tally.yes.saturating_sub(weight),
            VoteOption::No => tally.no = tally.no.saturating_sub(weight),
            VoteOption::Abstain => tally.abstain = tally.abstain.saturating_sub(weight),
            VoteOption::NoWithVeto => tally.no_with_veto = tally.no_with_veto.saturating_sub(weight),
        }
    }

    /// Tally and finalize a proposal (call after voting period)
    pub fn tally_and_finalize(
        &mut self,
        proposal_id: &str,
        total_staked: u64,
    ) -> Result<ProposalStatus, GovernanceError> {
        let proposal = self.proposals.get_mut(proposal_id)
            .ok_or_else(|| GovernanceError::ProposalNotFound(proposal_id.into()))?;

        proposal.tally.total_voting_power = total_staked;

        let status = if proposal.tally.veto_ratio() > self.params.veto_threshold {
            ProposalStatus::Vetoed
        } else if proposal.tally.quorum_ratio() < self.params.quorum {
            ProposalStatus::Rejected // Failed quorum
        } else if proposal.tally.yes_ratio() > self.params.threshold {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Rejected
        };

        proposal.status = status.clone();

        // Create timelock for passed proposals
        if status == ProposalStatus::Passed {
            let now = Utc::now();
            let timelock = GovernanceTimelock {
                proposal_id: proposal_id.to_string(),
                enacted_at: now,
                executable_at: now + chrono::Duration::hours(self.params.timelock_hours as i64),
            };
            self.timelocks.insert(proposal_id.to_string(), timelock);
        }

        Ok(proposal.status.clone())
    }

    /// Get parameter value with type parsing
    pub fn get_param_u64(&self, key: &str) -> Option<u64> {
        self.enacted_parameters.get(key)?.parse().ok()
    }

    pub fn get_param_f64(&self, key: &str) -> Option<f64> {
        self.enacted_parameters.get(key)?.parse().ok()
    }

    /// Execute a proposal after timelock expires.
    /// Idempotent: returns AlreadyEnacted error if already enacted.
    pub fn execute(
        &mut self,
        proposal_id: &str,
        block_height: u64,
    ) -> Result<ProposalType, GovernanceError> {
        // ── 1. Look up the proposal ────────────────────────────────────────
        let proposal = self.proposals.get(proposal_id)
            .ok_or_else(|| GovernanceError::ProposalNotFound(proposal_id.into()))?;

        // ── 2. Status guard: must be Passed, not already Enacted ───────────
        match &proposal.status {
            ProposalStatus::Enacted => {
                return Err(GovernanceError::AlreadyEnacted(proposal_id.into()));
            }
            ProposalStatus::Passed => { /* ok */ }
            other => {
                return Err(GovernanceError::NotPassed(other.clone()));
            }
        }

        // ── 3. Timelock guard ──────────────────────────────────────────────
        let timelock = self.timelocks.get(proposal_id)
            .ok_or_else(|| GovernanceError::NoTimelockFound(proposal_id.into()))?;

        if !timelock.is_executable() {
            return Err(GovernanceError::TimelockNotExpired(proposal_id.into()));
        }

        // ── 4. Match on ProposalType and apply changes ─────────────────────
        let proposal_type = proposal.proposal_type.clone();

        match &proposal_type {
            ProposalType::ParameterChange { key, old_value: _, new_value } => {
                // Validate key length
                if key.len() > 64 {
                    return Err(GovernanceError::ParameterTooLong(key.clone()));
                }
                // Write enacted parameter
                self.enacted_parameters.insert(key.clone(), new_value.clone());
                tracing::info!(
                    key = %key,
                    new_value = %new_value,
                    proposal_id = %proposal_id,
                    "📜 Governance: parameter change enacted"
                );
            }
            ProposalType::TreasurySpend { recipient, amount_hsmc, purpose } => {
                if *amount_hsmc > self.treasury.balance_hsmc {
                    return Err(GovernanceError::InvalidParameter {
                        key: "amount_hsmc".into(),
                        value: format!("{} > treasury balance {}", amount_hsmc, self.treasury.balance_hsmc),
                    });
                }
                self.treasury.balance_hsmc -= amount_hsmc;
                self.treasury.total_spent += amount_hsmc;
                let tx_hash = format!("gov-treasury-{}-{}", proposal_id, Utc::now().timestamp());
                self.treasury.spend_history.push(TreasurySpendRecord {
                    proposal_id: proposal_id.to_string(),
                    recipient: recipient.clone(),
                    amount_hsmc: *amount_hsmc,
                    purpose: purpose.clone(),
                    executed_at: Utc::now(),
                    tx_hash,
                });
                tracing::info!(
                    recipient = %recipient,
                    amount = amount_hsmc,
                    proposal_id = %proposal_id,
                    "💰 Governance: treasury spend enacted"
                );
            }
            ProposalType::EmergencyUpgrade { version, upgrade_height, checksum: _ } => {
                // Schedule upgrade height — stored as a special parameter
                self.enacted_parameters.insert(
                    "emergency_upgrade_height".into(),
                    upgrade_height.to_string(),
                );
                self.enacted_parameters.insert(
                    "emergency_upgrade_version".into(),
                    version.clone(),
                );
                tracing::warn!(
                    version = %version,
                    upgrade_height = upgrade_height,
                    proposal_id = %proposal_id,
                    "🚨 Governance: emergency upgrade scheduled"
                );
            }
            ProposalType::TextProposal { .. } => {
                // Text proposals are informational — mark as enacted with no side effects
                tracing::info!(
                    proposal_id = %proposal_id,
                    "📋 Governance: text proposal enacted (no on-chain changes)"
                );
            }
            ProposalType::SlashingProposal { validator_address, slash_percent, evidence_hash: _ } => {
                // Store slashing record for validator module to consume
                self.enacted_parameters.insert(
                    format!("slash_{}", proposal_id),
                    format!("{}:{}%", validator_address, slash_percent),
                );
                tracing::warn!(
                    validator = %validator_address,
                    slash_pct = slash_percent,
                    proposal_id = %proposal_id,
                    "⚡ Governance: slashing proposal enacted"
                );
            }
        }

        // ── 5. Update proposal status ──────────────────────────────────────
        let proposal = self.proposals.get_mut(proposal_id)
            .ok_or_else(|| GovernanceError::ProposalNotFound(proposal_id.into()))?;
        proposal.status = ProposalStatus::Enacted;

        // ── 6. Remove timelock ─────────────────────────────────────────────
        self.timelocks.remove(proposal_id);

        Ok(proposal_type)
    }

    /// Finalize proposals whose voting period has expired.
    /// Called periodically by the governance processor.
    pub fn finalize_expired(&mut self, now_unix: u64) -> Vec<(String, ProposalStatus)> {
        let mut finalized = Vec::new();
        let now = DateTime::from_timestamp(now_unix as i64, 0).unwrap_or_else(|| Utc::now());
        let total_staked = self.get_param_u64("total_staked").unwrap_or(0);

        let proposal_ids: Vec<String> = self.proposals.keys().cloned().collect();
        for id in proposal_ids {
            let should_finalize = {
                let p = match self.proposals.get(&id) {
                    Some(p) => p,
                    None => continue,
                };
                p.status == ProposalStatus::Active
                    && p.voting_end_time.map(|t| now >= t).unwrap_or(false)
            };

            if should_finalize {
                match self.tally_and_finalize(&id, total_staked) {
                    Ok(status) => {
                        finalized.push((id.clone(), status));
                    }
                    Err(e) => {
                        tracing::warn!(proposal_id = %id, error = %e, "Failed to finalize proposal");
                    }
                }
            }
        }
        finalized
    }

    /// Enact all passed proposals whose timelocks have expired.
    /// Called periodically by the governance processor (auto-execute).
    pub fn enact_passed_proposals(&mut self) -> Vec<String> {
        let block_height = 0u64; // Will be set by caller context if needed
        let executable_ids: Vec<String> = self.timelocks
            .iter()
            .filter(|(_, t)| t.is_executable())
            .map(|(id, _)| id.clone())
            .collect();

        let mut enacted = Vec::new();

        for id in executable_ids {
            match self.execute(&id, block_height) {
                Ok(_) => {
                    enacted.push(id.clone());
                }
                Err(e) => {
                    tracing::debug!(proposal_id = %id, error = %e, "Proposal not yet executable");
                }
            }
        }

        enacted
    }

    /// Serialize governance state to a snapshot for persistence
    pub fn to_snapshot(&self) -> Result<GovernanceSnapshot, String> {
        Ok(GovernanceSnapshot {
            proposals: self.proposals.values().cloned().collect(),
            enacted_parameters: self.enacted_parameters.clone(),
            timelocks: self.timelocks.values().cloned().collect(),
            treasury: self.treasury.clone(),
            params: self.params.clone(),
        })
    }

    /// Load governance state from a persisted snapshot
    pub fn load_snapshot(&mut self, snapshot: GovernanceSnapshot) {
        self.proposals = snapshot.proposals
            .into_iter()
            .map(|p| (p.id.clone(), p))
            .collect();
        self.enacted_parameters = snapshot.enacted_parameters;
        self.timelocks = snapshot.timelocks
            .into_iter()
            .map(|t| (t.proposal_id.clone(), t))
            .collect();
        self.treasury = snapshot.treasury;
        self.params = snapshot.params;
    }

    /// Deposit funds into the treasury (from block rewards tax)
    pub fn treasury_deposit(&mut self, amount: u64) {
        self.treasury.balance_hsmc += amount;
        self.treasury.total_collected += amount;
    }

    pub fn active_proposals(&self) -> Vec<&GovernanceProposal> {
        self.proposals.values()
            .filter(|p| p.status == ProposalStatus::Active)
            .collect()
    }
}

impl Default for GovernanceEngine {
    fn default() -> Self { Self::new() }
}

// ─── RPC-friendly GovernanceState wrapper ──────────────────────────────────
// Thin wrapper exposing GovernanceEngine as a Vec-based API for RPC handlers

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcProposal {
    pub id: String,
    pub title: String,
    pub description: String,
    pub proposer_address: String,
    pub proposal_type: String,   // serialized variant name
    pub status: String,           // serialized variant name
    pub votes_for: u64,
    pub votes_against: u64,
    pub quorum_required: u64,
    pub created_at: i64,
    pub ends_at: i64,
    pub parameter_key: Option<String>,
    pub parameter_value: Option<String>,
    pub total_voting_power: u64,
}

pub struct GovernanceState {
    pub engine: GovernanceEngine,
    pub proposals: Vec<RpcProposal>,
}

impl GovernanceState {
    pub fn new() -> Self {
        Self {
            engine: GovernanceEngine::new(),
            proposals: Vec::new(),
        }
    }

    /// Sync RpcProposal list from the engine (call after state changes)
    pub fn sync_from_engine(&mut self) {
        self.proposals = self.engine.proposals.iter().map(|(id, p)| {
            let (votes_for, votes_against) = self.compute_rpc_votes(p);
            let (param_key, param_val) = match &p.proposal_type {
                ProposalType::ParameterChange { key, new_value, .. } =>
                    (Some(key.clone()), Some(new_value.clone())),
                _ => (None, None),
            };
            RpcProposal {
                id: id.clone(),
                title: p.metadata.get("title").cloned().unwrap_or_else(|| format!("Proposal {}", &id[..8.min(id.len())])),
                description: p.metadata.get("description").cloned().unwrap_or_default(),
                proposer_address: p.proposer.clone(),
                proposal_type: proposal_type_to_rpc_str(&p.proposal_type),
                status: proposal_status_to_rpc_str(&p.status),
                votes_for,
                votes_against,
                quorum_required: p.min_deposit,
                created_at: p.submit_time.timestamp(),
                ends_at: p.voting_end_time.map(|t| t.timestamp()).unwrap_or(0),
                parameter_key: param_key,
                parameter_value: param_val,
                total_voting_power: p.tally.total_voting_power,
            }
        }).collect();
    }

    fn compute_rpc_votes(&self, p: &GovernanceProposal) -> (u64, u64) {
        let yes = p.tally.yes;
        let no = p.tally.no;
        (yes, no)
    }
}

fn proposal_type_to_rpc_str(pt: &ProposalType) -> String {
    match pt {
        ProposalType::ParameterChange { .. } => "parameter_change".into(),
        ProposalType::TreasurySpend { .. } => "treasury_spend".into(),
        ProposalType::TextProposal { .. } => "text_proposal".into(),
        ProposalType::EmergencyUpgrade { .. } => "emergency_upgrade".into(),
        ProposalType::SlashingProposal { .. } => "slashing_proposal".into(),
    }
}

fn proposal_status_to_rpc_str(ps: &ProposalStatus) -> String {
    match ps {
        ProposalStatus::Draft => "draft".into(),
        ProposalStatus::Active => "active".into(),
        ProposalStatus::Passed => "passed".into(),
        ProposalStatus::Rejected => "rejected".into(),
        ProposalStatus::Enacted => "enacted".into(),
        ProposalStatus::Expired => "expired".into(),
        ProposalStatus::Vetoed => "vetoed".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass_proposal(gov: &mut GovernanceEngine, proposal_id: &str, proposal_type: ProposalType) {
        let deposit = gov.params.min_deposit_hsmc;
        gov.submit_proposal(proposal_id.into(), "0xproposer".into(), proposal_type, deposit).unwrap();
        gov.vote(proposal_id, "v1".into(), VoteOption::Yes, 600_000_000, "s1".into()).unwrap();
        gov.vote(proposal_id, "v2".into(), VoteOption::No, 200_000_000, "s2".into()).unwrap();
        gov.tally_and_finalize(proposal_id, 1_000_000_000).unwrap();
    }

    #[test]
    fn test_proposal_submission_and_vote() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-001".to_string();

        let result = gov.submit_proposal(
            id.clone(),
            "0xproposer".into(),
            ProposalType::ParameterChange {
                key: "min_fee_rate".into(),
                old_value: "1000".into(),
                new_value: "2000".into(),
            },
            gov.params.min_deposit_hsmc,
        );
        assert!(result.is_ok());

        // Vote yes with 60% of staking power
        let total_staked = 1_000_000_000u64;
        gov.vote(&id, "voter1".into(), VoteOption::Yes, 600_000_000, "sig1".into())?;
        gov.vote(&id, "voter2".into(), VoteOption::No, 200_000_000, "sig2".into())?;
        gov.vote(&id, "voter3".into(), VoteOption::Abstain, 200_000_000, "sig3".into())?;

        let status = gov.tally_and_finalize(&id, total_staked)?;
        assert_eq!(status, ProposalStatus::Passed);

        // Timelock created; parameter NOT yet enacted
        assert!(gov.timelocks.contains_key(&id));
        assert!(!gov.timelocks[&id].is_executable()); // 48h timelock not yet expired
        assert_eq!(gov.get_param_u64("min_fee_rate"), Some(1000)); // still old value
        Ok(())
    }

    #[test]
    fn test_veto_threshold() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-002".to_string();
        gov.submit_proposal(id.clone(), "0xp".into(),
            ProposalType::TextProposal { title: "test".into(), description: "d".into() },
            gov.params.min_deposit_hsmc,
        )?;

        let total = 1_000_000_000u64;
        gov.vote(&id, "v1".into(), VoteOption::NoWithVeto, 400_000_000, "s1".into())?;
        gov.vote(&id, "v2".into(), VoteOption::Yes, 600_000_000, "s2".into())?;

        let status = gov.tally_and_finalize(&id, total)?;
        assert_eq!(status, ProposalStatus::Vetoed);
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════
    // EXECUTE TESTS
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_execute_parameter_change() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-exec-param";

        pass_proposal(&mut gov, id,
            ProposalType::ParameterChange {
                key: "max_block_size".into(),
                old_value: "4000000".into(),
                new_value: "8000000".into(),
            },
        );

        // Before timelock expiry: execute should fail
        let result = gov.execute(id, 100);
        assert!(result.is_err());
        match result {
            Err(GovernanceError::TimelockNotExpired(_)) => { /* expected */ }
            other => panic!("Expected TimelockNotExpired, got {:?}", other),
        }

        // Manually expire the timelock (set executable_at to past)
        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);
        assert!(gov.timelocks[id].is_executable());

        // Now execute should work
        let result = gov.execute(id, 100)?;
        assert!(matches!(result, ProposalType::ParameterChange { .. }));

        // Verify parameter was updated
        assert_eq!(gov.get_param_u64("max_block_size"), Some(8000000));

        // Proposal status should be Enacted
        assert_eq!(gov.proposals[id].status, ProposalStatus::Enacted);

        // Timelock should be removed after execution
        assert!(!gov.timelocks.contains_key(id));

        Ok(())
    }

    #[test]
    fn test_execute_treasury_spend() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-exec-treasury";

        // Fund treasury first
        gov.treasury_deposit(500_000_000_000); // 5000 HSMC in satoshis

        pass_proposal(&mut gov, id,
            ProposalType::TreasurySpend {
                recipient: "HSMC_dev_fund_00000000000000000000000000000000".into(),
                amount_hsmc: 100_000_000_000, // 1000 HSMC
                purpose: "Development grant Q3 2026".into(),
            },
        );

        // Expire timelock
        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        // Execute
        let result = gov.execute(id, 100)?;
        assert!(matches!(result, ProposalType::TreasurySpend { .. }));

        // Verify treasury balance decreased
        assert_eq!(gov.treasury.balance_hsmc, 400_000_000_000); // 5000 - 1000 = 4000
        assert_eq!(gov.treasury.total_spent, 100_000_000_000);

        // Verify spend recorded in history
        assert_eq!(gov.treasury.spend_history.len(), 1);
        assert_eq!(gov.treasury.spend_history[0].recipient,
            "HSMC_dev_fund_00000000000000000000000000000000");

        // Status enacted
        assert_eq!(gov.proposals[id].status, ProposalStatus::Enacted);

        Ok(())
    }

    #[test]
    fn test_execute_treasury_insufficient_funds() {
        let mut gov = GovernanceEngine::new();
        let id = "prop-exec-nofunds";

        pass_proposal(&mut gov, id,
            ProposalType::TreasurySpend {
                recipient: "HSMC_addr".into(),
                amount_hsmc: 100_000_000_000,
                purpose: "Test".into(),
            },
        );

        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        let result = gov.execute(id, 100);
        assert!(result.is_err());
        match result {
            Err(GovernanceError::InvalidParameter { .. }) => { /* expected */ }
            other => panic!("Expected InvalidParameter, got {:?}", other),
        }
    }

    #[test]
    fn test_execute_emergency_upgrade() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-exec-upgrade";

        pass_proposal(&mut gov, id,
            ProposalType::EmergencyUpgrade {
                version: "0.4.0".into(),
                upgrade_height: 500_000,
                checksum: "abc123".into(),
            },
        );

        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        let result = gov.execute(id, 100)?;
        assert!(matches!(result, ProposalType::EmergencyUpgrade { .. }));

        assert_eq!(
            gov.enacted_parameters.get("emergency_upgrade_height"),
            Some(&"500000".to_string())
        );
        assert_eq!(
            gov.enacted_parameters.get("emergency_upgrade_version"),
            Some(&"0.4.0".to_string())
        );
        assert_eq!(gov.proposals[id].status, ProposalStatus::Enacted);

        Ok(())
    }

    #[test]
    fn test_execute_text_proposal() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-exec-text";

        pass_proposal(&mut gov, id,
            ProposalType::TextProposal {
                title: "Community Signal".into(),
                description: "Should we increase block size?".into(),
            },
        );

        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        let result = gov.execute(id, 100)?;
        assert!(matches!(result, ProposalType::TextProposal { .. }));
        assert_eq!(gov.proposals[id].status, ProposalStatus::Enacted);

        Ok(())
    }

    #[test]
    fn test_execute_slashing_proposal() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-exec-slash";

        pass_proposal(&mut gov, id,
            ProposalType::SlashingProposal {
                validator_address: "0xbad_validator".into(),
                slash_percent: 25,
                evidence_hash: "0xevidence".into(),
            },
        );

        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        let result = gov.execute(id, 100)?;
        assert!(matches!(result, ProposalType::SlashingProposal { .. }));

        let slash_key = format!("slash_{}", id);
        assert!(gov.enacted_parameters.contains_key(&slash_key));
        assert_eq!(gov.proposals[id].status, ProposalStatus::Enacted);

        Ok(())
    }

    #[test]
    fn test_cannot_double_execute() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-double";

        pass_proposal(&mut gov, id,
            ProposalType::ParameterChange {
                key: "min_fee_rate".into(),
                old_value: "1000".into(),
                new_value: "1500".into(),
            },
        );

        gov.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        // First execution succeeds
        gov.execute(id, 100).unwrap();
        assert_eq!(gov.proposals[id].status, ProposalStatus::Enacted);

        // Second execution fails with AlreadyEnacted
        let result = gov.execute(id, 100);
        assert!(result.is_err());
        match result {
            Err(GovernanceError::AlreadyEnacted(_)) => { /* expected */ }
            other => panic!("Expected AlreadyEnacted, got {:?}", other),
        }

        Ok(())
    }

    #[test]
    fn test_cannot_execute_before_timelock() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-too-early";

        pass_proposal(&mut gov, id,
            ProposalType::ParameterChange {
                key: "min_fee_rate".into(),
                old_value: "1000".into(),
                new_value: "1500".into(),
            },
        );

        // Timelock is set 48h in the future — execute must fail
        let result = gov.execute(id, 100);
        assert!(result.is_err());
        match result {
            Err(GovernanceError::TimelockNotExpired(_)) => { /* expected */ }
            other => panic!("Expected TimelockNotExpired, got {:?}", other),
        }

        Ok(())
    }

    #[test]
    fn test_cannot_execute_non_passed_proposal() {
        let mut gov = GovernanceEngine::new();
        let id = "prop-rejected";

        gov.submit_proposal(
            id.into(),
            "0xp".into(),
            ProposalType::TextProposal { title: "t".into(), description: "d".into() },
            gov.params.min_deposit_hsmc,
        ).unwrap();

        // Don't vote — it stays Draft/Active, not Passed
        let result = gov.execute(id, 100);
        assert!(result.is_err());
        match result {
            Err(GovernanceError::NotPassed(_)) => { /* expected */ }
            other => panic!("Expected NotPassed, got {:?}", other),
        }
    }

    #[test]
    fn test_execute_not_found() {
        let mut gov = GovernanceEngine::new();
        let result = gov.execute("nonexistent", 100);
        assert!(result.is_err());
        match result {
            Err(GovernanceError::ProposalNotFound(_)) => { /* expected */ }
            other => panic!("Expected ProposalNotFound, got {:?}", other),
        }
    }

    #[test]
    fn test_enact_passed_proposals_auto_execute() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id1 = "prop-auto-1";
        let id2 = "prop-auto-2";

        pass_proposal(&mut gov, id1,
            ProposalType::ParameterChange {
                key: "max_tx_per_block".into(),
                old_value: "5000".into(),
                new_value: "10000".into(),
            },
        );
        pass_proposal(&mut gov, id2,
            ProposalType::ParameterChange {
                key: "min_fee_rate".into(),
                old_value: "1000".into(),
                new_value: "500".into(),
            },
        );

        // Both have timelocks in the future — auto-execute should find none
        let enacted = gov.enact_passed_proposals();
        assert!(enacted.is_empty());

        // Expire both timelocks
        gov.timelocks.get_mut(id1).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);
        gov.timelocks.get_mut(id2).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);

        // Auto-execute should enact both
        let enacted = gov.enact_passed_proposals();
        assert_eq!(enacted.len(), 2);
        assert!(enacted.contains(&id1.to_string()));
        assert!(enacted.contains(&id2.to_string()));

        assert_eq!(gov.proposals[id1].status, ProposalStatus::Enacted);
        assert_eq!(gov.proposals[id2].status, ProposalStatus::Enacted);
        assert_eq!(gov.get_param_u64("max_tx_per_block"), Some(10000));
        assert_eq!(gov.get_param_u64("min_fee_rate"), Some(500));

        Ok(())
    }

    #[test]
    fn test_snapshot_roundtrip() -> anyhow::Result<()> {
        let mut gov = GovernanceEngine::new();
        let id = "prop-snap";

        pass_proposal(&mut gov, id,
            ProposalType::ParameterChange {
                key: "min_fee_rate".into(),
                old_value: "1000".into(),
                new_value: "9999".into(),
            },
        );
        gov.treasury_deposit(42_000);

        // Snapshot
        let snap = gov.to_snapshot().unwrap();
        assert_eq!(snap.proposals.len(), 1);
        assert_eq!(snap.treasury.balance_hsmc, 42_000);

        // Load into fresh engine
        let mut gov2 = GovernanceEngine::new();
        gov2.load_snapshot(snap);

        assert_eq!(gov2.proposals.len(), 1);
        assert_eq!(gov2.proposals[id].status, ProposalStatus::Passed);
        assert_eq!(gov2.treasury.balance_hsmc, 42_000);
        assert!(gov2.timelocks.contains_key(id));

        // Expire & execute on restored engine
        gov2.timelocks.get_mut(id).unwrap().executable_at =
            Utc::now() - chrono::Duration::seconds(1);
        gov2.execute(id, 100)?;
        assert_eq!(gov2.get_param_u64("min_fee_rate"), Some(9999));

        Ok(())
    }
}
