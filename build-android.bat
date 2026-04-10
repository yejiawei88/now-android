@echo off
setlocal

set "JAVA_HOME=C:\Progra~1\Microsoft\jdk-17.0.18.8-hotspot"
set "ANDROID_HOME=C:\Users\18268\android-sdk"
set "ANDROID_SDK_ROOT=C:\Users\18268\android-sdk"
set "NDK_HOME=C:\Users\18268\android-sdk\ndk\26.1.10909125"

cd /d "d:\word\practise\ai code\Now\phone\now Android\now-android"

echo Building Android APK...
echo.

call npm run tauri build -- --target aarch64-linux-android

echo.
echo Build complete!
pause
