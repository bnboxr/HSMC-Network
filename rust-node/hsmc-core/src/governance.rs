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
    #[error("Invalid vote weight: {0}")]
    InvalidWeight(u64),
    #[error("Proposal already in status: {:?}", .0)]
    InvalidStatus(ProposalStatus),
}

pub struct GovernanceEngine {
    pub proposals: HashMap<String, GovernanceProposal>,
    pub params: GovernanceParams,
    pub enacted_parameters: HashMap<String, String>,
    pub timelocks: HashMap<String, GovernanceTimelock>,
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

        Self {
            proposals: HashMap::new(),
            params: GovernanceParams::default(),
            enacted_parameters,
            timelocks: HashMap::new(),
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

    pub fn active_proposals(&self) -> Vec<&GovernanceProposal> {
        self.proposals.values()
            .filter(|p| p.status == ProposalStatus::Active)
            .collect()
    }
}

impl Default for GovernanceEngine {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
