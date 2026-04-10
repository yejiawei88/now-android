@echo off
chcp 65001 >nul
echo ============================================
echo  Tauri Android 环境设置
echo ============================================
echo.

REM 设置环境变量 (当前会话)
set JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot
set ANDROID_HOME=C:\Users\18268\android-sdk
set ANDROID_SDK_ROOT=C:\Users\18268\android-sdk
set PATH=%JAVA_HOME%\bin;%PATH%
set PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%

echo ✅ 环境变量已设置:
echo    JAVA_HOME=%JAVA_HOME%
echo    ANDROID_HOME=%ANDROID_HOME%
echo.

REM 检查 ADB
where adb >nul 2>&1
if %errorlevel%==0 (
    echo ✅ ADB 已找到:
    adb version
) else (
    echo ❌ ADB 未找到!
    echo.
    echo 请先下载 platform-tools:
    echo   1. 访问: https://dl.google.com/android/repository/platform-tools-latest-windows.zip
    echo   2. 解压到: %ANDROID_HOME%\platform-tools
    echo   3. 重新运行本脚本验证
    echo.
)

REM 检查 Java
java -version >nul 2>&1
if %errorlevel%==0 (
    echo ✅ Java 已找到
) else (
    echo ❌ Java 未找到
)

echo.
echo ============================================
echo  快速操作
echo ============================================
echo.

:menu
echo 请选择操作:
echo   1. 初始化 Tauri Android (npm run tauri android init)
echo   2. 构建 APK (npm run tauri android build)
echo   3. 启动开发服务器 (npm run tauri android dev)
echo   4. 仅检查环境
echo   5. 退出
echo.

set /p choice="请输入选项 (1-5): "

if "%choice%"=="1" goto init
if "%choice%"=="2" goto build
if "%choice%"=="3" goto dev
if "%choice%"=="4" goto check
if "%choice%"=="5" goto end

:init
cd /d "%~dp0now-android"
call npm run tauri android init
goto end

:build
cd /d "%~dp0now-android"
call npm run tauri android build
goto end

:dev
cd /d "%~dp0now-android"
call npm run tauri android dev
goto end

:check
echo.
echo 环境检查:
echo.
echo JAVA_HOME: %JAVA_HOME%
echo ANDROID_HOME: %ANDROID_HOME%
echo.
java -version 2>&1 | findstr /i "version"
adb version 2>&1 | findstr /i "version"
echo.
goto menu

:end
echo.
pause
