import React from 'react';

interface ActivationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Deprecated: activation flows are centralized in ActivationView to avoid logic drift.
const ActivationModal: React.FC<ActivationModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-[100] flex items-center justify-center p-6 overflow-hidden">
            <div className="absolute inset-0 bg-black/80 animate-in fade-in duration-300" onClick={onClose}></div>
            <div className="relative w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#09090B] p-6 text-white shadow-2xl">
                <h3 className="mb-3 text-lg font-semibold">授权入口已迁移</h3>
                <p className="text-sm text-white/70 leading-6">
                    激活、换绑和设备管理已统一到“授权中心”页面。
                    请关闭当前弹窗后，从设置页进入授权中心继续操作。
                </p>
                <div className="mt-5 flex justify-end">
                    <button
                        onClick={onClose}
                        className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/90 hover:bg-white/10 transition-colors"
                    >
                        我知道了
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActivationModal;
