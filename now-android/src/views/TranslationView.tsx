import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ViewType, TranslationSettings } from '../types';
import { BackendService } from '../backend';
import { translations } from '../i18n';
import Icon from '../components/Icon';

interface TranslationViewProps {
    settings: TranslationSettings;
    language?: 'zh' | 'en';
    initialText?: string;
    requestTimestamp?: number;
    onNavigate: (view: ViewType) => void;
    onStartChat: (text: string) => void;
    hideSource?: boolean;
}

const TranslationView: React.FC<TranslationViewProps> = ({
    settings,
    language,
    initialText,
    requestTimestamp,
    onNavigate,
    onStartChat,
    hideSource
}) => {
    const [sourceText, setSourceText] = useState(initialText || '');
    const [translatedText, setTranslatedText] = useState('');
    const [loadingDirection, setLoadingDirection] = useState<'forward' | 'reverse' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [speakingState, setSpeakingState] = useState<'source' | 'target' | null>(null);
    const [activeToolbar, setActiveToolbar] = useState<'source' | 'target' | null>(null);
    const lastTimestampRef = useRef<number | undefined>(undefined);

    // Check if device is touch-enabled
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    const t = translations[language || 'zh'];

    const hasConfiguredTranslationApi = useMemo(() => {
        const provider = settings?.provider;
        if (provider === 'API') {
            return Boolean((settings?.apiKey || '').trim() && (settings?.endpoint || '').trim());
        }
        if (provider === 'BUILTIN') return true;
        if (provider === 'YOUDAO') {
            return Boolean((settings?.youdaoAppKey || '').trim() && (settings?.youdaoAppSecret || '').trim());
        }
        if (provider === 'GOOGLE') return true;
        return false;
    }, [settings]);

    const shouldOpenConfigModalForError = (msg: string) => {
        const text = (msg || '').toLowerCase();
        return (
            text.includes('api key') ||
            text.includes('未设置') ||
            text.includes('有道免费接口繁忙') ||
            text.includes('api 模式') ||
            text.includes('switch to "api') ||
            text.includes('请稍后再试')
        );
    };

    const detectInputMode = (text: string): 'zh' | 'en' | 'mixed' => {
        const hasZh = /[\u4e00-\u9fa5]/.test(text);
        const hasEn = /[a-zA-Z]/.test(text);
        if (hasZh && hasEn) return 'mixed';
        if (hasZh) return 'zh';
        return 'en';
    };

    const resolveTargetLocale = (text: string): 'zh' | 'en' => {
        const mode = detectInputMode(text);
        // Rules:
        // 1) Chinese -> English
        // 2) English -> Chinese
        // 3) Mixed Chinese-English -> Chinese
        return mode === 'zh' ? 'en' : 'zh';
    };

    const detectLanguage = (text: string): 'zh' | 'en' => {
        return detectInputMode(text) === 'zh' ? 'zh' : 'en';
    };

    const handleSpeak = (text: string) => {
        const synth = window.speechSynthesis;

        // 如果正在播放当前选中的文本，则停止
        if (speakingState) {
            synth.cancel();
            if ((speakingState === 'source' && text === sourceText) ||
                (speakingState === 'target' && text === translatedText)) {
                setSpeakingState(null);
                return;
            }
        }

        if (!text) return;

        const u = new SpeechSynthesisUtterance(text);
        const lang = detectLanguage(text);
        u.lang = lang === 'zh' ? 'zh-CN' : 'en-US';

        // 尝试选择更自然的语音（可选优化）
        const voices = synth.getVoices();
        const preferredVoice = voices.find(v => v.lang.startsWith(u.lang) && !v.name.includes('Desktop'));
        if (preferredVoice) u.voice = preferredVoice;

        u.onend = () => setSpeakingState(null);
        u.onerror = () => setSpeakingState(null);

        // 设置当前播放状态
        setSpeakingState(text === sourceText ? 'source' : 'target');
        synth.speak(u);
    };

    const executeTranslation = async (text: string, direction: 'forward' | 'reverse') => {
        if (!text || !text.trim()) {
            if (direction === 'forward') setTranslatedText('');
            else setSourceText('');
            return;
        }

        if (!hasConfiguredTranslationApi) {
            setShowConfigModal(true);
            return;
        }

        setLoadingDirection(direction);
        setError(null);
        if (direction === 'forward') setTranslatedText('');
        else setSourceText('');

        try {
            const backend = BackendService.getInstance();
            let prompt = '';

            const targetLocale = resolveTargetLocale(text);

            if (settings.provider === 'API') {
                if (targetLocale === 'zh') {
                    prompt = `Translate the following content into Simplified Chinese.
Rules:
- Output ONLY the translated result.
- Do NOT output any explanation.
- Do NOT include the original text.
- The final output must contain NO Latin letters (A-Z / a-z).
- Proper names or brands written in Latin letters must be converted to Chinese transliteration or common Chinese form.

Content:
${text}`;
                } else {
                    prompt = `Translate the following content into English.
Rules:
- Output ONLY the translated result.
- Do NOT output any explanation.
- Do NOT include the original text.

Content:
${text}`;
                }
            } else {
                prompt = text;
            }

            let accumulated = '';
            await backend.chatStream(
                settings,
                [{ role: 'user', content: prompt }],
                (chunk) => {
                    accumulated += chunk;
                    if (direction === 'forward') {
                        setTranslatedText(accumulated);
                    } else {
                        setSourceText(accumulated);
                    }
                },
                () => {
                    setLoadingDirection(null);
                },
                (err) => {
                    if (shouldOpenConfigModalForError(err)) {
                        setShowConfigModal(true);
                        setError(null);
                    } else {
                        setError(err);
                    }
                    setLoadingDirection(null);
                },
                { isTranslation: true, targetLang: targetLocale }
            );
        } catch (e: any) {
            const msg = e.message || t.trans_error;
            if (shouldOpenConfigModalForError(msg)) {
                setShowConfigModal(true);
                setError(null);
            } else {
                setError(msg);
            }
            setLoadingDirection(null);
        }
    };

    useEffect(() => {
        if (initialText && requestTimestamp && requestTimestamp !== lastTimestampRef.current) {
            // Check global persistence to avoid re-triggering on remounts
            const handled = localStorage.getItem('last_handled_trans_timestamp');
            if (handled && parseInt(handled) === requestTimestamp) {
                return;
            }

            lastTimestampRef.current = requestTimestamp;
            localStorage.setItem('last_handled_trans_timestamp', requestTimestamp.toString());

            setSourceText(initialText);
            executeTranslation(initialText, 'forward');
        }
        // Cleanup: stop speech when unmounting
        return () => {
            window.speechSynthesis.cancel();
        };
    }, [initialText, requestTimestamp]);

    const handleCopy = async (text: string) => {
        const backend = BackendService.getInstance();
        await backend.writeClipboard(text);
    };

    const handleReplace = async () => {
        if (!translatedText) return;
        try {
            const backend = BackendService.getInstance();
            await backend.pasteText(translatedText, true);
        } catch (e: any) {
            setError(e.message || t.trans_error);
        }
    };

    const handleSourceKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            executeTranslation(sourceText, 'forward');
        }
    };

    const handleTargetKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            executeTranslation(translatedText, 'reverse');
        }
    };

    return (
        <div className="h-full flex flex-col bg-[#09090B] text-[#71717B]">
            {/* Minimal header - just back button */}
            <header className="px-4 pt-3 pb-0 flex items-center drag-region z-20">
                <button
                    onClick={() => onNavigate(ViewType.CHAT)}
                    className="text-[#52525B] flex items-center text-[12px] font-medium hover:text-white/60 active:opacity-60 transition-all no-drag tracking-wider"
                >
                    <Icon name="chevron_left" className="!text-[14px]" size={14} />
                    <span>{t.back}</span>
                </button>
            </header>

                <main className="flex-1 overflow-y-auto px-4 pt-2 pb-6 flex flex-col gap-3 no-scrollbar mask-fade-bottom">
                    {/* Source section */}
                <div 
                    className="relative group flex-shrink-0"
                    onClick={() => setActiveToolbar(activeToolbar === 'source' ? null : 'source')}
                >
                        <div className="mask-fade-bottom rounded-2xl overflow-hidden">
                            <textarea
                                value={sourceText}
                                onChange={(e) => setSourceText(e.target.value)}
                                onKeyDown={handleSourceKeyDown}
                                placeholder={t.source_placeholder}
                                className="w-full bg-gradient-to-br from-[#121214] to-[#09090B] p-4 pb-12 rounded-2xl border border-white/[0.04] text-[14px] font-semibold tracking-wider text-[#A1A1AA] leading-relaxed min-h-[180px] whitespace-pre-wrap resize-none focus:outline-none transition-colors placeholder:text-[#3F3F46] no-scrollbar"
                            />
                        </div>
                        {/* Floating toolbar - show on click for mobile */}
                        <div className={`absolute bottom-2.5 right-3 flex items-center gap-1.5 transition-opacity ${activeToolbar === 'source' || !isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleSpeak(sourceText); }}
                                className={`p-1.5 rounded-lg transition-colors ${speakingState === 'source' ? 'text-white/80' : 'text-[#52525B] hover:text-white/60 hover:bg-white/5'}`}
                                title="朗读"
                            >
                                <Icon name={speakingState === 'source' ? 'volume_up' : 'volume_down'} className="!text-[14px]" size={14} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleCopy(sourceText); }}
                                className="p-1.5 rounded-lg text-[#52525B] hover:text-white/60 hover:bg-white/5 transition-colors"
                                title={t.copy}
                            >
                                <Icon name="content_copy" className="!text-[13px]" size={13} />
                            </button>
                        </div>
                        {/* Loading overlay */}
                        {(loadingDirection === 'reverse' && !sourceText || error) && (
                            <div className="absolute inset-0 bg-[#09090B]/80 rounded-2xl flex items-center justify-center z-10 pointer-events-none">
                                {error ? (
                                    <div className="text-white/40 flex items-center gap-2 text-[13px]">
                                        <Icon name="error" size={14} />
                                        <span>{error}</span>
                                    </div>
                                ) : (
                                    <div className="flex gap-1.5 opacity-0">...</div>
                                )}
                            </div>
                        )}
                        {loadingDirection === 'reverse' && sourceText && (
                            <div className="absolute bottom-3 right-3 flex gap-1 z-10 opacity-0">...</div>
                        )}
                </div>



                {/* Target section */}
                <div 
                    className="relative group flex-1 min-h-0"
                    onClick={() => translatedText && setActiveToolbar(activeToolbar === 'target' ? null : 'target')}
                >
                    <div className="h-full mask-fade-bottom rounded-2xl overflow-hidden">
                        <textarea
                            value={translatedText}
                            onChange={(e) => setTranslatedText(e.target.value)}
                            onKeyDown={handleTargetKeyDown}
                            placeholder={t.trans_placeholder}
                            className="w-full h-full bg-gradient-to-br from-[#121214] to-[#09090B] p-4 pb-12 rounded-2xl border border-white/[0.04] text-[14px] font-semibold tracking-wider text-[#A1A1AA] leading-relaxed min-h-[220px] whitespace-pre-wrap resize-none focus:outline-none transition-colors placeholder:text-[#3F3F46] no-scrollbar"
                        />
                    </div>
                    {/* Floating toolbar - show on click for mobile */}
                    {translatedText && (
                        <div className={`absolute bottom-2.5 right-3 flex items-center gap-1.5 transition-opacity ${activeToolbar === 'target' || !isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleSpeak(translatedText); }}
                                className={`p-1.5 rounded-lg transition-colors ${speakingState === 'target' ? 'text-white/80' : 'text-[#52525B] hover:text-white/60 hover:bg-white/5'}`}
                                title="朗读"
                            >
                                <Icon name={speakingState === 'target' ? 'volume_up' : 'volume_down'} className="!text-[14px]" size={14} />
                            </button>
                            <div className="w-[1px] h-3 bg-white/[0.06]"></div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleCopy(translatedText); }}
                                className="p-1.5 rounded-lg text-[#52525B] hover:text-white/60 hover:bg-white/5 transition-colors"
                                title={t.copy}
                            >
                                <Icon name="content_copy" className="!text-[13px]" size={13} />
                            </button>
                            <div className="w-[1px] h-3 bg-white/[0.06]"></div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleReplace(); }}
                                className="p-1.5 rounded-lg text-[#52525B] hover:text-[#22C55E] hover:bg-[#22C55E]/10 transition-colors"
                                title={t.replace_desc}
                            >
                                <Icon name="find_replace" className="!text-[15px]" size={15} />
                            </button>
                        </div>
                    )}
                    {/* Loading overlay */}
                    {(loadingDirection === 'forward' && !translatedText || error) && (
                        <div className="absolute inset-0 bg-[#09090B]/80 rounded-2xl flex items-center justify-center z-10 pointer-events-none">
                            {loadingDirection === 'forward' ? (
                                <div className="flex gap-1.5 opacity-0">...</div>
                            ) : (
                                <div className="text-white/40 flex items-center gap-2 text-[13px]">
                                    <Icon name="error" size={14} />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>
                    )}
                    {loadingDirection === 'forward' && translatedText && (
                        <div className="absolute bottom-3 right-3 flex gap-1 z-10 opacity-0">...</div>
                    )}
                </div>
            </main>

            {showConfigModal && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowConfigModal(false)}
                >
                    <div
                        className="w-[360px] rounded-2xl border border-white/10 bg-[#09090B] p-6 shadow-2xl shadow-black/50"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-2">
                            <Icon name="settings" size={18} className="text-white/70" />
                            <h3 className="text-[16px] font-bold text-white">
                                {language === 'en' ? 'Configure Translation API' : '请先配置翻译 API'}
                            </h3>
                        </div>
                        <p className="mt-3 text-[14px] text-white/75 leading-relaxed">
                            {language === 'en'
                                ? 'Translation needs an available API configuration. Please configure it in Settings first.'
                                : '翻译功能需要可用的 API 配置，请先前往设置完成配置。'}
                        </p>
                        <div className="mt-5 flex gap-3">
                            <button
                                onClick={() => setShowConfigModal(false)}
                                className="flex-1 rounded-xl bg-white/5 px-4 py-2.5 text-[13px] font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={() => {
                                    setShowConfigModal(false);
                                    onNavigate(ViewType.SETTINGS);
                                }}
                                className="flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-white/20 transition-colors"
                            >
                                {language === 'en' ? 'Open Settings' : '前往设置'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranslationView;
