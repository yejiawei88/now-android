---
name: fix-clipboard-context
overview: 修复 Vite 构建错误：创建缺失的 ClipboardContext.tsx 文件，使 ClipboardView 和 ClipboardCardItem 能够正常工作
todos:
  - id: create-clipboard-context
    content: 创建 src/context 目录和 ClipboardContext.tsx 文件，包含 ClipboardProvider、useClipboard hook 和完整的类型定义
    status: completed
---

## 问题描述

Vite 构建错误：无法解析模块 `../context/ClipboardContext`。两个文件导入了不存在的 ClipboardContext：

- `src/views/ClipboardView.tsx` (第 30 行) 导入 `ClipboardProvider`
- `src/components/Clipboard/ClipboardCardItem.tsx` (第 6 行) 导入 `useClipboard`

## 修复目标

创建 `src/context/ClipboardContext.tsx` 文件，包含：

1. ClipboardContext 的类型定义
2. ClipboardProvider 组件
3. useClipboard hook

根据 ClipboardView.tsx 中的 contextValue 结构（1217-1269 行），需要暴露以下上下文：

- language, activeLibraryId, pasteTagsWithComma, bilingualTagsEnabled, translationSettings
- editingTag, editingContent 状态及操作函数
- handleCopy, startEditItem, removeItem, setItems 等方法
- handleAddTag, onOpenEditor, handleContextMenu, handleTagContextMenu
- handleEnterFolder, handleMoveTagToFolder, handleCombineDocumentTagsIntoFolder
- pasteDocumentTags, removeDocumentTagsBulk

## 技术方案

### 实现方式

创建 React Context 来共享剪贴板视图的复杂状态和回调函数，避免在深层组件间层层传递 props。

### 关键设计

- Context Value 使用 `useMemo` 优化，避免不必要的重渲染
- Provider 接收一个 value prop，由父组件计算并传入
- TypeScript 接口定义完整的上下文结构

### 性能考虑

- ClipboardView 组件中 contextValue 已使用 useMemo 缓存
- 依赖数组包含所有使用到的状态和回调，确保变更时正确更新