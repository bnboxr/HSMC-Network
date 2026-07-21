# MEXC / Gate.io Listing Application Pack

Submit via:
- MEXC:  https://www.mexc.com/support/articles/17827791509259  (Listing form)
- Gate.io: https://www.gate.io/help/wallet/27269   (Startup listing application)

Both require the documents below. Auto-generated stubs are in this folder.

## Required documents

| File                              | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `legal/Project_Brief.pdf`         | 2-page summary (problem, solution, team, tokenomics)         |
| `legal/Tokenomics_Table.pdf`      | Allocation %, vesting, supply schedule                       |
| `legal/Audit_Report_*.pdf`        | Trail of Bits + Certik (REQUIRED — exchanges will reject without) |
| `legal/Legal_Opinion.pdf`         | "Not a security" opinion from a qualified law firm           |
| `legal/Team_KYC_Pack.zip`         | Government IDs + selfies for all 3 founders (encrypted)      |
| `contracts/deployments/bsc.json`  | wHSMC contract address + verified explorer link              |
| `listings/coinmarketcap.json`     | Same data, CMC must list before MEXC accepts                 |

## Submission checklist

- [ ] wHSMC verified on BSCScan (run `npm run verify:bsc`)
- [ ] PancakeSwap pool live with > $50k initial liquidity locked for 1 year
- [ ] Liquidity locker proof (e.g. PinkSale, UniCrypt screenshot)
- [ ] Audit reports public on GitHub
- [ ] Legal opinion (cost: $5–15k from a crypto-specialised firm)
- [ ] Marketing budget escrow (MEXC requires 200k–500k USDT, Gate 100k–300k USDT)
- [ ] Telegram + Twitter > 5k organic followers (no bots — exchanges check)

## Fees (2026 typical)

| Exchange   | Listing fee   | Marketing fee | Lock-up        |
| ---------- | ------------- | ------------- | -------------- |
| MEXC Innovation | 0 USDT  | 200k USDT    | 6 months       |
| MEXC Main  | 50–100k USDT  | 300–500k USDT | 12 months      |
| Gate Startup | 0 USDT      | 100k USDT    | 6 months       |
| Gate Main  | 50k USDT      | 200k USDT    | 12 months      |

These are real costs that no code change can bypass.
