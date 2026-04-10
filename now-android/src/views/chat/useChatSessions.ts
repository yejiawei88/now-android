import { useEffect, useState } from 'react';
import type { ChatSession, Message } from './types';
import { getMessageText } from './messageUtils';

export function useChatSessions(opts: {
  t: any;
  generateId: () => string;
  currentAgentId: string;
  onAgentIdChange?: (agentId: string) => void;
}) {
  const { t, generateId, currentAgentId, onAgentIdChange } = opts;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);

  // Load sessions (with legacy migration)
  useEffect(() => {
    try {
      const savedSessions = localStorage.getItem('chat_sessions');
      const legacyHistory = localStorage.getItem('chat_history');

      let loadedSessions: ChatSession[] = [];
      if (savedSessions) {
        loadedSessions = JSON.parse(savedSessions);
      } else if (legacyHistory) {
        const parsedLegacy = JSON.parse(legacyHistory);
        if (parsedLegacy.length > 0) {
          const firstMsg = parsedLegacy.find((m: Message) => m.role === 'user')
            ?.content;
          const title =
            typeof firstMsg === 'string' ? firstMsg.slice(0, 20) : t.history_title;
          loadedSessions.push({
            id: generateId(),
            title: title || t.history_title,
            timestamp: Date.now(),
            messages: parsedLegacy,
          });
        }
      }

      if (loadedSessions.length === 0) {
        loadedSessions.push({
          id: generateId(),
          title: t.new_chat,
          timestamp: Date.now(),
          messages: [],
        });
      }

      loadedSessions.sort((a, b) => b.timestamp - a.timestamp);
      setSessions(loadedSessions);
      setCurrentSessionId(loadedSessions[0].id);
      setMessages(loadedSessions[0].messages);
      onAgentIdChange?.(loadedSessions[0].agentId || 'default');

      if (legacyHistory) localStorage.removeItem('chat_history');
    } catch (e) {
      console.error('Failed to load chat sessions:', e);
      const newId = generateId();
      setSessions([
        { id: newId, title: t.new_chat, timestamp: Date.now(), messages: [] },
      ]);
      setCurrentSessionId(newId);
      onAgentIdChange?.('default');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist sessions whenever messages/currentAgentId changes
  useEffect(() => {
    if (!currentSessionId) return;

    setSessions((prev) => {
      const index = prev.findIndex((s) => s.id === currentSessionId);
      if (index === -1) return prev;

      const currentSession = prev[index];
      if (
        currentSession.messages === messages &&
        currentSession.agentId === currentAgentId
      ) {
        return prev;
      }

      const updatedSession: ChatSession = {
        ...currentSession,
        messages,
        agentId: currentAgentId,
      };

      if (updatedSession.title === t.new_chat && messages.length > 0) {
        const firstUserMsg = messages.find((m) => m.role === 'user');
        if (firstUserMsg) {
          const text = getMessageText(firstUserMsg, t.image_placeholder);
          if (text) updatedSession.title = text.slice(0, 20);
        }
      }

      const newSessions = [...prev];
      newSessions[index] = updatedSession;
      localStorage.setItem('chat_sessions', JSON.stringify(newSessions));
      return newSessions;
    });
  }, [messages, currentAgentId, currentSessionId, t.new_chat, t.image_placeholder]);

  const switchSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    setCurrentSessionId(sessionId);
    setMessages(session.messages);
    onAgentIdChange?.(session.agentId || 'default');
  };

  const newChatSession = (newSession: ChatSession) => {
    const updatedSessions = [newSession, ...sessions];
    setSessions(updatedSessions);
    setCurrentSessionId(newSession.id);
    setMessages(newSession.messages);
    onAgentIdChange?.(newSession.agentId || 'default');
    localStorage.setItem('chat_sessions', JSON.stringify(updatedSessions));
  };

  const removeSession = (sessionId: string) => {
    setSessions((prev) => {
      const newSessions = prev.filter((s) => s.id !== sessionId);

      if (sessionId === currentSessionId && newSessions.length > 0) {
        setCurrentSessionId(newSessions[0].id);
        setMessages(newSessions[0].messages);
        onAgentIdChange?.(newSessions[0].agentId || 'default');
      } else if (newSessions.length === 0) {
        const newSession = {
          id: generateId(),
          title: t.new_chat,
          timestamp: Date.now(),
          messages: [],
        };
        newSessions.push(newSession);
        setCurrentSessionId(newSession.id);
        setMessages([]);
        onAgentIdChange?.('default');
      }

      localStorage.setItem('chat_sessions', JSON.stringify(newSessions));
      return newSessions;
    });
  };

  const clearAll = () => {
    localStorage.removeItem('chat_sessions');
    localStorage.removeItem('chat_history');
    const newSession = {
      id: generateId(),
      title: t.new_chat,
      timestamp: Date.now(),
      messages: [],
    };
    setSessions([newSession]);
    setCurrentSessionId(newSession.id);
    setMessages([]);
    onAgentIdChange?.('default');
  };

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    switchSession,
    newChatSession,
    removeSession,
    clearAll,
  };
}