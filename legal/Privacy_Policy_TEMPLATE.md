# Privacy Policy — TEMPLATE (NOT LEGAL ADVICE)

Compliant with **GDPR (EU 2016/679)** and **AMLD5 (EU 2018/843)** as drafted.
Review with EU privacy counsel before publishing.

## 1. Data Controller
[FOUNDATION], [REGISTERED ADDRESS]. DPO: [DPO EMAIL].

## 2. What we collect

| Data                    | Purpose                                       | Legal basis (GDPR Art. 6) | Retention |
| ----------------------- | --------------------------------------------- | ------------------------- | --------- |
| Email (optional)        | Account recovery, notifications               | Consent (1a)              | Until deletion |
| IP address              | Rate-limiting, fraud prevention               | Legitimate interest (1f)  | 30 days   |
| Wallet address (public) | Service operation                             | Contract (1b)             | Permanent (on-chain) |
| KYC docs (if applicable for fiat onramp) | AML compliance              | Legal obligation (1c)     | 5 years (AMLD5) |
| Browser session cookies | Auth                                          | Consent / Contract        | Session   |

We **do NOT** collect: transaction memos, contact lists, biometrics
(except WebAuthn key, stored locally), private keys (never sent to server).

## 3. Sharing
We do not sell data. We share with:
- Cloud infrastructure (Lovable Cloud / Supabase) under DPA
- KYC provider (Sumsub/Onfido) under DPA
- Authorities upon valid court order

## 4. Your rights (GDPR Art. 15–22)
Access, rectification, erasure, portability, restriction, objection,
and the right to lodge a complaint with your supervisory authority.
Email [DPO EMAIL].

## 5. International transfers
Data may be processed in [REGION]. Transfers outside the EEA use
Standard Contractual Clauses (2021/914).

## 6. Security
TLS 1.3, AES-256-GCM at rest, RLS-enforced row isolation, 2FA TOTP
optional. Seed phrases are AES-encrypted client-side before storage.

## 7. Children
The Service is not directed at persons under 18.

## 8. Changes
Material changes notified by email and in-app banner.

Last updated: see git history.
