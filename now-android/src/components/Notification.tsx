import React from 'react';
import Icon from './Icon';

interface NotificationProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
    icon?: string;
}

export const Notification: React.FC<NotificationProps> = ({ isOpen, onClose, type, title, message, icon }) => {
    if (!isOpen) return null;

    const bgColors = {
        success: 'bg-[#000000] border-green-500/30 shadow-2xl shadow-green-900/20',
        error: 'bg-[#000000] border-red-500/30 shadow-2xl shadow-red-900/20',
        info: 'bg-[#000000] border-blue-500/30 shadow-2xl shadow-blue-900/20'
    };

    const iconColors = {
        success: 'text-green-400',
        error: 'text-red-400',
        info: 'text-blue-400'
    };

    const defaultIcons = {
        success: 'check_circle',
        error: 'error',
        info: 'info'
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80" onClick={onClose}>
            <div
                className={`relative w-[400px] rounded-2xl border ${bgColors[type]} p-6 shadow-2xl animate-in fade-in zoom-in duration-200`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-all text-white/60 hover:text-white"
                >
                    <Icon name="close" className="!text-[20px]" size={20} />
                </button>

                {/* Icon and content */}
                <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-full bg-white/10 flex items-center justify-center ${iconColors[type]}`}>
                        <Icon name={icon || defaultIcons[type]} className="!text-[28px]" size={28} />
                    </div>

                    <div className="flex-1 pt-1">
                        <h3 className="text-[18px] font-semibold text-white mb-2">{title}</h3>
                        {message && (
                            <p className="text-[14px] text-white/70 leading-relaxed">{message}</p>
                        )}
                    </div>
                </div>

                {/* Action button */}
                <div className="mt-6 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-white text-[14px] font-medium transition-all border border-white/10 hover:border-white/20"
                    >
                        确定
                    </button>
                </div>
            </div>
        </div>
    );
};
