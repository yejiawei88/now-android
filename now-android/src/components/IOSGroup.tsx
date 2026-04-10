
import React from 'react';

interface IOSGroupProps {
  children: React.ReactNode;
  className?: string;
}

const IOSGroup: React.FC<IOSGroupProps> = ({ children, className = '' }) => {
  return (
    <div className={`bg-[var(--ios-secondary-bg)] rounded-xl mb-6 overflow-hidden ${className}`}>
      {children}
    </div>
  );
};

export default IOSGroup;
