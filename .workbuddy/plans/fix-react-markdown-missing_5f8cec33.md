---
name: fix-react-markdown-missing
overview: 在 now-android 项目中安装缺失的 react-markdown 依赖，解决 Vite 构建时 "Failed to resolve import" 错误。需要执行 npm install react-markdown 并验证构建通过。
todos:
  - id: install-react-markdown
    content: 在 now-android/package.json 中添加 react-markdown ^9.0.3 依赖并执行 npm/pnpm install
    status: completed
  - id: verify-build
    content: 验证 Vite 开发服务器可正常启动且不再报 resolve 错误
    status: completed
    dependencies:
      - install-react-markdown
---

## Product Overview

修复 now-android 项目中 `react-markdown` 依赖缺失导致的 Vite 构建错误。

## Core Features

- 安装缺失的 `react-markdown` npm 依赖包（兼容 React 19 + remark-gfm v4）
- 确保两处使用点（DocumentEditorView.tsx 和 MessageItem.tsx）均可正常解析导入
- 验证构建错误消除

## Tech Stack

- 项目框架：Vite 7.0.4 + React 19.1.0 (TypeScript)
- 包管理器：npm / pnpm（需确认）
- 目标依赖：`react-markdown ^9.0.x`（兼容 React 19 + remark-gfm v4）

## Tech Architecture

### 问题根因分析

```
package.json dependencies
├── remark-gfm: ^4.0.1     ✅ 已安装
├── react: ^19.1.0         ✅ 已安装
└── react-markdown          ❌ 缺失（根本原因）
```

代码使用点：

1. **DocumentEditorView.tsx:15-17** — `React.lazy(() => import('react-markdown'))` 动态导入
2. **MessageItem.tsx:2** — `import ReactMarkdown from 'react-markdown'` 静态导入

### 解决方案

在 `package.json` 的 `dependencies` 中添加 `react-markdown`，版本选择 `^9.0.3`：

- 兼容 React 19（支持 react 18+）
- 与已安装的 `remark-gfm@^4.0.1` 完全兼容
- 支持动态 `import()` 和静态 `import` 两种方式
- Vite 7 原生支持 ESM，react-markdown v9 提供 ESM 导出

## Implementation Details

### 核心目录结构

```
now-android/
├── package.json                    # [MODIFY] 添加 react-markdown 到 dependencies
├── src/
│   ├── views/
│   │   ├── DocumentEditorView.tsx   # [NO MODIFY] 第15-17行 lazy import 将自动生效
│   │   └── chat/
│   │       └── MessageItem.tsx      # [NO MODIFY] 第2行 static import 将自动生效
```