# HSMC Network — Native Android Wallet
Privacy-first Layer 1 wallet for the HSMC Network, written in Kotlin with Jetpack Compose
(Material 3, dark theme). This is a standalone Gradle project rooted at `android-native/`.

**Status: Phase 3 step 2 (security hygiene).** Phase 1 = wallet-key foundation,
Phase 2 = real wallet lifecycle (create/import/unlock/biometric/settings/receive), Phase 3
step 1 = real node connectivity: NodeClient through the API server's /node-proxy bridge,
real balance fetch, real tx submission path, honest transaction history. Phase 3 step 2 =
security hardening from the Android security review: key-material zeroization (HdKeys,
BIP39), crash-atomic biometric re-key, FLAG_SECURE on every address-bearing screen,
https-only node URL validation, commit()-based wallet deletion, README refresh. Staking,
mining, privacy proofs and hardware wallet remain scaffolds for later Phase 3 steps.

## Build
Prerequisites:
- **JDK 17+**
- **Android SDK** with platform 35 and build-tools 35.0.0
  (AGP 8.7.3, compileSdk 35, minSdk 26, targetSdk 34)
- Gradle 8.10.2 — supplied via the wrapper, no local Gradle install needed
```bash
cd android-native
./gradlew assembleDebug
```
The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
Version pins (see `gradle/libs.versions.toml`):

| Component | Version | Note |
|---|---|---|
| Gradle wrapper | 8.10.2 | pinned in `gradle/wrapper/gradle-wrapper.properties` |
| Android Gradle Plugin | 8.7.3 | must stay ≤ 8.8 (8.9+ requires Gradle ≥ 8.11.1) |
| Kotlin | 2.0.21 | with `org.jetbrains.kotlin.plugin.compose` 2.0.21 |
| Compose BOM | 2024.12.01 | |
| androidx.biometric | 1.1.0 | BiometricPrompt host |
| kotlinx-coroutines-android | 1.8.1 | IO dispatcher for NodeClient |

`gradle.properties` sets `-Xmx2g` and `org.gradle.workers.max=2` so the build stays within
modest memory budgets.

## What the app actually does (honest scope)
Real and implemented across phases:
- **Real BIP39** — entropy → mnemonic and mnemonic → seed use the actual BIP39 algorithm
  (SHA-256 checksum, PBKDF2-HMAC-SHA512, 2048-iteration standard salt), with the official
  2048-word English wordlist shipped as a raw resource. Validation recomputes the checksum;
  there is no fake sum-of-indices scheme.
- **Real Android Keystore encryption** — the 64-byte BIP39 seed is encrypted at rest with
  AES-256-GCM under a Keystore key; only `base64(iv || ciphertext)` ever touches disk.
- **Real biometric binding** — the seed key can be created with strong-biometric
  authentication required (no timeout). Login and the biometric setup screen run the real
  BiometricPrompt; the seed only decrypts after a successful prompt.
- **15-screen Compose navigation** — Welcome, Login, Create/Import wallet, seed-phrase
  confirmation quiz, biometric setup, dashboard, send/receive/history/detail, staking,
  privacy, hardware wallet, settings.
- **Settings** — theme mode persisted and applied; biometric status read from the real
  key state; notification permission toggle (API 33+); live node status row.
- **NodeClient** (`app/src/main/java/com/hsmc/wallet/network/NodeClient.kt`) — real HTTP
  client (HttpURLConnection; the only new runtime dep is kotlinx-coroutines for the IO
  dispatcher) that talks to the HSMC Rust node EXCLUSIVELY through the API server's
  `/node-proxy` bridge — the ONE sanctioned path (`server/api-server.ts`
  `handleNodeProxy` + `NODE_PROXY_WHITELIST`). It mirrors the web frontend's
  `src/utils/node-tx.ts` envelope semantics (`{ path, method, data }` → `{ ok,
  node_online, data }`) and never fabricates a result.
- **Dashboard** — fetches the REAL on-chain balance from the node (`GET /utxo/{address}`
  through the bridge) and shows it only when the node answered; otherwise it shows
  "Balance unavailable" with the real reason (node offline / node error). No
  fabricated "0.00000000". (The balance + history routes have been in the server's
  `/node-proxy` whitelist since PR #16 — this works end-to-end when the node is online.)
- **Send** — builds a real `SubmitTxPayload` (field names mirror the Rust
  `SubmitTxRequest`) and submits via `POST /tx/submit`. The node's actual response is
  shown: a real tx_hash when accepted into the mempool (with a "Check status" path via
  the whitelisted `GET /tx/{hash}`), or the node's real error string when rejected. No
  hash is ever fabricated.
- **Transaction history/detail** — lists only entries the node returns
  (`GET /address/{address}/txs` through the bridge) and queries live status per tx
  (`GET /tx/{hash}`); empty/error states are explicit and honest.

Honestly **not** implemented:
- **RingCT/stealth/full privacy sends** — the app submits transparent transactions only
  (the node's `validate_tx` accepts transparent txs without ring signatures). Privacy
  sends require wallet-side RingCT construction, which lands in a later step.
- **Staking, mining, HSMCPay, hardware wallet, notifications** — entry points remain
  scaffolds; the underlying flows land in later Phase 3 steps.
- **No fake crypto** — no fabricated transaction hashes, no HMAC "signatures", no
  theatrical hardware-wallet scanning, no simulated proofs. Marketing claims (RingCT,
  CLSAG, post-quantum) are not repeated as implemented features.
- **No seed reveal** — seed export is intentionally disabled (a full security review is
  required before it ships); no fake reveal is offered. Deleting the wallet on-device is
  a real, confirmed destructive action (Settings → Danger zone).

## Security posture
- `allowBackup=false` (see `AndroidManifest.xml` comment), no data-extraction backups.
- Main manifest permits **no cleartext traffic**; debug builds allow cleartext only to
  `10.0.2.2`/`localhost` for local node development. The app only dials the API server
  over TLS; the user-configured node URL is never dialed directly.
- **Phase 3 step 2 hardening** (from the Android security review):
  - **Key-material zeroization** — HMAC intermediates in `HdKeys` (`masterFromSeed`'s
    full output, `deriveChild`'s data/out/IL), BIP39 entropy in `generate`, and the
    PBKDF2 password buffer in `toSeed` (`PBEKeySpec.clearPassword()`) are all cleared
    in `finally` blocks; returned values are never cleared.
  - **Crash-atomic biometric re-key** — enabling biometric protection creates the new
    biometric-bound Keystore key under a second alias, wraps the DEK with it, commits
    the new blob and the active-alias pointer, and only then retires the old key. A
    process death at any step leaves password unlock working and the previous state
    intact (no delete-before-create window).
  - **FLAG_SECURE on every address-bearing screen** — Dashboard, Login, Receive,
    Create and seed-phrase confirmation run under `SecureScreen` (no screenshots /
    screen recording / app-switcher preview of wallet addresses).
  - **https-only node URL validation** — Settings validates the node URL on save:
    https for any host, http only for local debug hosts (`127.0.0.1`, `localhost`,
    `10.0.2.2`); anything else is refused with an error and never persisted.
  - **Destructive ops are synchronous** — wallet deletion uses `commit()` so a process
    death right after "Delete wallet" cannot resurrect the wallet.
- Seed never leaves the device unencrypted; mnemonic is never passed through navigation
  arguments (held in-memory in `PendingMnemonic`, cleared after persist).
- The send flow uses only the public derived address (no seed access); request payloads
  and addresses are never logged.
- `BuildConfig.API_BASE_URL` points at the team's live host
  (`https://hsmc-network.ctonew.app`); no hardcoded secrets in source.

## Project layout
```
app/src/main/java/com/hsmc/wallet/
  core/        BIP39, Keystore wrapper, BiometricPrompt helper, encrypted prefs,
               wallet storage, wordlist, in-memory pending mnemonic, constants
  network/     NodeClient — /node-proxy bridge client (health, balance, submit, tx
               lookup, address txs) + honest result types
  navigation/  AppNavGraph — all 15 destinations
  ui/          components (cards/buttons/status rows), screens (15), theme
app/src/main/res/raw/words.txt   official BIP39 English wordlist (2048)
app/src/test/  BIP39 KATs, HD-keys KATs, NodeClient JSON contract tests
```
Compile verification runs on CI (`./gradlew assembleDebug` + `./gradlew testDebugUnitTest`).
