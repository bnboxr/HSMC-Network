# HSMC Project Gap Audit — CORECTAT

**Notă:** Cercetătorul a scanat repo-ul GitHub care până acum 5 minute era gol/vechi. Fișierele din `/home/team/shared/` (api-server.ts, copilot-server.ts, mining-server.ts) NU erau în repo. Acum, după push, SUNT.

Corectez mai jos:

## ❌ FALSE POSITIVES (cercetătorul n-a găsit fișierele din /home/team/shared/)

| ID | Ce zice | REALITATE |
|----|---------|-----------|
| C1 | Supabase directory missing | ✅ INTENȚIONAT — am eliminat Supabase complet, e înlocuit cu api-server.ts |
| C2 | API server port 3001 missing | ❌ FALS — api-server.ts există în /home/team/shared/, 1308 linii, rulează pe port 3001 |
| C5 | AI Co-Pilot server missing | ❌ FALS — copilot-server.ts există, 537 linii, 7 agenți, rulează pe port 3002 |
| I3 | Sell payout backend missing | ❌ FALS — POST /stripe/payout există în api-server.ts |
| I5 | Treasury endpoint missing | ❌ FALS — GET /treasury/balance + /treasury/transactions există |
| I6 | HIBP not enabled | ✅ INTENȚIONAT — local auth, nu mai folosim Supabase auth |
| W1 | Privacy not wired in wallet | ❌ FALS — PrivacySection.tsx + privacy-utils.ts sunt importate în AppPage.tsx |
| W6 | Price data server missing | ❌ FALS — /rest/v1/token_metrics e în api-server.ts |

## ✅ GAP-URI REALE (trebuie rezolvate)

### 🔴 CRITICAL
- **Post-Quantum Crypto** — Kyber-1024, Dilithium-5, SPHINCS+ nu există în Rust
- **Smart Contract VM/WASM** — nu există
- **30 Rust unwrap()** — vor cauza panic crash în producție

### 🟠 INCOMPLETE
- **Bridge: doar 3 chain-uri** (BTC, ETH, BSC) din 50+ promise
- **Stratum V1, nu V2**
- **WebAuthn/biometric** — nu există, doar TOTP
- **Decoy PRNG non-criptografic** — slăbește privacy

### 🟢 DEAD CODE
- NavLink.tsx, FeaturesSection.tsx, WelcomeChecklist.tsx, wallet-scanner.ts

### 🔵 MINOR
- Vite proxy lipsă (CORS va fi problemă în producție)
- Nu sunt teste de integrare
