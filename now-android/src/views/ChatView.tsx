import React, { useState, useEffect, useRef } from 'react';
import { ViewType, TranslationSettings } from '../types';
import { BackendService } from '../backend';
import { translations } from '../i18n';
import Icon from '../components/Icon';
import { MessageItem } from './chat/MessageItem';
import {
    DEFAULT_AGENTS,
    PACKAGED_CUSTOM_AGENTS,
    PACKAGED_PINNED_AGENT_IDS,
} from './chat/agents';
import { getMessageText } from './chat/messageUtils';
import { applyPromptToLastUserMessage, buildPromptWithQuote } from './chat/promptBuilder';
import type { Agent, ChatSession, Message, MessageContent } from './chat/types';

interface ChatViewProps {
    settings: TranslationSettings;
    language?: 'zh' | 'en';
    initialText?: string;
    initialType?: string; // Entry type: SELECTION, QUICK_CHAT, CUSTOM
    actionId?: string;
    requestTimestamp?: number;
    onNavigate: (view: ViewType) => void;
    onNavigateToSettings: (tab: 'GENERAL' | 'SHORTCUTS' | 'MODEL') => void;
    onApplySelection?: (text: string) => void;
    currentSelection?: string;
    hideBack?: boolean;
    isActive?: boolean;
}

const AGENT_ICON_OPTIONS = [
    'smart_toy',
    'chat_bubble',
    'translate',
    'code',
    'edit_note',
    'bolt',
    'search',
    'trending_up',
    'settings',
    'file',
    'favorite',
    'alarm'
];

const ChatView: React.FC<ChatViewProps> = ({ settings, language, initialText, initialType, actionId, requestTimestamp, currentSelection, onNavigate, onNavigateToSettings, onApplySelection, hideBack = false, isActive = false }) => {
    // Generate specific ID
    const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string>('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [currentAgentId, setCurrentAgentId] = useState('default');
    const [isAgentsOpen, setIsAgentsOpen] = useState(false);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    // Check if device is touch-enabled
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    // Custom Agents State
    const [customAgents, setCustomAgents] = useState<Agent[]>([]);
    const [isEditingAgent, setIsEditingAgent] = useState(false);
    const [editingAgent, setEditingAgent] = useState<Partial<Agent>>({});
    const [pendingImages, setPendingImages] = useState<string[]>([]); // Pending images in Base64 format
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(256);
    const [isCompactLayout, setIsCompactLayout] = useState(() => window.innerWidth < 960);
    const isResizingRef = useRef(false);

    const startResizing = (e: React.MouseEvent) => {
        if (isCompactLayout) return;
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    useEffect(() => {
        const onResize = () => {
            setIsCompactLayout(window.innerWidth < 960);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;
            const newWidth = Math.min(Math.max(200, e.clientX), 500);
            setSidebarWidth(newWidth);
        };

        const handleMouseUp = () => {
            if (isResizingRef.current) {
                isResizingRef.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const lastTimestampRef = useRef<number | undefined>(undefined);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const sendLockRef = useRef(false);
    const chainQuoteOnDoneRef = useRef(false);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [contextQuote, setContextQuote] = useState<string | null>(null);
    const [isQuotePinned, setIsQuotePinned] = useState(false);
    const isAutoPasteRef = useRef(false);

    const [hiddenAgents, setHiddenAgents] = useState<string[]>([]);
    const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>([]);
    const [activeQuoteAgentId, setActiveQuoteAgentId] = useState<string | null>(null);

    const t = translations[language || 'zh'];

    const focusInputWithRetry = React.useCallback((retries = 6) => {
        if (!isActive) return;
        const input = inputRef.current;
        if (input) {
            input.focus({ preventScroll: true });
            const len = input.value.length;
            input.setSelectionRange(len, len);
            return;
        }
        if (retries > 0) {
            window.setTimeout(() => focusInputWithRetry(retries - 1), 50);
        }
    }, [isActive]);

    const hasConfiguredTranslationApi = React.useMemo(() => {
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
            text.includes('not configured') ||
            text.includes('api 未配置') ||
            text.includes('未配置') ||
            text.includes('switch to "api') ||
            text.includes('switch to api') ||
            text.includes('try again later') ||
            text.includes('请稍后再试')
        );
    };

    // Load sessions from localStorage
    useEffect(() => {
        try {
            const savedSessions = localStorage.getItem('chat_sessions');
            const legacyHistory = localStorage.getItem('chat_history');

            let loadedSessions: ChatSession[] = [];

            if (savedSessions) {
                loadedSessions = JSON.parse(savedSessions);
            } else if (legacyHistory) {
                // Migration: Convert legacy history to a session
                const parsedLegacy = JSON.parse(legacyHistory);
                if (parsedLegacy.length > 0) {
                    const firstMsg = parsedLegacy.find((m: Message) => m.role === 'user')?.content;
                    const title = typeof firstMsg === 'string' ? firstMsg.slice(0, 20) : t.history_title;
                    loadedSessions.push({
                        id: generateId(),
                        title: title || t.history_title,
                        timestamp: Date.now(),
                        messages: parsedLegacy
                    });
                }
            }

            // Ensure at least one session exists
            if (loadedSessions.length === 0) {
                const newSession = {
                    id: generateId(),
                    title: t.new_chat,
                    timestamp: Date.now(),
                    messages: []
                };
                loadedSessions.push(newSession);
            }

            // Sort by timestamp desc
            loadedSessions.sort((a, b) => b.timestamp - a.timestamp);

            setSessions(loadedSessions);
            const initialSession = loadedSessions[0];
            setCurrentSessionId(initialSession.id);
            setMessages(initialSession.messages);
            setCurrentAgentId(initialSession.agentId || 'default');

            // Clear legacy key after migration
            if (legacyHistory) localStorage.removeItem('chat_history');

        } catch (e) {
            console.error('Failed to load chat sessions:', e);
            // Fallback
            const newId = generateId();
            setSessions([{ id: newId, title: t.new_chat, timestamp: Date.now(), messages: [] }]);
            setCurrentSessionId(newId);
        }
    }, []);

    // Load custom agents and hidden agents
    useEffect(() => {
        try {
            const savedAgents = localStorage.getItem('custom_agents');
            const parsedAgents: Agent[] = savedAgents ? JSON.parse(savedAgents) : [];
            let mergedAgents = [...parsedAgents];

            // Always align packaged agents to the latest bundled prompt/icon/name.
            PACKAGED_CUSTOM_AGENTS.forEach((packaged) => {
                const idx = mergedAgents.findIndex((a) => a.id === packaged.id);
                if (idx >= 0) mergedAgents[idx] = packaged;
                else mergedAgents.push(packaged);
            });

            // Remove legacy duplicated "解释" agent from old builds.
            const legacyExplainPrompt = '你是一个解释智能体\n需通俗易懂解释概念';
            mergedAgents = mergedAgents.filter(
                (a) =>
                    !(
                        a.id !== 'explain' &&
                        a.name === '解释' &&
                        (a.systemPrompt || '').trim() === legacyExplainPrompt
                    )
            );

            // For packaged names, keep only packaged ids to avoid duplicate visible entries.
            const packagedNameToId = new Map(
                PACKAGED_CUSTOM_AGENTS.map((a) => [a.name, a.id])
            );
            mergedAgents = mergedAgents.filter((a) => {
                const packagedId = packagedNameToId.get(a.name);
                if (!packagedId) return true;
                return a.id === packagedId;
            });

            setCustomAgents(mergedAgents);
            localStorage.setItem('custom_agents', JSON.stringify(mergedAgents));

            const savedHidden = localStorage.getItem('hidden_agents');
            const parsedHidden: string[] = savedHidden ? JSON.parse(savedHidden) : [];
            setHiddenAgents(parsedHidden);
            localStorage.setItem('hidden_agents', JSON.stringify(parsedHidden));

            const savedPinnedAgents = localStorage.getItem('pinned_agents');
            const parsedPinned: string[] = savedPinnedAgents ? JSON.parse(savedPinnedAgents) : [];
            const hasPinnedPreference = savedPinnedAgents !== null;
            const mergedPinned = hasPinnedPreference
                ? [...parsedPinned]
                : [...PACKAGED_PINNED_AGENT_IDS];
            const uniquePinned = mergedPinned.filter(
                (id, index, arr) => arr.indexOf(id) === index && !parsedHidden.includes(id)
            );
            setPinnedAgentIds(uniquePinned);
            localStorage.setItem('pinned_agents', JSON.stringify(uniquePinned));
        } catch (e) {
            console.error('Failed to load agents data:', e);
        }
    }, []);

    const allAgents = React.useMemo(() => {
        // Start with defaults
        let list = [...DEFAULT_AGENTS];
        // Update with customs (override or add)
        customAgents.forEach(c => {
            const idx = list.findIndex(a => a.id === c.id);
            if (idx !== -1) list[idx] = c;
            else list.push(c);
        });
        const visible = list.filter(a => !hiddenAgents.includes(a.id));
        return visible.sort((a, b) => {
            const aPinned = pinnedAgentIds.includes(a.id) ? 1 : 0;
            const bPinned = pinnedAgentIds.includes(b.id) ? 1 : 0;
            return bPinned - aPinned;
        });
    }, [customAgents, hiddenAgents, pinnedAgentIds]);

    // Save custom agents
    const saveCustomAgent = (agent: Agent) => {
        setCustomAgents(prev => {
            const exists = prev.find(a => a.id === agent.id);
            let updated;
            if (exists) {
                updated = prev.map(a => a.id === agent.id ? agent : a);
            } else {
                updated = [...prev, agent];
            }
            localStorage.setItem('custom_agents', JSON.stringify(updated));
            return updated;
        });
        setIsEditingAgent(false);
        setEditingAgent({});
    };

    const handleDeleteAgent = (e: React.MouseEvent, agentId: string) => {
        e.preventDefault();
        e.stopPropagation();

        const fallbackAgentId = allAgents.find(a => a.id !== agentId)?.id ?? 'default';

        // Add to hidden agents
        setHiddenAgents(prev => {
            const updated = prev.includes(agentId) ? prev : [...prev, agentId];
            localStorage.setItem('hidden_agents', JSON.stringify(updated));
            return updated;
        });

        // Also remove from custom agents if it exists there (to keep data clean, optional)
        setCustomAgents(prev => {
            const updated = prev.filter(a => a.id !== agentId);
            localStorage.setItem('custom_agents', JSON.stringify(updated));
            return updated;
        });
        setPinnedAgentIds(prev => {
            const updated = prev.filter(id => id !== agentId);
            localStorage.setItem('pinned_agents', JSON.stringify(updated));
            return updated;
        });

        if (currentAgentId === agentId && fallbackAgentId !== agentId) {
            setCurrentAgentId(fallbackAgentId);
        }
    };

    const handleTogglePinAgent = (e: React.MouseEvent, agentId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setPinnedAgentIds(prev => {
            const updated = prev.includes(agentId)
                ? prev.filter(id => id !== agentId)
                : [agentId, ...prev.filter(id => id !== agentId)];
            localStorage.setItem('pinned_agents', JSON.stringify(updated));
            return updated;
        });
    };

    // Save sessions to localStorage whenever messages or sessions change
    useEffect(() => {
        if (!currentSessionId) return;

        setSessions(prev => {
            const index = prev.findIndex(s => s.id === currentSessionId);
            if (index === -1) return prev;

            const currentSession = prev[index];
            // If messages didn't change and agent didn't change, no need to update session list
            if (currentSession.messages === messages && currentSession.agentId === currentAgentId) {
                return prev;
            }

            const updatedSession = { ...currentSession, messages: messages, agentId: currentAgentId };

            // Auto-update title if it's "New Chat" and we have messages
            if (updatedSession.title === t.new_chat && messages.length > 0) {
                const firstUserMsg = messages.find(m => m.role === 'user');
                if (firstUserMsg) {
                    const text = getMessageText(firstUserMsg, t.image_placeholder);
                    if (text) {
                        updatedSession.title = text.slice(0, 20);
                    }
                }
            }

            const newSessions = [...prev];
            newSessions[index] = updatedSession;

            // Persist immediately to avoid loss on unmount
            localStorage.setItem('chat_sessions', JSON.stringify(newSessions));
            return newSessions;
        });
    }, [messages, currentAgentId, currentSessionId]); // Added currentSessionId to deps

    // Handle switching sessions
    const handleSwitchSession = (sessionId: string) => {
        if (isLoading || sendLockRef.current) return;
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setCurrentSessionId(sessionId);
            setMessages(session.messages);
            setPendingImages([]); // Clear pending images when switching
            setIsHistoryOpen(false);
            setCurrentAgentId(session.agentId || 'default');
        }
    };

    // Handle creating new session
    const handleNewChat = () => {
        if (isLoading || sendLockRef.current) return;
        const agent = allAgents.find(a => a.id === currentAgentId);
        const initialMessages: Message[] = [];

        if (agent && agent.systemPrompt) {
            initialMessages.push({
                role: 'system',
                content: agent.systemPrompt
            });
        }

        const newSession: ChatSession = {
            id: generateId(),
            title: t.new_chat,
            timestamp: Date.now(),
            messages: initialMessages,
            agentId: currentAgentId
        };

        const updatedSessions = [newSession, ...sessions];
        setSessions(updatedSessions);
        setCurrentSessionId(newSession.id);
        setMessages(initialMessages);
        setPendingImages([]);
        setIsHistoryOpen(false);

        // Immediate persistence for new chat
        localStorage.setItem('chat_sessions', JSON.stringify(updatedSessions));
    };

    // Handle removing a single session
    const handleRemoveSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation(); // Prevent triggering switchSession

        setSessions(prev => {
            const newSessions = prev.filter(s => s.id !== sessionId);

            // If we deleted the current session, switch to the first available one
            if (sessionId === currentSessionId && newSessions.length > 0) {
                setCurrentSessionId(newSessions[0].id);
                setMessages(newSessions[0].messages);
            } else if (newSessions.length === 0) {
                // If deleted all, create a new one
                const newSession = {
                    id: generateId(),
                    title: t.new_chat,
                    timestamp: Date.now(),
                    messages: []
                };
                newSessions.push(newSession);
                setCurrentSessionId(newSession.id);
                setMessages([]);
            }

            // Persist
            const sessionsToSave = newSessions.map(s => ({
                ...s,
                messages: s.messages // Save all messages including images
            }));
            localStorage.setItem('chat_sessions', JSON.stringify(sessionsToSave));

            return newSessions;
        });
    };

    // Handle deleting all history
    const handleClearAll = () => {
        localStorage.removeItem('chat_sessions');
        localStorage.removeItem('chat_history');

        const newSession = {
            id: generateId(),
            title: t.new_chat,
            timestamp: Date.now(),
            messages: []
        };
        setSessions([newSession]);
        setCurrentSessionId(newSession.id);
        setMessages([]);
        setShowClearConfirm(false);
        setIsHistoryOpen(false);
    };

    const handleScroll = () => {
        if (!scrollContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        // Consider near-bottom as within 30px
        const atBottom = scrollHeight - scrollTop - clientHeight < 30;
        setIsAtBottom(atBottom);
    };

    const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
        const container = scrollContainerRef.current;
        if (!container) return;

        if (behavior === 'smooth') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        } else {
            container.scrollTop = container.scrollHeight;
        }
    };

    // Auto-scroll while new messages are appended
    React.useLayoutEffect(() => {
        const lastMsg = messages[messages.length - 1];
        if (isAtBottom || (lastMsg && lastMsg.role === 'user')) {
            scrollToBottom();
        }
    }, [messages]);

    // Smooth scroll once loading completes
    React.useEffect(() => {
        if (!isLoading) {
            scrollToBottom('smooth');
        }
    }, [isLoading, requestTimestamp]);

    useEffect(() => {
        // Only trigger if we have a valid new timestamp that is different from the last handled one
        if (requestTimestamp && requestTimestamp !== lastTimestampRef.current) {
            if (isLoading || sendLockRef.current) {
                return;
            }
            // Check global persistence to avoid re-triggering on remounts
            const handled = localStorage.getItem('last_handled_timestamp');
            if (handled && parseInt(handled) === requestTimestamp) {
                // Already handled in a previous instance
                return;
            }

            lastTimestampRef.current = requestTimestamp;
            localStorage.setItem('last_handled_timestamp', requestTimestamp.toString());

            // For external requests (shortcuts), we usually want a FRESH context.
            // So we create a new session automatically.
            const newSession: ChatSession = {
                id: generateId(),
                title: initialType === 'TRANSLATE' ? t.trans_title : t.new_chat, // Use context as title
                timestamp: Date.now(),
                messages: []
            };

            setSessions(prev => [newSession, ...prev]);
            setCurrentSessionId(newSession.id);
            setMessages([]);
            setPendingImages([]);
            setContextQuote(null);

            if (initialText) {
                // If it is Quick Chat (CHAT type), populate quote instead of input
                if (initialType === 'CHAT') {
                    setContextQuote(initialText);
                    setInputText('');
                } else {
                    console.log('Auto-sending initial text:', initialText);
                    handleSend(initialText, actionId);
                }
            }

            // Shortcut-triggered entry should allow typing immediately.
            window.setTimeout(() => focusInputWithRetry(), 0);
        }
    }, [requestTimestamp, isLoading, focusInputWithRetry]); // Block shortcut-triggered new chats while current chat is running

    useEffect(() => {
        if (!isActive) return;
        const timer = window.setTimeout(() => focusInputWithRetry(), 30);
        return () => window.clearTimeout(timer);
    }, [isActive, requestTimestamp, focusInputWithRetry]);

    // 閻庡湱鍋炲鍌炲籍閼哥數顩?
    useEffect(() => {
        if (currentSelection && currentSelection.trim()) {
            setContextQuote(currentSelection);
        }
    }, [currentSelection]);

    const handleQuoteSelection = React.useCallback((text: string) => {
        const trimmed = (text || '').trim();
        if (!trimmed) return;
        setContextQuote(trimmed);
        focusInputWithRetry();
    }, [focusInputWithRetry]);

    const fixedAgents = React.useMemo(
        () => pinnedAgentIds
            .map(id => allAgents.find(a => a.id === id))
            .filter((a): a is Agent => Boolean(a)),
        [allAgents, pinnedAgentIds]
    );

    useEffect(() => {
        if (!contextQuote) {
            setActiveQuoteAgentId(null);
        }
    }, [contextQuote]);

    const getFixedAgentActionMeta = React.useCallback((agent: Agent) => {
        const isZh = (language || 'zh') === 'zh';
        const fallbackIcon = agent?.id === 'translate'
            ? 'language'
            : agent?.id === 'default'
                ? 'info'
                : 'smart_toy';
        const icon = (agent?.icon || '').trim() || fallbackIcon;
        const name = (agent?.name || '').trim();
        return {
            icon,
            label: name || (
                agent?.id === 'translate'
                    ? (isZh ? '翻译' : 'Translate')
                    : agent?.id === 'default'
                        ? (isZh ? '解释' : 'Explain')
                        : (isZh ? '处理' : 'Action')
            )
        };
    }, [language]);

    const handleFixedAgentQuoteAction = (agent: Agent) => {
        if (!contextQuote || isLoading || sendLockRef.current) return;
        setActiveQuoteAgentId(agent.id);
        if (agent?.id) {
            setCurrentAgentId(agent.id);
        }
        const fallbackPrompt = agent?.id === 'translate'
            ? (language === 'en' ? 'Translate this quoted text. Output translation only.' : '请翻译这段引用文本，仅输出翻译结果。')
            : (language === 'en' ? 'Explain the quoted content clearly and briefly.' : '请解释这段引用的含义和关键点。');
        const actionPrompt = (agent?.systemPrompt || '').trim() || fallbackPrompt;
        chainQuoteOnDoneRef.current = true;
        handleSend(actionPrompt, undefined, { agentIdOverride: agent.id });
    };

    // Convert file to Base64
    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    // Compress image using canvas (default: 1024px, quality 0.8)
    const compressImage = (base64: string, maxSize = 1024, quality = 0.8): Promise<string> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;

                // Resize while keeping aspect ratio
                if (width > height && width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                } else if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);

                // Export as JPEG
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = base64;
        });
    };

    // Handle paste image
    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const newImages: string[] = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    const base64 = await fileToBase64(file);
                    const compressed = await compressImage(base64);
                    newImages.push(compressed);
                }
            }
        }
        if (newImages.length > 0) {
            setPendingImages(prev => [...prev, ...newImages].slice(0, 5)); // 5
        }
    };

    // Handle drag-and-drop image
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const newImages: string[] = [];
            for (let i = 0; i < Math.min(files.length, 5); i++) {
                const file = files[i];
                if (file.type.startsWith('image/')) {
                    const base64 = await fileToBase64(file);
                    const compressed = await compressImage(base64);
                    newImages.push(compressed);
                }
            }
            if (newImages.length > 0) {
                setPendingImages(prev => [...prev, ...newImages].slice(0, 5)); // 5
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // Handle selecting local image files
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const newImages: string[] = [];
            for (let i = 0; i < Math.min(files.length, 5); i++) {
                const file = files[i];
                if (file.type.startsWith('image/')) {
                    const base64 = await fileToBase64(file);
                    const compressed = await compressImage(base64);
                    newImages.push(compressed);
                }
            }
            if (newImages.length > 0) {
                setPendingImages(prev => [...prev, ...newImages].slice(0, 5)); // 5
            }
        }
        // Clear file input value so selecting the same file works again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSend = async (
        text: string,
        currentActionId?: string,
        options?: { agentIdOverride?: string }
    ) => {
        if (isLoading || sendLockRef.current) return;
        // Ignore empty sends when no image and no quote context
        if (!text.trim() && pendingImages.length === 0 && !contextQuote) return;
        if (!hasConfiguredTranslationApi) {
            setShowConfigModal(true);
            return;
        }

        const actionForSend = currentActionId
            ? settings.customActions.find(a => a.id === currentActionId)
            : undefined;
        const actionPromptText = (actionForSend?.prompt || '').trim();
        const actionDisplayTitle = (actionForSend?.name || '').trim();
        const shouldAutoQuoteSelection =
            Boolean(currentActionId) &&
            Boolean(initialText) &&
            text.trim() === (initialText || '').trim() &&
            Boolean(actionPromptText);

        const effectiveQuote = shouldAutoQuoteSelection
            ? ((contextQuote?.trim() || text.trim()))
            : (contextQuote?.trim() || '');
        const effectiveInputText = shouldAutoQuoteSelection
            ? (actionDisplayTitle || actionPromptText || text)
            : text;
        const sourceTextForAction = shouldAutoQuoteSelection ? (initialText || text) : text;

        // Build user message content
        let userContent: string | MessageContent[];
        let displayContent = effectiveInputText;

        if (pendingImages.length > 0) {
            // Mixed message parts: text + image URLs
            const contentParts: MessageContent[] = [];
            if (effectiveInputText.trim()) {
                contentParts.push({ type: 'text', text: effectiveInputText });
            }
            // Append images
            pendingImages.forEach(img => {
                contentParts.push({
                    type: 'image_url',
                    image_url: { url: img }
                });
            });
            userContent = contentParts;
            displayContent = effectiveInputText || t.image_placeholder;
        } else {
            userContent = effectiveInputText;
        }

        const userMsg: Message = {
            role: 'user',
            content: userContent,
            imagePreview: pendingImages[0] || undefined,
            quotedContext: effectiveQuote || undefined
        };

        // Prepare messages with current agent's context
        let updatedMessages = [...messages];
        const effectiveAgentId = options?.agentIdOverride || currentAgentId;
        const currentAgent = allAgents.find(a => a.id === effectiveAgentId);

        // Dynamically update system prompt if not a custom action or specific mode
        if (!currentActionId && initialType !== 'TRANSLATE' && initialType !== 'CHAT') {
            const systemPrompt = currentAgent?.systemPrompt;
            const hasSystemMsg = updatedMessages.length > 0 && updatedMessages[0].role === 'system';

            if (hasSystemMsg) {
                if (systemPrompt) {
                    // Replace existing system prompt
                    updatedMessages[0] = { ...updatedMessages[0], content: systemPrompt };
                } else {
                    // Remove system prompt if agent has none
                    updatedMessages.shift();
                }
            } else if (systemPrompt) {
                // Add new system prompt
                updatedMessages.unshift({ role: 'system', content: systemPrompt });
            }
        }

        const newMessagesState = [...updatedMessages, userMsg];
        sendLockRef.current = true;
        setMessages(newMessagesState);
        setInputText('');
        setPendingImages([]);
        setIsLoading(true);
        setTimeout(() => scrollToBottom(), 0);

        // Insert assistant placeholder bubble
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        try {
            const backend = BackendService.getInstance();
            let prompt = text;

            // Custom action prompt override
            if (currentActionId) {
                const action = actionForSend;
                if (action && action.prompt) {
                    const textPlaceholderPattern = /\{\{\s*text\s*\}\}/gi;
                    if (textPlaceholderPattern.test(action.prompt)) {
                        prompt = action.prompt.replace(textPlaceholderPattern, sourceTextForAction);
                    } else {
                        const trimmedPrompt = action.prompt.trim();
                        prompt = shouldAutoQuoteSelection
                            ? (trimmedPrompt || sourceTextForAction)
                            : (trimmedPrompt ? `${trimmedPrompt}\n\n${sourceTextForAction}` : sourceTextForAction);
                    }
                }
            }
            // Preset behavior for initial quick actions
            else if (text === initialText && pendingImages.length === 0) {
                if (initialType === 'TRANSLATE') {
                    prompt = `请将下面内容翻译成英文，要求：
1. 保留原意，不要遗漏信息；
2. 语气自然、简洁；
3. 只输出翻译结果，不要加解释。

原文：
${text}`;
                } else if (initialType === 'CHAT') {
                    prompt = `请基于以下内容进行回复：\n\n${text}`;
                } else if (initialType === 'MAGIC_WAND') {
                    prompt = `You are a text optimization assistant. Your task is to polish and optimize the user's input to be more professional, clear, and concise. 
IMPORTANT: Direct output the optimized text ONLY. Do NOT add any explanations, quotes, or conversational filler.
Input: ${text}`;
                }
            }

            const finalPrompt = buildPromptWithQuote(prompt, effectiveQuote || null);
            if (contextQuote && !isQuotePinned) {
                setContextQuote(null); // Clear after use unless pinned
            }

            // Build API messages
            const apiMessages = newMessagesState.map(m => {
                if (typeof m.content === 'string') {
                    return { role: m.role, content: m.content };
                }
                return { role: m.role, content: m.content };
            });

            const finalApiMessages = applyPromptToLastUserMessage(apiMessages, finalPrompt, effectiveInputText);

            // Streaming state refs
            let streamContent = '';
            let rafId: number | null = null;
            const chainQuoteOnDone = chainQuoteOnDoneRef.current;
            chainQuoteOnDoneRef.current = false;

            // Throttle UI updates via requestAnimationFrame
            const flushContent = () => {
                const currentContent = streamContent;
                setMessages(prev => {
                    const updated = [...prev];
                    const lastIndex = updated.length - 1;
                    if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
                        updated[lastIndex] = {
                            ...updated[lastIndex],
                            content: currentContent
                        };
                    }
                    return updated;
                });
                rafId = null;
            };

            // Stream from API
            await backend.chatStream(
                settings,
                finalApiMessages,
                // onChunk: buffer then flush in RAF
                (chunk) => {
                    streamContent += chunk;
                    if (!rafId) {
                        rafId = requestAnimationFrame(flushContent);
                    }
                },
                // onDone
                async () => {
                    // Flush any remaining chunk at completion
                    if (rafId) cancelAnimationFrame(rafId);
                    flushContent();
                    setIsLoading(false);
                    if (chainQuoteOnDone) {
                        const trimmed = (streamContent || '').trim();
                        if (trimmed) {
                            setContextQuote(trimmed);
                            setIsQuotePinned(true);
                        }
                    }
                    if (isAutoPasteRef.current) {
                        console.log('[ChatView] Auto-pasting result...');
                        try {
                            // 1. Write to Clipboard
                            await backend.writeClipboard(streamContent);

                            // 2. Hide Window
                            const win = await import('@tauri-apps/api/window').then(m => m.getCurrentWindow());
                            await win.hide();

                            // 3. Simulate Paste (wait for window hide animation)
                            setTimeout(async () => {
                                const { invoke } = await import('@tauri-apps/api/core');
                                await invoke('simulate_paste');
                            }, 300);

                        } catch (e) {
                            console.error('Auto paste failed:', e);
                        }
                        isAutoPasteRef.current = false;
                    }
                },
                // onError
                (error) => {
                    chainQuoteOnDoneRef.current = false;
                    if (shouldOpenConfigModalForError(error)) {
                        setMessages(prev => {
                            const updated = [...prev];
                            const lastIndex = updated.length - 1;
                            if (lastIndex >= 0 && updated[lastIndex].role === 'assistant' && !getMessageText(updated[lastIndex], t.image_placeholder)) {
                                updated.pop();
                            }
                            return updated;
                        });
                        setShowConfigModal(true);
                        setIsLoading(false);
                        return;
                    }
                    setMessages(prev => {
                        const updated = [...prev];
                        const lastIndex = updated.length - 1;
                        if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
                            updated[lastIndex] = {
                                ...updated[lastIndex],
                                content: `Error: ${error}`
                            };
                        }
                        return updated;
                    });
                    setIsLoading(false);
                },
                { isTranslation: initialType === 'TRANSLATE' }
            );
        } catch (error) {
            chainQuoteOnDoneRef.current = false;
            const message = error instanceof Error ? error.message : String(error || '');
            if (shouldOpenConfigModalForError(message)) {
                setMessages(prev => {
                    const updated = [...prev];
                    const lastMsg = updated[updated.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant' && !getMessageText(lastMsg, t.image_placeholder)) {
                        updated.pop();
                    }
                    return updated;
                });
                setShowConfigModal(true);
                setIsLoading(false);
                return;
            }
            setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    // Replace assistant placeholder with error text
                    lastMsg.content = t.api_error;
                }
                return updated;
            });
            setIsLoading(false);
        } finally {
            sendLockRef.current = false;
        }
    };

    // Download image helper
    const downloadImage = async (base64: string) => {
        try {
            const filename = `image_${Date.now()}.png`;
            await BackendService.getInstance().saveImage(base64, filename);
        } catch (e) {
            console.error('Download failed:', e);
            // Fallback for browser testing
            const link = document.createElement('a');
            link.href = base64;
            link.download = `image_${Date.now()}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    return (
        <div
            className="h-full min-w-0 flex flex-row bg-[#09090B] relative"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            {isHistoryOpen && isCompactLayout && (
                <div
                    className="absolute inset-0 z-30 bg-black/55"
                    onClick={() => setIsHistoryOpen(false)}
                />
            )}
            {isHistoryOpen && (
                    <div
                        style={isCompactLayout ? undefined : { width: `${sidebarWidth}px` }}
                        className={`h-full bg-[#09090B] border-r border-white/5 flex flex-col animate-in slide-in-from-left duration-200 ${
                            isCompactLayout
                                ? 'absolute left-0 top-0 z-40 w-[82vw] max-w-[320px]'
                                : 'relative'
                        }`}
                    >

                        <div className="flex-1 overflow-y-auto p-2">
                            {/* Session List */}
                            {sessions.map(session => (
                                <div
                                    key={session.id}
                                    onClick={() => {
                                        if (activeSessionId === session.id) {
                                            setActiveSessionId(null);
                                        } else {
                                            handleSwitchSession(session.id);
                                            setActiveSessionId(null);
                                        }
                                    }}
                                    className={`p-3 rounded-xl mb-1 flex items-center gap-3 cursor-pointer transition-colors group ${currentSessionId === session.id
                                        ? 'bg-[#1C1C1E] text-white'
                                        : 'hover:bg-white/5 text-white/60 hover:text-white'
                                        }`}
                                >

                                    <div className="flex-1 truncate text-[14px]">{session.title}</div>

                                    {/* Delete Button - show on click for mobile */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveSession(e, session.id);
                                        }}
                                        className={`w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 text-white/40 hover:text-[#FF453A] transition-all ${activeSessionId === session.id || !isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                        title={t.delete}
                                    >
                                        <Icon name="close" className="!text-[16px]" size={16} />
                                    </button>
                                </div>
                            ))}


                        </div>

                        <div className="p-4 pt-2">
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIsAgentsOpen(true)}
                                    className="w-12 h-12 flex items-center justify-center rounded-xl bg-[#1C1C1E] hover:bg-white/5 text-white/60 hover:text-[#0A84FF] transition-all active:scale-95 group/ai"
                                    title={t.select_agent_title}
                                >
                                    <Icon name="smart_toy" className="!text-[20px] transition-all group-hover/ai:drop-shadow-[0_0_8px_rgba(10,132,255,0.4)]" size={20} />
                                </button>

                                <button
                                    onClick={handleNewChat}
                                    className="flex-1 h-12 flex items-center justify-center bg-[#1C1C1E] text-white/80 hover:bg-[#3A3A3C] hover:text-white active:scale-95 transition-all rounded-xl"
                                    title={t.new_chat}
                                >
                                    <Icon name="add" className="!text-[20px]" size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Drag Handle */}
                        {!isCompactLayout && (
                            <div
                                onMouseDown={startResizing}
                                className="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-50 group/handle"
                            >
                                <div className="absolute left-1/2 -translate-x-1/2 w-[2px] h-full bg-transparent group-hover/handle:bg-white/20 transition-colors"></div>
                            </div>
                        )}
                    </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col relative h-full">
            {/* Header */}
            <header className="flex-none pt-4 pb-2 px-3 sm:px-6 sticky top-0 bg-transparent z-10 drag-region flex items-center justify-between">
                {!hideBack && (
                    <button
                        onClick={() => onNavigate(ViewType.HOME)}
                        className="text-white/80 flex items-center text-[15px] active:opacity-60 transition-opacity no-drag"
                    >
                        <Icon name="chevron_left" className="!text-[20px]" size={20} />
                        <span>{t.back}</span>
                    </button>
                )}
                {hideBack && <div className="w-10"></div>}

                <div className="w-12"></div>
            </header>

            {/* Custom Clear Confirm Modal */}
            {showClearConfirm && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 animate-in fade-in duration-200" onClick={() => setShowClearConfirm(false)}></div>
                    <div className="relative w-full max-w-[320px] bg-[#09090B] border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col items-center animate-in zoom-in-95 duration-200">
                        <div className="w-12 h-12 bg-[#FF453A]/20 text-[#FF453A] rounded-full flex items-center justify-center mb-4">
                            <Icon name="delete" className="!text-[28px]" size={28} />
                        </div>
                        <h3 className="text-[17px] font-semibold text-white mb-2">{t.chat_clear_title}</h3>
                        <p className="text-[14px] text-white/60 text-center mb-6 leading-relaxed">
                            {t.clip_clear_desc}
                        </p>
                        <div className="flex w-full gap-3">
                            <button
                                onClick={() => setShowClearConfirm(false)}
                                className="flex-1 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-[14px] font-medium"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={handleClearAll}
                                className="flex-1 py-2.5 rounded-xl bg-[#FF453A] text-white hover:bg-[#FF453A]/90 transition-colors text-[14px] font-medium"
                            >
                                {t.delete}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showConfigModal && (
                <div className="absolute inset-0 z-[70] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 animate-in fade-in duration-200" onClick={() => setShowConfigModal(false)}></div>
                    <div className="relative w-full max-w-[360px] bg-[#09090B] border border-white/10 rounded-2xl shadow-2xl p-6">
                        <div className="flex items-center gap-2">
                            <Icon name="settings" size={18} className="text-white/70" />
                            <h3 className="text-[16px] font-bold text-white">
                                {language === 'en' ? 'Configure Translation API' : '配置翻译 API'}
                            </h3>
                        </div>
                        <p className="mt-3 text-[14px] text-white/75 leading-relaxed">
                            {language === 'en'
                                ? 'Chat needs an available API configuration. Please configure it in Settings first.'
                                : '当前聊天需要可用的 API 配置，请先到设置中完成配置。'}
                        </p>
                        <div className="mt-5 flex gap-3">
                            <button
                                onClick={() => setShowConfigModal(false)}
                                className="flex-1 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-[14px] font-medium"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={() => {
                                    setShowConfigModal(false);
                                    onNavigateToSettings('MODEL');
                                }}
                                className="flex-1 py-2.5 rounded-xl bg-white/20 text-white hover:bg-white/30 transition-colors text-[14px] font-medium"
                            >
                                {language === 'en' ? 'Open Settings' : '打开设置'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Messages */}
            <main
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 custom-scrollbar mask-fade-bottom"
            >


                {messages.filter(m => m.role !== 'system').length === 0 && !isLoading && (
                    <div className="h-full flex flex-col items-center justify-center text-white/80 px-6 text-center animate-in fade-in zoom-in duration-500">
                        <h2 className="text-xl font-bold text-white mb-2 line-clamp-1">{t.chat_help}</h2>
                    </div>
                )}

                <div className="flex flex-col gap-4">
                                        {messages.filter(msg => msg.role !== 'system').map((msg, idx) => (
                        <div key={idx} className="group/msg">
                            <MessageItem
                                msg={msg}
                                idx={idx}
                                isUser={msg.role === 'user'}
                                t={t}
                                downloadImage={downloadImage}
                                onApplySelection={onApplySelection}
                                onQuoteSelection={handleQuoteSelection}
                                hideCopyButton={msg.role === 'user' && Boolean(msg.quotedContext)}
                            />
                            {msg.role === 'user' && msg.quotedContext && (
                                <div className="mt-1 flex flex-col items-end gap-1">
                                    <div className="w-fit max-w-[85%] min-w-0 h-[40px] px-3 bg-[#09090B] border border-white/10 rounded-xl flex items-center">
                                        <p
                                            title={msg.quotedContext}
                                            className="w-full min-w-0 text-[13px] text-white/60 truncate leading-none"
                                        >
                                            {msg.quotedContext}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => { void BackendService.getInstance().writeClipboard(getMessageText(msg, t.image_placeholder)); }}
                                        className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-xs text-white/80 hover:text-white flex items-center gap-1 px-1"
                                    >
                                        <Icon name="content_copy" className="text-[14px]" size={14} />
                                        {t.copy}
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-[#09090B] px-4 py-3 rounded-2xl flex items-center gap-2">
                                <div className="w-2 h-2 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </main >

            {/* Input Area */}
            <footer className="p-2 sm:p-4 bg-transparent border-t border-white/5">
                {/* 閿?*/}
                {contextQuote && (
                    <div className="mb-3 flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center gap-0.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                            {fixedAgents.length > 0 ? fixedAgents.map(agent => {
                                const meta = getFixedAgentActionMeta(agent);
                                return (
                                <button
                                    key={agent.id}
                                    onClick={() => handleFixedAgentQuoteAction(agent)}
                                    disabled={isLoading || sendLockRef.current}
                                    className="relative min-w-[68px] h-[36px] px-2.5 inline-flex items-center justify-center gap-1 rounded-[10px] border transition-all duration-200 text-[13px] font-medium tracking-tight text-white/55 border-transparent bg-transparent hover:text-white/75 hover:bg-white/[0.03] active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed"
                                    title={language === 'zh'
                                        ? `使用 ${agent.name} 处理引用（链式）`
                                        : `Process quote with ${agent.name} (chain mode)`}
                                >
                                    <Icon name={meta.icon} size={14} className="text-current" />
                                    <span className="leading-none">{meta.label}</span>
                                </button>
                                );
                            }) : (
                                <button
                                    disabled
                                    className="relative min-w-[68px] h-[36px] px-2.5 inline-flex items-center justify-center gap-1 rounded-[10px] border text-white/28 border-white/[0.08] bg-transparent cursor-not-allowed text-[13px] font-medium"
                                    title={language === 'zh' ? '请先固定一个智能体' : 'Please pin an agent first'}
                                >
                                    <Icon name="info" size={14} className="text-current" />
                                    <span className="leading-none">{language === 'zh' ? '解释' : 'Explain'}</span>
                                </button>
                            )}
                        </div>
                        <div className="flex-1 min-w-0 h-[46px] px-3 bg-[#09090B] border border-white/10 rounded-xl relative group">
                            <div className="h-full min-w-0 flex items-center gap-2 pr-8">
                                <Icon name="format_quote" size={16} className="text-white/35 flex-shrink-0" />
                                <p
                                    title={contextQuote}
                                    className="flex-1 min-w-0 text-[13px] text-white/60 truncate leading-none"
                                >
                                    {contextQuote}
                                </p>
                            </div>
                            <button
                                onClick={() => setContextQuote(null)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/35 hover:text-white transition-all"
                            >
                                <Icon name="close" size={14} />
                            </button>
                        </div>
                    </div>
                )}
                {/* Image preview strip */}
                {pendingImages.length > 0 && (
                    <div className="mb-3 flex overflow-x-auto gap-2 pb-2 custom-scrollbar">
                        {pendingImages.map((img, index) => (
                            <div key={index} className="relative flex-none group">
                                <img
                                    src={img}
                                    alt={`preview ${index}`}
                                    className="h-[100px] w-auto max-w-[150px] rounded-lg object-cover border border-white/10"
                                />
                                <button
                                    onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== index))}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#FF453A] rounded-full flex items-center justify-center text-white hover:bg-[#FF6961] transition-colors shadow-sm opacity-0 group-hover:opacity-100"
                                    title={t.remove_image}
                                >
                                    <Icon name="close" className="!text-[12px]" size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="relative min-w-0 flex items-center gap-1">
                    {/* History toggle button */}
                    <button
                        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                        className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                        title={t.view_history}
                    >
                        <Icon name="menu" className="!text-[22px]" size={22} />
                    </button>

                    <div className="flex-1 relative flex items-center">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (!isLoading && !sendLockRef.current) {
                                        handleSend(inputText);
                                    }
                                }
                            }}
                            onPaste={handlePaste}
                            placeholder={pendingImages.length > 0 ? t.input_placeholder_desc : t.input_placeholder}
                            className="w-full min-w-0 bg-[#09090B] text-white text-[15px] pl-3 sm:pl-4 pr-3 sm:pr-4 h-[42px] sm:h-[46px] rounded-xl border border-white/5 focus:border-[#1C1C1E] focus:ring-0 focus:outline-none transition-colors placeholder:text-[#48484A] text-ellipsis whitespace-nowrap overflow-hidden"
                            autoFocus
                        />
                    </div>

                    <button
                        onClick={handleNewChat}
                        disabled={isLoading || sendLockRef.current}
                        className={`w-9 h-9 sm:w-10 sm:h-10 hidden md:flex items-center justify-center rounded-full transition-all active:scale-95 ${isLoading || sendLockRef.current
                            ? 'text-white/20 cursor-not-allowed'
                            : 'text-white/60 hover:text-white'
                            }`}
                        title={t.new_chat}
                    >
                        <Icon name="add" className="!text-[18px]" size={18} />
                    </button>

                    {/* Switch to translate view */}
                    <button
                        onClick={() => onNavigate(ViewType.TRANSLATE)}
                        className="w-9 h-9 sm:w-10 sm:h-10 hidden md:flex items-center justify-center rounded-full text-white/60 hover:text-white transition-all active:scale-95"
                        title={t.switch_translate}
                    >
                        <Icon name="language" className="!text-[18px]" size={18} />
                    </button>

                    <button
                        onClick={() => {
                            if (isLoading) {
                                BackendService.getInstance().stopGeneration();
                                sendLockRef.current = false;
                            } else {
                                handleSend(inputText);
                            }
                        }}
                        disabled={!isLoading && !inputText.trim() && pendingImages.length === 0}
                        className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all ${isLoading
                            ? 'text-white/60 hover:text-[#FF453A] active:scale-90'
                            : (inputText.trim() || pendingImages.length > 0)
                                ? 'text-white/60 hover:text-[#0A84FF] active:scale-90'
                                : 'text-white/20 cursor-not-allowed'
                            }`}
                        title={isLoading ? t.stop_generation || 'Stop' : t.send}
                    >
                        <Icon name={isLoading ? 'stop_circle' : 'send'} className={`!text-[18px] ${!isLoading ? 'translate-x-0.5' : ''}`} size={18} />
                    </button>
                </div>
            </footer >

            {/* History Sidebar */}
            </div>

            {/* Agents Selection Drawer */}
            {isAgentsOpen && (
                <div className="absolute inset-0 z-50 flex">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/80 animate-in fade-in duration-200"
                        onClick={() => setIsAgentsOpen(false)}
                    ></div>

                    {/* Drawer */}
                    <div className="relative w-64 h-full bg-[#09090B] shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
                        <div className="p-4 flex items-center justify-between border-b border-white/5">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setIsAgentsOpen(false)}
                                    className="p-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                >
                                    <Icon name="arrow_back" />
                                </button>
                                <h2 className="text-[17px] font-semibold text-white">{t.select_agent_title}</h2>
                            </div>
                            <button
                                onClick={() => {
                                    setEditingAgent({ color: 'bg-white/10', icon: 'smart_toy' }); // Default values
                                    setIsEditingAgent(true);
                                }}
                                className="p-1.5 rounded-full hover:bg-white/10 text-white/80 transition-colors"
                                title={t.create_agent}
                            >
                                <Icon name="add" className="!text-[20px]" size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {allAgents.map(agent => (
                                <div key={agent.id} className="relative group/agent">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCurrentAgentId(agent.id);
                                            setIsAgentsOpen(false);
                                        }}
                                        className={`relative z-0 w-full p-3 rounded-xl flex items-center gap-3 transition-colors ${currentAgentId === agent.id ? 'bg-[#1C1C1E]' : 'hover:bg-white/5'
                                            }`}
                                    >
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${currentAgentId === agent.id
                                            ? 'bg-[#0F1725] border-[#1F2937] text-white'
                                            : 'bg-[#0E1116] border-white/10 text-white/70'}`}>
                                            <Icon name={agent.icon || 'smart_toy'} className="!text-[15px]" size={15} />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className={`text-[14px] font-medium ${currentAgentId === agent.id ? 'text-white' : 'text-white/80'}`}>
                                                {agent.name}
                                            </div>
                                        </div>
                                    </button>

                                    {/* Agent actions - always visible on mobile, hover on desktop */}
                                    <div className={`absolute z-10 right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-all ${isTouchDevice ? 'opacity-100' : pinnedAgentIds.includes(agent.id) ? 'opacity-100' : 'opacity-0 group-hover/agent:opacity-100'}`}>
                                        <button
                                            type="button"
                                            onClick={(e) => handleTogglePinAgent(e, agent.id)}
                                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${pinnedAgentIds.includes(agent.id)
                                                ? 'text-[#0A84FF] bg-[#0A84FF]/10 hover:bg-[#0A84FF]/20'
                                                : 'hover:bg-white/10 text-white/40 hover:text-white'
                                                }`}
                                            title={pinnedAgentIds.includes(agent.id)
                                                ? (language === 'zh' ? '取消固定' : 'Unpin')
                                                : (language === 'zh' ? '固定' : 'Pin')}
                                        >
                                            <Icon name="push_pin" className="!text-[16px]" size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setEditingAgent(agent);
                                                setIsEditingAgent(true);
                                            }}
                                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all"
                                            title={t.edit_agent || '编辑智能体'}
                                        >
                                            <Icon name="edit" className="!text-[18px]" size={18} />
                                        </button>
                                            <button
                                                type="button"
                                                onClick={(e) => handleDeleteAgent(e, agent.id)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#FF453A]/10 text-white/40 hover:text-[#FF453A] transition-all"
                                                title={t.delete_agent || '删除'}
                                            >
                                                <Icon name="delete" className="!text-[18px]" size={18} />
                                            </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Agent Edit Modal */}
            {isEditingAgent && (
                <div className="absolute inset-0 z-[70] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 animate-in fade-in duration-200" onClick={() => setIsEditingAgent(false)}></div>
                    <div className="relative w-full max-w-[400px] bg-[#09090B] border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col animate-in zoom-in-95 duration-200">
                        <h3 className="text-[17px] font-semibold text-white mb-4">
                            {editingAgent.id ? t.edit_agent : t.create_agent}
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[12px] text-white/60 mb-1.5">{t.agent_name}</label>
                                <input
                                    type="text"
                                    value={editingAgent.name || ''}
                                    onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })}
                                    placeholder={t.agent_placeholder_name}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[14px] text-white focus:border-white/20 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[12px] text-white/60 mb-1.5">{t.agent_prompt}</label>
                                <textarea
                                    value={editingAgent.systemPrompt || ''}
                                    onChange={e => setEditingAgent({ ...editingAgent, systemPrompt: e.target.value })}
                                    placeholder={t.agent_placeholder_prompt}
                                    rows={4}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[14px] text-white focus:border-white/20 focus:outline-none resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[12px] text-white/60 mb-2">{t.agent_icon || (language === 'zh' ? '图标' : 'Icon')}</label>
                                <div className="grid grid-cols-6 gap-2">
                                    {AGENT_ICON_OPTIONS.map(iconName => {
                                        const selected = (editingAgent.icon || 'smart_toy') === iconName;
                                        return (
                                            <button
                                                key={iconName}
                                                type="button"
                                                onClick={() => setEditingAgent({ ...editingAgent, icon: iconName })}
                                                className={`h-9 rounded-lg border flex items-center justify-center transition-all ${selected
                                                    ? 'bg-[#0A84FF]/20 border-[#0A84FF]/70 text-[#69B4FF]'
                                                    : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:border-white/20 hover:bg-white/10'}`}
                                                title={iconName}
                                            >
                                                <Icon name={iconName} className="!text-[16px]" size={16} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setIsEditingAgent(false)}
                                className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors text-[14px]"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={() => {
                                    if (editingAgent.name) {
                                        saveCustomAgent({
                                            id: editingAgent.id || generateId(),
                                            name: editingAgent.name,
                                            systemPrompt: editingAgent.systemPrompt || '',
                                            color: editingAgent.color || 'bg-white/10',
                                            icon: editingAgent.icon || 'smart_toy',
                                            isCustom: true
                                        });
                                    }
                                }}
                                disabled={!editingAgent.name}
                                className={`px-4 py-2 rounded-lg bg-white/10 shadow-white/50white transition-all text-[14px] font-medium ${!editingAgent.name ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#0A84FF]/90 active:scale-95'}`}
                            >
                                {t.save}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatView;












