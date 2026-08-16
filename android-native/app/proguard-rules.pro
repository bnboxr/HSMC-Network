# HSMC Network — native Android wallet (Phase 1)
# ProGuard / R8 rules.
#
# Phase 1 ships no custom rules: the default proguard-android-optimize.txt plus
# the consumer rules bundled with AndroidX (Compose, navigation, biometric)
# cover this app. Revisit after adding reflection/JNI-based code.
#
# Explicit keep for the Keystore-backed crypto helpers (they are referenced
# only via the sealed WalletException hierarchy — kept as a safety net):
-keep class com.hsmc.wallet.core.** { *; }

# Keep the node-proxy client types (referenced only via the JSON parser +
# sealed result classes; R8 would otherwise rename fields the unit tests use):
-keep class com.hsmc.wallet.network.** { *; }
