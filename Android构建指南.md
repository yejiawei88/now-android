# Android APK 构建指南

## 方法一：使用 GitHub Actions（推荐）

### 步骤

1. **推送代码到 GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/now-android.git
   git push -u origin main
   ```

2. **在 GitHub 上触发构建**
   - 访问你的 GitHub 仓库
   - 点击 **Actions** 标签
   - 选择 **Build Android APK** 工作流
   - 点击 **Run workflow**

3. **下载 APK**
   - 构建完成后，点击 workflow 运行
   - 在 Artifacts 部分下载 `now-android-apk`

### 自动触发
- 每次推送到 `main` 或 `master` 分支时会自动构建
- 也可以手动触发：仓库 → Actions → Build Android APK → Run workflow

---

## 方法二：本地使用 WSL（如果你有 WSL）

如果你安装了 WSL (Windows Subsystem for Linux)，可以避免路径空格问题：

```bash
# 在 WSL 中
cd /mnt/d/word/practise/ai\ code/Now/phone/now\ Android/now-android
npm install
rustup target add aarch64-linux-android
npm run tauri build -- --target aarch64-linux-android
```

---

## 方法三：移动项目到无空格路径

1. 将项目复制到无空格路径：
   ```bash
   xcopy "D:\word\practice\ai code\Now\phone\now Android" "D:\now-android" /E /I
   ```

2. 在新路径中运行：
   ```bash
   cd D:\now-android\now-android
   npm run tauri build -- --target aarch64-linux-android
   ```

---

## 当前状态

- ✅ Windows 安装包已构建完成
- 📋 GitHub Actions 工作流已配置
- ⏳ Android APK 需要通过 GitHub Actions 构建
