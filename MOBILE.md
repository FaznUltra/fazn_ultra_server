# Mobile Stack Decision

**Stack:** React Native — Expo Bare Workflow

## Why Bare Workflow
- Ships iOS + Android from one codebase (target audience is mixed)
- Full native module access — no restrictions
- Keeps Expo tooling: EAS Build (cloud builds), OTA updates, expo-router

## Key Native Integrations
- **Screen recording:** ReplayKit (iOS) / MediaProjection (Android) via custom native modules
- **RTMP live streaming to Mux:** `react-native-nodemediaclient`
- **Push notifications:** `expo-notifications` (works in bare workflow)
- **Camera/mic:** standard React Native APIs

## What Bare Workflow Means
- You own the `ios/` and `android/` folders
- EAS Build compiles in the cloud — no need to run Xcode locally for every build
- Native modules can be added without ejecting further

## Rejected Alternatives
- **Expo managed:** blocked from ReplayKit / MediaProjection — can't do screen recording
- **Swift only:** iOS only, cuts out Android users
- **Pure React Native:** loses Expo DX (OTA, EAS Build) for no meaningful gain
