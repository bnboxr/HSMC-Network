# Mock/Stub/Placeholder Hunt — 2026-07-21
## 26 probleme găsite, 15 critice

### TOP 5 — Cele mai grave
1. **privacy-utils.ts** — tot fișierul (793 linii) e stub-uri HMAC, nu crypto reală
2. **ringct.rs** — Bulletproofs sunt hash loops SHA-256, nu zk-proofs reale
3. **pow.rs** — SHA-256d (nu RandomX), ASIC-urile domină din ziua 1
4. **MiningRPCClient** — mining în browser = simulare, insert direct în DB
5. **Stratum V2** — e de fapt V1, fără Noise encryption

### Alte probleme critice
6. wHSMC addresses placeholder (0x0000...1001)
7. Crypto Rust → web wallet deconectat
8. Mining fallback local://chain pune blocuri direct în DB
9. Bulletproofs verify e trivial
10. update-token-metrics — no-op
11. price-engine — no-op
12. BridgeMinter challengePeriod = 0 (fraud proofs există dar dezactivate)
13. Governance fără auto-transition/timelock
14. HSMCPay sell — 501 not implemented
15. Threshold/multi-sig fără UI

### Medium (8)
16. POOL_PRESETS placeholder URLs
17. console.log în edge functions
18-26. Diverse
