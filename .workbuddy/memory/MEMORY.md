# MEMORY.md - 长期记忆

## 项目信息

- **项目**: now-android - 剪贴板管理 Android 应用
- **技术栈**: React + Tailwind CSS + Tauri
- **组件目录**: `now-android/src/components/`

## 项目样式规范

### 按钮样式

**导入导出按钮样式参考** (MutualTransferModal.tsx):

```tsx
// 蓝色主题（导出）
<button className="w-full p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center gap-3">
  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
    <Icon name="laptop_mac" className="text-blue-400" size={20} />
  </div>
  ...
</button>

// 绿色主题（导入）
<button className="... bg-green-500/20 ... text-green-400 ...">
  <Icon name="smartphone" ... />
</button>
```

### 组件创建记录

- **2026-04-10**: 创建了 `ImportExportButtons.tsx` 组件，包含：
  - `IconButton` - 图标按钮
  - `TransferButton` - 导入导出卡片按钮
  - `PrimaryButton` - 主要操作按钮（蓝/绿/红色）
  - `SecondaryButton` - 次要操作按钮（白色透明背景）
