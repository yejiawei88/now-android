import React from 'react';
import { translations } from '../i18n';

interface ClipboardAddMenuProps {
    onClose: () => void;
    onAdd: (type: 'TEXT' | 'TAGS' | 'DOCUMENT', parent?: any) => void;
    onBatch: () => void;
    language: string;
}

const ClipboardAddMenu: React.FC<ClipboardAddMenuProps> = ({
    onClose,
    onAdd,
    onBatch,
    language
}) => {

    const t = translations[language || 'zh'];

    return (
        <div className="absolute top-10 right-0 z-[140] w-[156px] no-drag">
            <div className="absolute left-0 right-0 top-[-14px] h-[18px]" />
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#09090B]/98 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                <div className="space-y-1">
                    <button
                        onClick={() => { onAdd('TEXT'); onClose(); }}
                        className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[14px] font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                    >
                        {t.modal_add_content}
                    </button>
                    <button
                        onClick={() => { onAdd('TAGS'); onClose(); }}
                        className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[14px] font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                    >
                        {t.modal_add_tags}
                    </button>
                    <button
                        onClick={() => { onAdd('DOCUMENT'); onClose(); }}
                        className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[14px] font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                    >
                        {t.modal_add_document}
                    </button>
                    <button
                        onClick={() => {
                            onBatch();
                            onClose();
                        }}
                        className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[14px] font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                    >
                        {t.modal_batch_add}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClipboardAddMenu;
