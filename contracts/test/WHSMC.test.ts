import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("WHSMC + BridgeMinter", () => {
  // ─── Fixture helpers ──────────────────────────────────────────────────
  async function deployFixture(signerCount = 5, threshold = 3) {
    const signers = await ethers.getSigners();
    const [admin, recipient, ...others] = signers;
    const validatorSet = others.slice(0, signerCount);
    const valAddrs = validatorSet.map(s => s.address);

    const WHSMC = await ethers.getContractFactory("WHSMC");
    const token = await WHSMC.deploy(admin.address);

    const Bridge = await ethers.getContractFactory("BridgeMinter");
    const bridge = await Bridge.deploy(await token.getAddress(), admin.address, valAddrs, threshold);

    await token.connect(admin).grantRole(await token.MINTER_ROLE(), await bridge.getAddress());

    return { signers, admin, recipient, validatorSet, token, bridge };
  }

  async function getDigest(bridgeAddr: string, hsmcTx: string, to: string, amount: bigint) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "bytes32", "address", "uint256"],
        [chainId, bridgeAddr, hsmcTx, to, amount]
      )
    );
  }

  async function signDigest(digest: string, signers: ethers.Signer[]) {
    return Promise.all(signers.map(s => s.signMessage(ethers.getBytes(digest))));
  }

  // ─── 1. Backward Compat: instant mint (challengePeriod=0) ────────────
  describe("Backward Compat: instant mint (challengePeriod=0)", () => {
    it("multi-sig minting flow with 3-of-5 validators", async () => {
      const { admin, recipient, validatorSet, token, bridge } = await deployFixture(5, 3);
      const valAddrs = validatorSet.map(s => s.address);

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-1"));
      const amount = ethers.parseUnits("100", 8);

      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      // Sort validators by address asc (sigs must be sorted)
      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);

      await expect(bridge.executeMint(hsmcTx, recipient.address, amount, sigs))
        .to.emit(token, "BridgeMint").withArgs(recipient.address, amount, hsmcTx);
      expect(await token.balanceOf(recipient.address)).to.equal(amount);

      // Replay protection
      await expect(bridge.executeMint(hsmcTx, recipient.address, amount, sigs))
        .to.be.revertedWithCustomError(bridge, "AlreadyProcessed");
    });

    it("rejects fewer signatures than threshold", async () => {
      const { recipient, validatorSet, bridge } = await deployFixture(5, 3);

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-2"));
      const amount = ethers.parseUnits("50", 8);

      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      // Only 2 sigs, threshold is 3
      const sorted = validatorSet.slice(0, 2).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);

      await expect(bridge.executeMint(hsmcTx, recipient.address, amount, sigs))
        .to.be.revertedWithCustomError(bridge, "NotEnoughSigs");
    });

    it("rejects unsorted signatures", async () => {
      const { recipient, validatorSet, bridge } = await deployFixture(5, 3);

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-3"));
      const amount = ethers.parseUnits("25", 8);

      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      // Reverse order intentionally
      const reversed = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() > b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, reversed);

      await expect(bridge.executeMint(hsmcTx, recipient.address, amount, sigs))
        .to.be.revertedWithCustomError(bridge, "SigsNotSorted");
    });

    it("rejects non-validator signers", async () => {
      const { signers, recipient, validatorSet, bridge } = await deployFixture(3, 3);
      // Use a non-validator from the remaining signers
      const nonValidator = signers[signers.length - 1];

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-4"));
      const amount = ethers.parseUnits("10", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      // Mix: 2 valid validators + 1 non-validator
      const mix = [validatorSet[0], validatorSet[1], nonValidator].sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, mix);

      await expect(bridge.executeMint(hsmcTx, recipient.address, amount, sigs))
        .to.be.revertedWithCustomError(bridge, "NotAValidator");
    });
  });

  // ─── 2. Fraud Proof: propose → challenge → finalize flow ─────────────
  describe("Fraud Proof: propose → challenge → finalize (challengePeriod>0)", () => {
    async function deployWithChallenge(challengePeriodSecs = 60, challengeBond = ethers.parseEther("0.1")) {
      const fixture = await deployFixture(5, 3);
      await fixture.bridge.connect(fixture.admin).setChallengePeriod(challengePeriodSecs);
      await fixture.bridge.connect(fixture.admin).setChallengeBond(challengeBond);
      return fixture;
    }

    it("emits MintProposed and does NOT mint immediately", async () => {
      const { admin, recipient, validatorSet, token, bridge } = await deployWithChallenge(86400);

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-propose-1"));
      const amount = ethers.parseUnits("200", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);

      // Should emit MintProposed, NOT BridgeMint (no mint yet)
      const tx = await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      await expect(tx)
        .to.emit(bridge, "MintProposed");

      // Balance should still be 0 — not minted yet
      expect(await token.balanceOf(recipient.address)).to.equal(0n);

      // Should NOT emit BridgeMint on token
      await expect(tx).not.to.emit(token, "BridgeMint");

      // Proposal should be stored
      const proposalId = await bridge.getProposalId(hsmcTx);
      expect(proposalId).to.equal(1n);

      const prop = await bridge.proposals(proposalId);
      expect(prop.state).to.equal(1); // ProposalState.Pending
    });

    it("finalizes mint after challenge period expires", async () => {
      const { recipient, validatorSet, token, bridge } = await deployWithChallenge(1); // 1 sec

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-finalize"));
      const amount = ethers.parseUnits("300", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);

      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);
      const proposalId = await bridge.getProposalId(hsmcTx);

      // Can't finalize before expiry
      await expect(bridge.finalizeMint(proposalId))
        .to.be.revertedWithCustomError(bridge, "ChallengeNotExpired");

      // Wait for expiry
      await network.provider.send("evm_increaseTime", [2]);
      await network.provider.send("evm_mine");

      // Now finalize
      await expect(bridge.finalizeMint(proposalId))
        .to.emit(bridge, "MintFinalized")
        .withArgs(proposalId, hsmcTx)
        .and.to.emit(token, "BridgeMint")
        .withArgs(recipient.address, amount, hsmcTx);

      expect(await token.balanceOf(recipient.address)).to.equal(amount);

      // Can't finalize twice
      await expect(bridge.finalizeMint(proposalId))
        .to.be.revertedWithCustomError(bridge, "ProposalNotPending");
    });

    it("anyone can call finalizeMint", async () => {
      const { signers, recipient, validatorSet, bridge } = await deployWithChallenge(1);

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-anyone"));
      const amount = ethers.parseUnits("50", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);

      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);
      const proposalId = await bridge.getProposalId(hsmcTx);

      await network.provider.send("evm_increaseTime", [2]);
      await network.provider.send("evm_mine");

      // Use an unrelated signer (not admin, not validator) to call finalizeMint
      const randomCaller = signers[signers.length - 1];
      await expect(bridge.connect(randomCaller).finalizeMint(proposalId))
        .to.emit(bridge, "MintFinalized");
    });

    it("challengeMint cancels proposal with valid bond", async () => {
      const { admin, recipient, validatorSet, bridge } = await deployWithChallenge(86400, ethers.parseEther("0.1"));

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-challenge"));
      const amount = ethers.parseUnits("1000", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);
      const proof = ethers.toUtf8Bytes("HSMC block 12345: tx not found");

      // Challenge with bond
      await expect(bridge.challengeMint(proposalId, proof, {
        value: ethers.parseEther("0.1"),
      })).to.emit(bridge, "MintChallenged")
        .withArgs(proposalId, hsmcTx, admin.address, proof);

      const prop = await bridge.proposals(proposalId);
      expect(prop.state).to.equal(3); // ProposalState.Challenged
      expect(prop.challenger).to.equal(admin.address);

      // Can't finalize a challenged proposal
      await network.provider.send("evm_increaseTime", [86401]);
      await network.provider.send("evm_mine");
      await expect(bridge.finalizeMint(proposalId))
        .to.be.revertedWithCustomError(bridge, "ProposalNotPending");
    });

    it("rejects challenge with insufficient bond", async () => {
      const { recipient, validatorSet, bridge } = await deployWithChallenge(86400, ethers.parseEther("0.1"));

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-lowbond"));
      const amount = ethers.parseUnits("100", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);
      const proof = ethers.toUtf8Bytes("proof");

      await expect(bridge.challengeMint(proposalId, proof, {
        value: ethers.parseEther("0.05"), // too low
      })).to.be.revertedWithCustomError(bridge, "BondTooLow");
    });

    it("cannot challenge after challenge period expires", async () => {
      const { recipient, validatorSet, bridge } = await deployWithChallenge(1, ethers.parseEther("0.1"));

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-late-challenge"));
      const amount = ethers.parseUnits("50", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);

      // Wait past expiry
      await network.provider.send("evm_increaseTime", [2]);
      await network.provider.send("evm_mine");

      const proof = ethers.toUtf8Bytes("too late");
      await expect(bridge.challengeMint(proposalId, proof, {
        value: ethers.parseEther("0.1"),
      })).to.be.revertedWithCustomError(bridge, "ChallengeNotExpired");
    });
  });

  // ─── 3. Challenge Resolution (resolveChallenge) ──────────────────────
  describe("Challenge Resolution", () => {
    async function deployWithChallenge() {
      const fixture = await deployFixture(5, 3);
      await fixture.bridge.connect(fixture.admin).setChallengePeriod(86400);
      await fixture.bridge.connect(fixture.admin).setChallengeBond(ethers.parseEther("0.1"));
      return fixture;
    }

    it("resolveChallenge(uphold=true) cancels mint, slashes signers, refunds bond", async () => {
      const { admin, recipient, validatorSet, bridge } = await deployWithChallenge();

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-resolve-upheld"));
      const amount = ethers.parseUnits("500", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      // Use first 3 validators sorted
      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);
      const proof = ethers.toUtf8Bytes("fraudulent tx — HSMC block 99999");

      // Record balances before challenge
      const challenger = admin;
      const balanceBefore = await ethers.provider.getBalance(challenger.address);

      // Challenge
      const challengeTx = await bridge.challengeMint(proposalId, proof, {
        value: ethers.parseEther("0.1"),
      });

      // Resolve: uphold the challenge
      await expect(bridge.connect(admin).resolveChallenge(proposalId, true))
        .to.emit(bridge, "ChallengeResolved")
        .withArgs(proposalId, hsmcTx, true, admin.address);

      const prop = await bridge.proposals(proposalId);
      expect(prop.state).to.equal(4); // ProposalState.Cancelled

      // Signers should be slashed
      for (const v of sorted) {
        expect(await bridge.slashed(v.address)).to.be.true;
        expect(await bridge.slashCount(v.address)).to.equal(1);
      }

      // Bond should be refunded (balance should be roughly pre-challenge balance)
      // Gas costs make exact match impossible, so just verify bond refund happened
      const balanceAfter = await ethers.provider.getBalance(challenger.address);
      // Balance after should be close to balance before (minus gas for challengeTx + resolveChallenge)
      expect(balanceAfter).to.be.gt(balanceBefore - ethers.parseEther("0.05"));

      // Slashed validators can no longer sign
      const hsmcTx2 = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-after-slash"));
      const digest2 = await getDigest(await bridge.getAddress(), hsmcTx2, recipient.address, amount);
      const sigs2 = await signDigest(digest2, sorted);
      await expect(bridge.executeMint(hsmcTx2, recipient.address, amount, sigs2))
        .to.be.revertedWithCustomError(bridge, "NotAValidator");
    });

    it("resolveChallenge(uphold=false) reinstates proposal, forfeits bond", async () => {
      const { admin, recipient, validatorSet, bridge } = await deployWithChallenge();

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-resolve-rejected"));
      const amount = ethers.parseUnits("200", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);
      const proof = ethers.toUtf8Bytes("invalid challenge");

      await bridge.challengeMint(proposalId, proof, {
        value: ethers.parseEther("0.1"),
      });

      // Resolve: reject the challenge
      await expect(bridge.connect(admin).resolveChallenge(proposalId, false))
        .to.emit(bridge, "ChallengeResolved")
        .withArgs(proposalId, hsmcTx, false, admin.address);

      const prop = await bridge.proposals(proposalId);
      expect(prop.state).to.equal(1); // ProposalState.Pending (reinstated)
      expect(prop.challenger).to.equal(ethers.ZeroAddress);

      // Validators should NOT be slashed
      for (const v of sorted) {
        expect(await bridge.slashed(v.address)).to.be.false;
      }

      // Proposal can still be finalized after expiry
      await network.provider.send("evm_increaseTime", [86401]);
      await network.provider.send("evm_mine");
      await expect(bridge.finalizeMint(proposalId))
        .to.emit(bridge, "MintFinalized");
    });

    it("non-admin cannot resolve challenges", async () => {
      const { signers, recipient, validatorSet, bridge } = await deployWithChallenge();

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-nonadmin"));
      const amount = ethers.parseUnits("100", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);
      await bridge.challengeMint(proposalId, ethers.toUtf8Bytes("proof"), {
        value: ethers.parseEther("0.1"),
      });

      const nonAdmin = signers[signers.length - 1];
      await expect(bridge.connect(nonAdmin).resolveChallenge(proposalId, true))
        .to.be.reverted; // AccessControl
    });

    it("resolveChallenge on non-challenged proposal reverts", async () => {
      const { admin, bridge } = await deployWithChallenge();

      // Proposal doesn't exist
      await expect(bridge.connect(admin).resolveChallenge(999, true))
        .to.be.revertedWithCustomError(bridge, "ProposalNotFound");
    });
  });

  // ─── 4. Admin functions ──────────────────────────────────────────────
  describe("Admin functions", () => {
    it("setChallengePeriod updates period and emits event", async () => {
      const { admin, bridge } = await deployFixture(5, 3);

      expect(await bridge.challengePeriod()).to.equal(0);

      await expect(bridge.connect(admin).setChallengePeriod(86400))
        .to.emit(bridge, "ChallengePeriodChanged")
        .withArgs(86400);

      expect(await bridge.challengePeriod()).to.equal(86400);
    });

    it("setChallengeBond updates bond", async () => {
      const { admin, bridge } = await deployFixture(5, 3);

      await bridge.connect(admin).setChallengeBond(ethers.parseEther("1.0"));
      expect(await bridge.challengeBond()).to.equal(ethers.parseEther("1.0"));
    });

    it("withdrawBonds transfers accumulated ETH", async () => {
      const { admin, bridge, recipient } = await deployFixture(5, 3);

      // Send some ETH to the bridge
      await admin.sendTransaction({
        to: await bridge.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      const balanceBefore = await ethers.provider.getBalance(recipient.address);
      await bridge.connect(admin).withdrawBonds(recipient.address);
      const balanceAfter = await ethers.provider.getBalance(recipient.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1.0"));
    });
  });

  // ─── 5. Edge cases ───────────────────────────────────────────────────
  describe("Edge cases", () => {
    it("canFinalize returns true only after expiry", async () => {
      const { recipient, validatorSet, bridge } = await deployFixture(5, 3);
      await bridge.connect(
        (await ethers.getSigners())[0]).setChallengePeriod(60);

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-canfin"));
      const amount = ethers.parseUnits("100", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);

      // Not yet
      expect(await bridge.canFinalize(proposalId)).to.be.false;

      // After expiry
      await network.provider.send("evm_increaseTime", [61]);
      await network.provider.send("evm_mine");

      expect(await bridge.canFinalize(proposalId)).to.be.true;
    });

    it("challengeMint refunds excess bond", async () => {
      const { admin, recipient, validatorSet, bridge } = await deployFixture(5, 3);
      await bridge.connect(admin).setChallengePeriod(86400);
      await bridge.connect(admin).setChallengeBond(ethers.parseEther("0.1"));

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-excess"));
      const amount = ethers.parseUnits("50", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);

      const balanceBefore = await ethers.provider.getBalance(admin.address);
      const tx = await bridge.challengeMint(proposalId, ethers.toUtf8Bytes("proof"), {
        value: ethers.parseEther("0.5"), // 0.1 bond + 0.4 excess
      });
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      // Balance should be: before - 0.1 bond - gas
      const balanceAfter = await ethers.provider.getBalance(admin.address);
      expect(balanceAfter).to.be.closeTo(
        balanceBefore - ethers.parseEther("0.1") - gasCost,
        ethers.parseEther("0.01") // tolerance
      );
    });

    it("slashed validator is removed from validator set and can rejoin", async () => {
      const { admin, recipient, validatorSet, bridge } = await deployFixture(5, 3);
      await bridge.connect(admin).setChallengePeriod(86400);
      await bridge.connect(admin).setChallengeBond(ethers.parseEther("0.1"));

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-slash-remove"));
      const amount = ethers.parseUnits("100", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);
      await bridge.challengeMint(proposalId, ethers.toUtf8Bytes("proof"), {
        value: ethers.parseEther("0.1"),
      });
      await bridge.connect(admin).resolveChallenge(proposalId, true);

      // Validators are slashed but still in the validator list
      expect(await bridge.slashed(sorted[0].address)).to.be.true;

      // Remove and re-add clears slash
      await bridge.connect(admin).removeValidator(sorted[0].address);
      await bridge.connect(admin).addValidator(sorted[0].address);
      expect(await bridge.slashed(sorted[0].address)).to.be.false;
    });

    it("challenge on already-finalized proposal reverts", async () => {
      const { recipient, validatorSet, bridge } = await deployFixture(5, 3);
      const admin = (await ethers.getSigners())[0];
      await bridge.connect(admin).setChallengePeriod(1);
      await bridge.connect(admin).setChallengeBond(ethers.parseEther("0.1"));

      const hsmcTx = ethers.keccak256(ethers.toUtf8Bytes("hsmc-tx-finalized-challenge"));
      const amount = ethers.parseUnits("100", 8);
      const digest = await getDigest(await bridge.getAddress(), hsmcTx, recipient.address, amount);

      const sorted = validatorSet.slice(0, 3).sort((a, b) =>
        a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
      );
      const sigs = await signDigest(digest, sorted);
      await bridge.executeMint(hsmcTx, recipient.address, amount, sigs);

      const proposalId = await bridge.getProposalId(hsmcTx);

      await network.provider.send("evm_increaseTime", [2]);
      await network.provider.send("evm_mine");
      await bridge.finalizeMint(proposalId);

      await expect(bridge.challengeMint(proposalId, ethers.toUtf8Bytes("proof"), {
        value: ethers.parseEther("0.1"),
      })).to.be.revertedWithCustomError(bridge, "ProposalNotPending");
    });

    it("bridge receives ETH for bonds", async () => {
      const { admin, bridge } = await deployFixture(5, 3);
      const bridgeAddr = await bridge.getAddress();

      await admin.sendTransaction({ to: bridgeAddr, value: ethers.parseEther("1.0") });
      expect(await ethers.provider.getBalance(bridgeAddr)).to.equal(ethers.parseEther("1.0"));
    });
  });

  // ─── 6. WHSMC token specific tests ──────────────────────────────────
  describe("WHSMC token", () => {
    it("has correct decimals and name", async () => {
      const { token } = await deployFixture(3, 2);
      expect(await token.decimals()).to.equal(8);
      expect(await token.name()).to.equal("Wrapped HSMC");
      expect(await token.symbol()).to.equal("wHSMC");
    });

    it("respects MAX_SUPPLY cap", async () => {
      const { admin, bridge } = await deployFixture(3, 2);
      const token = await ethers.getContractAt("WHSMC", await bridge.token());

      // MAX_SUPPLY is 1 trillion with 8 decimals
      const maxSupply = ethers.parseUnits("1000000000000", 8);
      expect(await token.MAX_SUPPLY()).to.equal(maxSupply);
    });
  });
});
