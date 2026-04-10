---
name: now-android-adaptation
overview: 将 Now 项目从 Windows 专属的 Tauri 桌面应用适配为 Android 版，保留剪贴板、设置、对话三个核心模块，裁剪所有 Windows 专属依赖和快捷启动相关功能。
design:
  architecture:
    framework: react
  styleKeywords:
    - Dark Mode
    - Mobile First
    - Minimalist
    - Bottom Navigation
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 20px
      weight: 600
    subheading:
      size: 16px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#0A84FF"
      - "#007AFF"
    background:
      - "#09090B"
      - "#121214"
      - "#161618"
    text:
      - "#FFFFFF"
      - "#FFFFFF80"
      - "#FFFFFF60"
    functional:
      - "#34C759"
      - "#FF453A"
      - "#FF9500"
todos:
  - id: setup-project
    content: 初始化 Android 项目结构，配置 Tauri 2 Android 支持
    status: completed
  - id: cargo-deps
    content: 改造 Cargo.toml，移除 Windows 专属依赖，添加 Android 兼容配置
    status: completed
    dependencies:
      - setup-project
  - id: rust-backend
    content: 重写 lib.rs，移除托盘/快捷键/焦点追踪，保留数据库和核心命令
    status: completed
    dependencies:
      - cargo-deps
  - id: remove-win32
    content: 删除 win32.rs、automation.rs，清理 shortcuts.rs 中的全局快捷键逻辑
    status: completed
    dependencies:
      - rust-backend
  - id: adapt-commands
    content: 改造 commands/mod.rs，保留数据库和文件命令，简化 paste_text 为仅写入剪贴板
    status: completed
    dependencies:
      - remove-win32
  - id: frontend-tabs
    content: 改造 App.tsx，移除 HomeView/TranslationView/ActivationView，调整为底部三 Tab 导航
    status: completed
    dependencies:
      - setup-project
  - id: mobile-layout
    content: 移除桌面元素（drag-region, ResizeHandles），适配移动布局
    status: completed
    dependencies:
      - frontend-tabs
  - id: build-test
    content: 配置 Android 构建，测试运行
    status: completed
    dependencies:
      - adapt-commands
      - mobile-layout
---

## 产品概述

将 Now 桌面应用（Tauri 2）适配为 Android 版本，保留核心功能：剪贴板管理、设置、AI 对话。移除所有 Windows 专属功能和全局快捷键系统。

## 核心功能

- **剪贴板**：浏览、搜索、分类管理剪贴板历史；文档编辑器支持多标签编辑
- **设置**：应用配置、AI 模型配置、数据导入导出
- **对话**：AI 聊天界面，支持多种 LLM 提供商

## 移除功能

- 快捷启动（HomeView 及 ShortcutItem 系统）
- 翻译视图（TranslationView）
- 激活/授权系统（ActivationView + license.rs）
- 全局快捷键（tauri-plugin-global-shortcut）
- 系统托盘图标
- 模拟粘贴到其他 APP（paste_text 中的 keybd_event）
- Windows 窗口焦点追踪
- OCR 截图流
- 窗口置顶/任务栏隐藏/开机自启

## Tech Stack

- **框架**：Tauri 2（支持 Android）
- **前端**：React + TypeScript + Tailwind CSS（复用现有代码）
- **后端**：Rust + SQLite（rusqlite bundled）
- **移动端插件**：
- `tauri-plugin-clipboard-manager`：基础剪贴板读写
- `tauri-plugin-http`：AI 对话 HTTP 请求
- `tauri-plugin-notification`：本地通知
- `tauri-plugin-dialog`：文件选择（有限支持）

## 实现策略

采用**条件编译 + 功能裁剪**策略：

1. 使用 `#[cfg(target_os = "android")]` 和 `#[cfg(not(target_os = "android"))]` 区分平台代码
2. Android 版本移除所有 Windows 专属依赖（winreg, rdev, clipboard-master, clipboard-win, notify, trash）
3. 保留核心数据库操作（db.rs）和文件操作（files.rs）
4. 前端移除 HomeView Tab，调整导航结构为移动优先

## 关键改造点

### Rust 后端

- **Cargo.toml**：移除 Windows 专属依赖，保留跨平台依赖
- **lib.rs**：移除托盘、全局快捷键、焦点追踪线程；保留数据库初始化和基础插件
- **commands/mod.rs**：保留数据库命令和文件命令；移除 paste_text 中的模拟粘贴逻辑（Android 仅支持写入剪贴板，不支持模拟粘贴到其他应用）
- **automation.rs**：整个文件移除（rdev 键盘模拟）
- **commands/win32.rs**：整个文件移除
- **commands/shortcuts.rs**：保留数据结构，移除全局快捷键注册逻辑
- **commands/window.rs**：移除窗口控制命令（Android 无窗口概念）

### 前端改造

- **App.tsx**：移除 HomeView Tab，调整 TAB_ITEMS 为 [SETTINGS, CLIPBOARD, CHAT]
- **移除视图**：HomeView, TranslationView, ActivationView 及相关引用
- **响应式适配**：调整布局为移动优先（移除 drag-region, ResizeHandles 等桌面元素）

### 数据持久化

- SQLite 数据库通过 `rusqlite` 的 bundled 特性支持 Android
- 应用数据目录使用 Tauri 的 `app.path().app_data_dir()`

## 设计方向

移动优先的深色主题界面，保留 Now 原有的深色风格（#09090B 背景），适配手机竖屏布局。

### 页面结构

1. **底部导航栏**：设置、剪贴板、对话三个 Tab
2. **剪贴板页**：顶部搜索栏 + 分类标签 + 卡片列表
3. **文档编辑器**：全屏编辑模式，顶部返回按钮
4. **设置页**：分组设置项，支持展开/折叠
5. **对话页**：类聊天界面，底部输入框

### 布局调整

- 移除桌面版的拖拽区域、窗口控制按钮
- 采用底部 Tab 导航替代顶部 Tab
- 卡片列表改为垂直滚动，支持触摸滑动
- 搜索框固定在顶部，支持实时过滤