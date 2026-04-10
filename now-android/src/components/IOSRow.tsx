import React from 'react';

interface IOSRowProps {
  children: React.ReactNode;
  isLast?: boolean;
  onClick?: () => void;
  className?: string;
}

const IOSRow: React.FC<IOSRowProps> = ({ children, isLast = false, onClick, className = '' }) => {
  return (
    <div
      onClick={onClick}
      className={`relative flex items-center justify-between px-4 py-[11px] min-h-[44px] transition-colors duration-200 ${onClick ? 'cursor-pointer hover:bg-white/5 active:bg-white/10' : ''
        } ${className}`}
    >
      {children}
      {!isLast && (
        <div className="absolute bottom-0 right-0 left-0 h-[0.5px] bg-[var(--ios-separator)]"></div>
      )}
    </div>
  );
};

export default IOSRow;
