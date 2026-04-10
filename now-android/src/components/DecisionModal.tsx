import React from 'react';
import Icon from './Icon';

export interface DecisionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    desc: string;
    cancelText: string;
    confirmText: string;
    isDanger?: boolean;
}

export const DecisionModal: React.FC<DecisionModalProps> = ({ isOpen, onClose, onConfirm, title, desc, cancelText, confirmText, isDanger }) => {
    if (!isOpen) return null;
    return (
        <div className="absolute inset-0 z-[1001] flex items-center justify-center px-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-[320px] bg-[#09090B] border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50 text-center">
                <Icon name="warning" className={`${isDanger ? 'text-red-500/80' : 'text-white/40'} !text-[48px] mb-2`} size={48} />
                <h3 className="text-white font-bold text-[17px] mb-2">{title}</h3>
                <p className="text-white/80 text-[13px] mb-6 leading-relaxed">{desc}</p>
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-bold hover:bg-white/10 transition-all active:scale-95"
                    >{cancelText}</button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-2.5 rounded-xl text-[14px] font-bold border active:scale-95 transition-all ${isDanger 
                            ? 'bg-red-500/20 text-red-500 border-red-500/20 hover:bg-red-500/30' 
                            : 'bg-white/10 text-white border-white/10'}`}
                    >{confirmText}</button>
                </div>
            </div>
        </div>
    );
};

export default DecisionModal;
