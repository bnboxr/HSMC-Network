// HSMC Network — native Android wallet (Phase 1)
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

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
