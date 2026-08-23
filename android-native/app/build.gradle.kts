// HSMC Network — native Android wallet (Phase 1)
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Operator API key (x-api-key) for production /node-proxy access. Read from the
// HSMC_API_KEY Gradle property (set from gradle.properties / CI secret); empty by
// default. A real key is NEVER hardcoded in source. Operators can also supply the key
// at runtime via Settings (stored AES-256-GCM in SecurePrefs) — that takes precedence.
val hsmcApiKey: String = providers.gradleProperty("HSMC_API_KEY")
    .orElse("")
    .get()
    .trim()
    .replace("\"", "\\\"")

android {
    namespace = "com.hsmc.wallet"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hsmc.wallet"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        // Live HSMC API origin. This is the team's published host
        // (https://hsmc-network.ctonew.app), NOT a fake placeholder domain.
        // Override per-environment by editing this field (buildConfig is enabled below).
        buildConfigField("String", "API_BASE_URL", "\"https://hsmc-network.ctonew.app\"")
        // x-api-key for production /node-proxy auth. Empty unless HSMC_API_KEY is set
        // at build time (gradle.properties / CI secret). Never a hardcoded real key.
        buildConfigField("String", "HSMC_API_KEY", "\"$hsmcApiKey\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    // LocalLifecycleOwner for the auto-lock lifecycle observer.
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.biometric)
    // FragmentActivity is the host for BiometricPrompt on all API levels.
    implementation(libs.androidx.fragment.ktx)
    // Real QR encoding for the Receive screen (pure-JVM, no camera dependency).
    implementation(libs.zxing.core)
    // Keccak-256 for the on-chain address derivation (same digest the Rust node uses).
    implementation(libs.bouncycastle.bcprov)
    // IO dispatcher for the node-proxy HTTP client (NodeClient, Phase 3).
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    // Real org.json implementation for NodeClient JSON-parsing unit tests
    // (the android.jar copy is stubbed/throws in local unit tests).
    testImplementation(libs.orgjson)
}
