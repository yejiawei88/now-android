@echo off
chcp 65001 >nul
echo ============================================
echo  Android Platform-Tools 下载脚本
echo ============================================
echo.
echo 由于网络限制，请使用以下方式下载：
echo.
echo 方式1: 手动下载
echo   浏览器访问: https://dl.google.com/android/repository/platform-tools-latest-windows.zip
echo   保存到: C:\Users\18268\android-sdk\platform-tools.zip
echo.
echo 方式2: 使用代理/VPN下载
echo   配置代理后重新运行本脚本
echo.
echo 方式3: 从其他设备复制
echo   如果你有其他设备的 Android SDK，直接复制 platform-tools 文件夹到
echo   C:\Users\18268\android-sdk\platform-tools
echo.
echo ============================================
echo.
set /p choice="是否尝试通过代理下载? (Y/N): "
if /i "%choice%"=="Y" (
    set /p proxy="请输入代理地址 (例如 http://127.0.0.1:7890): "
    powershell -Command "[Net.WebRequest]::DefaultWebProxy = New-Object Net.WebProxy('%proxy%'); $webClient = New-Object System.Net.WebClient; $webClient.DownloadFile('https://dl.google.com/android/repository/platform-tools-latest-windows.zip', 'C:\Users\18268\android-sdk\platform-tools.zip'); Write-Host '下载完成'"
    if exist "C:\Users\18268\android-sdk\platform-tools.zip" (
        echo 正在解压...
        powershell -Command "Expand-Archive -Path 'C:\Users\18268\android-sdk\platform-tools.zip' -DestinationPath 'C:\Users\18268\android-sdk' -Force"
        del "C:\Users\18268\android-sdk\platform-tools.zip"
        echo.
        echo ✅ platform-tools 安装完成!
        echo.
        echo 验证安装:
        C:\Users\18268\android-sdk\platform-tools\adb.exe version
    ) else (
        echo ❌ 下载失败，请使用手动方式下载
    )
)
echo.
pause
