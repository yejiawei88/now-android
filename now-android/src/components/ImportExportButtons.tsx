import React from 'react';
import Icon from './Icon';

// ─── 按钮变体类型 ───────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning';

type ButtonSize = 'sm' | 'md' | 'lg';

interface BaseButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  onClick?: () => void;
}

// ─── 图标按钮变体颜色映射 ───────────────────────────────────────

const iconColorMap: Record<ButtonVariant, { bg: string; icon: string }> = {
  primary: { bg: 'bg-blue-500/20', icon: 'text-blue-400' },
  secondary: { bg: 'bg-white/10', icon: 'text-white/70' },
  success: { bg: 'bg-green-500/20', icon: 'text-green-400' },
  danger: { bg: 'bg-red-500/20', icon: 'text-red-400' },
  warning: { bg: 'bg-yellow-500/20', icon: 'text-yellow-400' },
};

// ─── 尺寸映射 ───────────────────────────────────────────────────

const sizeMap: Record<ButtonSize, { container: string; icon: string; text: string }> = {
  sm: { container: 'p-2', icon: 'w-8 h-8', text: 'text-[13px]' },
  md: { container: 'p-3', icon: 'w-10 h-10', text: 'text-[14px]' },
  lg: { container: 'p-4', icon: 'w-12 h-12', text: 'text-[15px]' },
};

// ─── 图标按钮组件 ───────────────────────────────────────────────

export interface IconButtonProps extends Omit<BaseButtonProps, 'children'> {
  icon: string;
  iconSize?: number;
  label?: string; // aria-label
  square?: boolean; // 是否为方形图标按钮
}

/**
 * 图标按钮 - 导入导出场景专用
 * 
 * @example
 * // 导出按钮
 * <IconButton icon="upload" variant="primary" label="导出" />
 * 
 * // 导入按钮
 * <IconButton icon="download" variant="success" label="导入" />
 */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  iconSize = 20,
  label,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  onClick,
  square = true,
}) => {
  const colors = iconColorMap[variant];
  const sizes = sizeMap[size];

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading}
      onClick={onClick}
      className={`
        flex items-center justify-center gap-2
        ${square ? sizes.container + ' ' + sizes.icon + ' rounded-xl' : 'px-4 py-2 rounded-xl'}
        bg-white/5 border border-white/10
        hover:bg-white/10 active:scale-95
        transition-all duration-150
        disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
        ${className}
      `}
    >
      {/* 图标容器 */}
      <div className={`${sizes.icon} rounded-lg ${colors.bg} flex items-center justify-center`}>
        <Icon name={icon} className={colors.icon} size={iconSize} />
      </div>
      
      {/* 可选的文字标签 */}
      {label && (
        <span className={`${sizes.text} text-white font-medium`}>
          {loading ? '处理中...' : label}
        </span>
      )}
    </button>
  );
};

// ─── 导入导出按钮组合组件 ──────────────────────────────────────

export interface TransferButtonProps {
  type: 'export' | 'import';
  title: string;
  description?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  size?: 'md' | 'lg';
  showArrow?: boolean;
  className?: string;
}

/**
 * 导入/导出按钮 - 完整卡片样式
 * 
 * @example
 * // 导出到电脑
 * <TransferButton
 *   type="export"
 *   title="导出到电脑"
 *   description="将剪贴板内容导出"
 *   onClick={handleExport}
 * />
 * 
 * // 导入到手机
 * <TransferButton
 *   type="import"
 *   title="导入到手机"
 *   description="从文件导入内容"
 *   onClick={handleImport}
 * />
 */
export const TransferButton: React.FC<TransferButtonProps> = ({
  type,
  title,
  description,
  disabled = false,
  loading = false,
  onClick,
  size = 'md',
  showArrow = true,
  className = '',
}) => {
  const colors = type === 'export' 
    ? { bg: 'bg-blue-500/20', icon: 'text-blue-400', border: 'border-blue-500/20' }
    : { bg: 'bg-green-500/20', icon: 'text-green-400', border: 'border-green-500/20' };

  const iconSize = size === 'md' ? 20 : 24;
  const padding = size === 'md' ? 'p-3' : 'p-4';

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
      className={`
        w-full ${padding} rounded-xl
        bg-white/5 border border-white/10
        hover:bg-white/10 active:scale-[0.98]
        transition-all duration-150
        flex items-center gap-3
        disabled:opacity-40 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {/* 图标 */}
      <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center`}>
        <Icon 
          name={type === 'export' ? 'laptop_mac' : 'smartphone'} 
          className={colors.icon} 
          size={iconSize} 
        />
      </div>

      {/* 文字 */}
      <div className="text-left flex-1 min-w-0">
        <div className="text-white font-medium text-[15px] truncate">
          {loading ? '处理中...' : title}
        </div>
        {description && (
          <div className="text-white/40 text-[12px] truncate">
            {description}
          </div>
        )}
      </div>

      {/* 箭头 */}
      {showArrow && (
        <Icon name="chevron_right" className="text-white/30 shrink-0" size={18} />
      )}
    </button>
  );
};

// ─── 主要导出按钮 (Primary Export Button) ───────────────────────

export interface PrimaryButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  iconPosition?: 'left' | 'right';
  className?: string;
  onClick?: () => void;
}

/**
 * 主要操作按钮 - 导入导出场景
 * 
 * @example
 * <PrimaryButton variant="success" icon="download" onClick={handleImport}>
 *   导入文件
 * </PrimaryButton>
 * 
 * <PrimaryButton variant="primary" icon="upload" onClick={handleExport}>
 *   导出文件
 * </PrimaryButton>
 */
export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  className = '',
  onClick,
}) => {
  const colorMap = {
    primary: 'bg-blue-500/20 hover:bg-blue-500/30 border-blue-500/30 text-blue-300',
    success: 'bg-green-500/20 hover:bg-green-500/30 border-green-500/30 text-green-300',
    danger: 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-300',
  };

  const sizeMap = {
    sm: 'py-1.5 px-3 text-[12px] gap-1.5',
    md: 'py-2.5 px-4 text-[13px] gap-2',
    lg: 'py-3 px-5 text-[14px] gap-2.5',
  };

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
      className={`
        inline-flex items-center justify-center
        ${sizeMap[size]}
        rounded-xl font-medium
        border transition-all duration-150
        active:scale-95
        disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
        ${colorMap[variant]}
        ${className}
      `}
    >
      {icon && iconPosition === 'left' && !loading && (
        <Icon name={icon} size={size === 'sm' ? 14 : size === 'md' ? 16 : 18} />
      )}
      {loading ? '处理中...' : children}
      {icon && iconPosition === 'right' && !loading && (
        <Icon name={icon} size={size === 'sm' ? 14 : size === 'md' ? 16 : 18} />
      )}
    </button>
  );
};

// ─── 次要按钮 (Secondary Button) ─────────────────────────────────

export interface SecondaryButtonProps {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  iconPosition?: 'left' | 'right';
  className?: string;
  onClick?: () => void;
}

/**
 * 次要操作按钮 - 取消/返回等场景
 */
export const SecondaryButton: React.FC<SecondaryButtonProps> = ({
  children,
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  className = '',
  onClick,
}) => {
  const sizeMap = {
    sm: 'py-1.5 px-3 text-[12px] gap-1.5',
    md: 'py-2.5 px-4 text-[13px] gap-2',
    lg: 'py-3 px-5 text-[14px] gap-2.5',
  };

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
      className={`
        inline-flex items-center justify-center
        ${sizeMap[size]}
        rounded-xl font-medium
        bg-white/5 hover:bg-white/10 border border-transparent
        text-white/80 hover:text-white
        transition-all duration-150
        active:scale-95
        disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
        ${className}
      `}
    >
      {icon && iconPosition === 'left' && !loading && (
        <Icon name={icon} size={size === 'sm' ? 14 : size === 'md' ? 16 : 18} />
      )}
      {loading ? '处理中...' : children}
      {icon && iconPosition === 'right' && !loading && (
        <Icon name={icon} size={size === 'sm' ? 14 : size === 'md' ? 16 : 18} />
      )}
    </button>
  );
};

export default {
  IconButton,
  TransferButton,
  PrimaryButton,
  SecondaryButton,
};
