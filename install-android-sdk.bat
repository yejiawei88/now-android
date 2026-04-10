@echo off
set JAVA_HOME=C:\Progra~1\Microsoft\jdk-17.0.18.8-hotspot
set ANDROID_SDK_ROOT=C:\Users\18268\android-sdk

echo Installing Android SDK components...
"C:\Users\18268\android-sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=%ANDROID_SDK_ROOT% --install "platforms;android-34" "build-tools;34.0.0"

echo.
echo Installation complete!
pause
