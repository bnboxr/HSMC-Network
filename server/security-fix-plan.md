# Security Fix Plan — 2026-07-20

## 5 tabele FĂRĂ RLS deloc (CRITICAL)
| Tabel | Expunere |
|---|---|
| referral_codes | Full CRUD pt authenticated |
| governance_votes | Full CRUD pt authenticated |
| transactions | Full CRUD pt authenticated |
| smart_contracts | Full CRUD pt authenticated |
| payment_sessions | Full CRUD pt authenticated |

## 2 tabele cu RLS incomplet
- blocks — doar INSERT policy, fără SELECT
- price_history — doar INSERT service_role, fără SELECT

## Ce era DEJA rezolvat (false positives din audit)
- BIP39WalletSetup, Onboarding, SeedPhraseRecovery: folosesc crypto.getRandomValues() ✅
- NetworkVisualization: zero Math.random() ✅
- OTP code: e mort (string gol), Stripe l-a înlocuit ✅

## Recomandare
- Creează o singură migrație care adaugă RLS pe toate cele 7 tabele
- Elimină codul OTP vestigial din hsmcpay-checkout
- Math.random() din MiningRPCClient și sidebar — risc scăzut, separat
