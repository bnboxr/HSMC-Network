# HSMC Network — Native Android Wallet (Phase 1)

Privacy-first Layer 1 wallet for the HSMC Network, written in Kotlin with Jetpack Compose
(Material 3, dark theme). This is a standalone Gradle project rooted at `android-native/`.

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

`gradle.properties` sets `-Xmx2g` and `org.gradle.workers.max=2` so the build stays within
modest memory budgets.

## What Phase 1 actually does (honest scope)

Phase 1 is a **wallet-key foundation, not a live wallet**. Real and implemented:

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
  key state; notification permission toggle (API 33+).

Honestly **not** implemented (deliberately, Phase 2):

- **No node RPC client** — no balances, no real transactions, no addresses are shown or
  fabricated. Send/Receive/History/Detail show truthful "not available" states rather than
  fake data. Nothing is ever broadcast.
- **No fake crypto** — no fabricated transaction hashes, no HMAC "signatures", no
  theatrical hardware-wallet scanning, no simulated proofs. Marketing claims (RingCT,
  CLSAG, post-quantum) are not repeated as implemented features.
- **No wallet deletion / seed reveal** — destructive actions are intentionally absent.
- **Hardware wallet, staking, mining, HSMCPay** — entry points are scaffolds; the
  underlying flows land with node integration in Phase 2.

## Security posture

- `allowBackup=false` (see `AndroidManifest.xml` comment), no data-extraction backups.
- Main manifest permits **no cleartext traffic**; debug builds allow cleartext only to
  `10.0.2.2`/`localhost` for local node development.
- Seed never leaves the device unencrypted; mnemonic is never passed through navigation
  arguments (held in-memory in `PendingMnemonic`, cleared after persist).
- `BuildConfig.API_BASE_URL` points at the team's live host
  (`https://hsmc-network.ctonew.app`); no hardcoded secrets in source.

## Project layout

```
app/src/main/java/com/hsmc/wallet/
  core/        BIP39, Keystore wrapper, BiometricPrompt helper, encrypted prefs,
               wallet storage, wordlist, in-memory pending mnemonic, constants
  navigation/  AppNavGraph — all 15 destinations
  ui/          components (cards/buttons/status rows), screens (15), theme
app/src/main/res/raw/words.txt   official BIP39 English wordlist (2048)
```

Compile verification runs on CI — the shared dev machine has no JDK/SDK, so this tree was
verified by inspection (imports, routes, crypto primitives).
