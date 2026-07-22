# HSMCPay Fee Schedule

> **Versiune:** 1.0 — 2026-07-21
> **Owner:** Ifrim George
> **Status:** Ratificat

---

## Principiu fundamental

HSMCPay percepe **fee-uri fixe**, nu procentuale. Spre deosebire de toate exchange-urile și procesoarele de plată care iau 0.1%–5% din fiecare tranzacție, HSMC ia o sumă fixă — predictibilă, transparentă, echitabilă.

Pentru un utilizator care mută $500,000, fee-ul HSMC e **$5.00** — nu $2,500 (0.5%) sau $5,000 (1%).

---

## Tabelul de fee-uri

| Interval tranzacție (USD) | Fee HSMC | % efectiv la pragul inferior | % efectiv la pragul superior |
|---------------------------|----------|------------------------------|------------------------------|
| $1 – $5,999 | **$1.00** | 100% → 0.017% | — |
| $6,000 – $9,999 | **$3.00** | 0.05% → 0.03% | — |
| $10,000 – $49,999 | **$5.00** | 0.05% → 0.01% | — |
| $50,000 – $999,999 | **$10.00** | 0.02% → 0.001% | — |
| $1,000,000+ | **$200.00** | 0.02% → 0.00002% | — |

---

## Unde merge fee-ul

100% din fee-uri intră în **HSMC Treasury** — un smart contract on-chain, transparent, guvernat de comunitate.

### Alocare Treasury

| Fond | % | Ce face |
|------|---|---------|
| **Buyback & Burn** | 40% | Cumpără HSMC de pe piață și arde token-urile |
| **Staking Rewards** | 25% | Recompense pentru holders |
| **Development** | 20% | Infrastructură, audit-uri, exchange listings |
| **Insurance** | 15% | Rezervă pentru bug bounty și evenimente extreme |

---

## Costuri externe (NU sunt HSMC)

| Procesator | Cost | Cine îl plătește |
|------------|------|-------------------|
| **Stripe** (buy) | ~2.9% + $0.30 | Plătit către Stripe din suma tranzacției |
| **Stripe** (sell/payout) | ~1.0% (variază) | Plătit către Stripe |
| **Gas fees** (blockchain nativ) | Dinamic (EIP-1559) | Plătit de utilizator |

---

## Exemple reale

### Cumpărare $100 HSMC
- Utilizatorul plătește: $100.00
- Stripe ia: ~$3.20
- Fee HSMC: $1.00 → Treasury
- Utilizatorul primește: ~$95.80 în HSMC

### Cumpărare $10,000 HSMC
- Utilizatorul plătește: $10,000.00
- Stripe ia: ~$290.30
- Fee HSMC: $5.00 → Treasury
- Utilizatorul primește: ~$9,704.70 în HSMC

### Cumpărare $500,000 HSMC
- Utilizatorul plătește: $500,000.00
- Stripe ia: ~$14,500.30
- Fee HSMC: $10.00 → Treasury
- Utilizatorul primește: ~$485,489.70 în HSMC

### Cumpărare $2,000,000 HSMC
- Utilizatorul plătește: $2,000,000.00
- Stripe ia: ~$58,000.30
- Fee HSMC: $200.00 → Treasury
- Utilizatorul primește: ~$1,941,799.70 în HSMC

---

## Avantaj competitiv

| Competitor | Model de fee | $500K tranzacție | $2M tranzacție |
|------------|-------------|------------------|----------------|
| **HSMCPay** | **Fix** | **$10.00** | **$200.00** |
| Coinbase | 0.6%–3% | $3,000–$15,000 | $12,000–$60,000 |
| Binance | 0.1% | $500 | $2,000 |
| Kraken | 0.16%–0.26% | $800–$1,300 | $3,200–$5,200 |
| Uniswap | 0.3% + gas | $1,500 + gas | $6,000 + gas |

---

## Implementare

HSMCPay fee-ul se deduce automat la settlement:
1. Utilizatorul plătește prin Stripe (suma totală)
2. Stripe confirmă plata
3. API server-ul calculează fee-ul HSMC conform tabelului
4. Fee-ul e direcționat către Treasury (adresă on-chain)
5. Restul sumei e creditat în wallet-ul utilizatorului ca HSMC

### Endpoint API (de implementat)

```
POST /stripe/checkout
{
  "action": "settle",
  "session_id": "cs_xxx",
  "payment_intent_id": "pi_xxx"
}

Response:
{
  "tx_hash": "0x...",
  "amount_hsmc": "94700.50",
  "fee_hsmc": "5.00",
  "fee_tier": "10k-50k",
  "treasury_tx": "0x..."
}
```
