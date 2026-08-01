# React Native (facebook/react-native) — default rules
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip

# Do not strip any method/class that is annotated with @DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keep @com.facebook.common.internal.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}

-keepclassmembers @com.facebook.proguard.annotations.KeepGettersAndSetters class * {
  void set*(***);
  *** get*();
}

-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers,includedescriptorclasses class * { native <methods>; }
-keepclassmembers class *  { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class *  { @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>; }

-dontwarn com.facebook.react.**
-keep,includedescriptorclasses class com.facebook.react.bridge.** { *; }
-keep,includedescriptorclasses class com.facebook.react.turbomodule.** { *; }

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# Kotlin
-dontwarn kotlin.**

# react-native-vector-icons
-keep class com.oblador.vectoricons.** { *; }

# react-native-vision-camera (codegen)
-keep class com.mrousavy.camera.** { *; }
-dontwarn com.mrousavy.camera.**

# react-native-keychain
-keep class com.oblador.keychain.** { *; }

# react-native-biometrics
-keep class com.aakashns.reactnativenfc.** { *; }
-keep class com.rnbiometrics.** { *; }

# notifee
-keep class app.notifee.** { *; }

# react-native-ble-plx
-keep class com.polidea.reactnativeble.** { *; }

# react-native-splash-screen
-keep class org.devio.rn.splashscreen.** { *; }

# zustand / zod / qrcode (no native code) — keep default

# OkHttp (transitive)
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Keep enum values (used by React Native)
-keepclassmembers enum * { *; }
