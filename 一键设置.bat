@echo off
chcp 65001 >nul
title Android Platform-Tools 设置

echo.
echo ========================================
echo    Android ADB 环境一键设置
echo ========================================
echo.

:: 检查是否已有 platform-tools
if exist "C:\Users\18268\android-sdk\platform-tools\adb.exe" (
    echo [OK] ADB 已安装
    goto :setup_env
)

:: 检查压缩包是否存在
if exist "C:\Users\18268\android-sdk\platform-tools.zip" (
    echo [OK] 找到 platform-tools.zip，开始解压...
    powershell -Command "Expand-Archive -Path 'C:\Users\18268\android-sdk\platform-tools.zip' -DestinationPath 'C:\Users\18268\android-sdk' -Force"
    del "C:\Users\18268\android-sdk\platform-tools.zip"
    goto :setup_env
)

:: 检查下载目录
if exist "%USERPROFILE%\Downloads\platform-tools.zip" (
    echo [OK] 在下载目录找到 platform-tools.zip
    copy "%USERPROFILE%\Downloads\platform-tools.zip" "C:\Users\18268\android-sdk\platform-tools.zip"
    powershell -Command "Expand-Archive -Path 'C:\Users\18268\android-sdk\platform-tools.zip' -DestinationPath 'C:\Users\18268\android-sdk' -Force"
    del "C:\Users\18268\android-sdk\platform-tools.zip"
    goto :setup_env
)

echo.
echo [需要下载] 请手动下载 platform-tools:
echo.
echo ========================================
echo    请按以下步骤操作:
echo ========================================
echo.
echo 1. 打开浏览器访问:
echo    https://dl.google.com/android/repository/platform-tools-latest-windows.zip
echo.
echo 2. 下载完成后，将文件移动/复制到:
echo    C:\Users\18268\android-sdk\platform-tools.zip
echo.
echo 3. 再次运行此脚本
echo.
echo ========================================
echo.
pause
exit

:setup_env
echo.
echo [步骤 2] 设置环境变量...

:: 设置 ANDROID_HOME
setx ANDROID_HOME "C:\Users\18268\android-sdk" /M >nul
setx ANDROID_SDK_ROOT "C:\Users\18268\android-sdk" /M >nul

:: 添加到 PATH
set "PATH_NEW=%ANDROID_HOME%\platform-tools"
setx PATH_BACKUP "%PATH%" >nul

:: 直接在当前会话设置
set ANDROID_HOME=C:\Users\18268\android-sdk
set ANDROID_SDK_ROOT=C:\Users\18268\android-sdk
set PATH=%ANDROID_HOME%\platform-tools;%PATH%

echo [OK] 环境变量已设置

echo.
echo [步骤 3] 验证 ADB 安装...
echo.

:: 刷新环境变量
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
adb version

echo.
echo ========================================
echo    设置完成！
echo ========================================
echo.
echo 下一步:
echo 1. 重新打开命令行窗口
echo 2. 连接 Android 设备
echo 3. 运行: adb devices
echo.
pause
