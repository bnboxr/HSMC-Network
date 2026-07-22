# Seed-Phrase-Only Auth Flow — UX Copy

## Screen 1: Welcome
**Title:** Welcome to HSMC
**Subtitle:** Your seed phrase is your account. No email. No password. Just you and your keys.
- **Button 1:** Create New Wallet
- **Button 2:** Import Existing Wallet
**Footer:** HSMC does not store your seed phrase — you are solely responsible for its safekeeping.

## Screen 2A: Create Wallet
**Title:** Your Recovery Phrase
**Subtitle:** Write these 12 words down, in order, on paper. Do not screenshot them.
**Warning:** Anyone who has these words can control your funds. HSMC can never recover them.
**Checkbox:** I have written down all 12 words and stored them safely.
**Button:** Confirm & Continue (disabled until checkbox ticked)

## Screen 2B: Import Wallet
**Title:** Restore Your Wallet
**Subtitle:** Enter your 12-word recovery phrase to restore access.
**Placeholder:** word1 word2 word3 … (12 words separated by spaces)
**Button:** Check Balance (scans BSC, ETH, and HSMC networks)
**Error:** This seed phrase is not valid. Check your spelling and try again.

## Screen 3: Wallet Ready
**If funds found:** "Wallet Found" + balances across HSMC, BSC, ETH
**If no funds:** "Wallet Ready — No funds detected on any network."
**Note:** Balances queried from live RPCs. If you just sent funds, wait for confirmation.
**Button:** Enter HSMC
