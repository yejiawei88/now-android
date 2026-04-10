@echo off
chcp 65001
setlocal EnableDelayedExpansion

echo ==========================================
echo Tauri Android SDK 安装脚本
echo ==========================================

:: 设置变量
set "ANDROID_SDK=%USERPROFILE%\android-sdk"
set "CMDLINE_TOOLS=%ANDROID_SDK%\cmdline-tools\latest"
set "TEMP_FILE=%TEMP%\android-cmdline-tools.zip"

:: 创建目录
echo [1/5] 创建目录结构...
if not exist "%ANDROID_SDK%" mkdir "%ANDROID_SDK%"
if not exist "%CMDLINE_TOOLS%" mkdir "%CMDLINE_TOOLS%"
if not exist "%ANDROID_SDK%\platforms" mkdir "%ANDROID_SDK%\platforms"
if not exist "%ANDROID_SDK%\build-tools" mkdir "%ANDROID_SDK%\build-tools"

:: 下载命令行工具
echo [2/5] 下载 Android 命令行工具...
echo 正在下载，请稍候...

:: 尝试多个镜像源
set "DOWNLOAD_URL=https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

powershell -Command "& {$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_FILE%' -TimeoutSec 300 } catch { Write-Host '下载失败，请手动下载并放到: %TEMP_FILE%' }}"

if not exist "%TEMP_FILE%" (
    echo.
    echo [错误] 自动下载失败，请手动下载：
    echo %DOWNLOAD_URL%
    echo 下载后放到: %TEMP_FILE%
    echo 然后重新运行此脚本
    pause
    exit /b 1
)

:: 解压
echo [3/5] 解压文件...
powershell -Command "Expand-Archive -Path '%TEMP_FILE%' -DestinationPath '%TEMP%\android-temp' -Force"

:: 移动文件
echo [4/5] 安装命令行工具...
xcopy /E /I /Y "%TEMP%\android-temp\cmdline-tools\*" "%CMDLINE_TOOLS%"

:: 清理临时文件
rmdir /S /Q "%TEMP%\android-temp"
del "%TEMP_FILE%"

:: 设置环境变量
echo [5/5] 设置环境变量...
setx ANDROID_HOME "%ANDROID_SDK%"
setx ANDROID_SDK_ROOT "%ANDROID_SDK%"

:: 添加到 PATH
for /f "tokens=2*" %%a in ('reg query HKCU\Environment /v Path 2^>nul') do set "USER_PATH=%%b"
if defined USER_PATH (
    setx PATH "%USER_PATH%;%%ANDROID_SDK%%\cmdline-tools\latest\bin;%%ANDROID_SDK%%\platform-tools"
) else (
    setx PATH "%%ANDROID_SDK%%\cmdline-tools\latest\bin;%%ANDROID_SDK%%\platform-tools"
)

echo.
echo ==========================================
echo 安装完成！
echo ==========================================
echo.
echo 请关闭并重新打开 PowerShell，然后运行：
echo.
echo   sdkmanager "platforms;android-33"
echo   sdkmanager "build-tools;33.0.0"
echo   sdkmanager "ndk;25.2.9519653"
echo   sdkmanager --licenses
echo.
echo 完成后即可构建 APK：
echo   npm run tauri android init
echo   npm run tauri android build
echo.
pause
