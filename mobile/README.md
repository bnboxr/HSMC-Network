# HSMC Mobile Wallet

React Native mobile wallet for the HSMC Network — a privacy-preserving Layer 1 blockchain.

## Features

- **BIP39 Wallet Management**: Create 12/24-word wallets, import from seed phrase
- **Send & Receive**: Full transaction flow with QR code, fee calculation, privacy level selection
- **Staking**: Stake/unstake HSMC, view rewards, multiple validator pools
- **Privacy**: Shielded transactions via RingCT + zk-STARK shielded pool
- **Hardware Wallet**: Connect Ledger/Trezor via Bluetooth
- **Biometric Auth**: FaceID/TouchID unlock for transactions
- **Push Notifications**: Transaction alerts, staking rewards, price alerts
- **Dark Mode**: Crypto-standard dark theme

## Tech Stack

- React Native (bare workflow)
- TypeScript
- React Navigation (stack + tabs)
- Zustand (state management)
- AsyncStorage (persistence)
- BIP39 cryptography

## Setup

```bash
cd mobile
npm install
npx react-native run-ios    # iOS
npx react-native run-android # Android
```

## Architecture

```
mobile/
├── App.tsx                 # Entry point
├── src/
│   ├── screens/            # 14 screens
│   ├── navigation/         # Stack + Tab navigators
│   ├── services/           # API, wallet, crypto, notifications
│   ├── store/              # Zustand global state
│   └── utils/              # Helpers
├── android/                # Android native project
└── ios/                    # iOS native project
```

## API Connection

Connects to the HSMC API server (port 3001) for all backend operations:
- `/rest/v1/*` — Supabase-compatible REST API
- `/shielded/*` — Privacy pool operations
- `/auth/*` — Authentication
- `/treasury/*` — Treasury data

## Security

- Seed phrases encrypted with PBKDF2 (600K iterations) + AES-256-GCM
- Private keys never leave the device
- Biometric authentication for transactions
- Auto-lock after configurable timeout
