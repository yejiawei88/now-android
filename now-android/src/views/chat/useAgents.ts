import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_AGENTS } from './agents';
import type { Agent } from './types';

export function useAgents() {
  const [customAgents, setCustomAgents] = useState<Agent[]>([]);
  const [hiddenAgents, setHiddenAgents] = useState<string[]>([]);

  // Load custom agents + hidden agents
  useEffect(() => {
    try {
      const savedAgents = localStorage.getItem('custom_agents');
      if (savedAgents) setCustomAgents(JSON.parse(savedAgents));
      const savedHidden = localStorage.getItem('hidden_agents');
      if (savedHidden) setHiddenAgents(JSON.parse(savedHidden));
    } catch (e) {
      console.error('Failed to load agents data:', e);
    }
  }, []);

  const allAgents = useMemo(() => {
    let list = [...DEFAULT_AGENTS];
    customAgents.forEach((c) => {
      const idx = list.findIndex((a) => a.id === c.id);
      if (idx !== -1) list[idx] = c;
      else list.push(c);
    });
    return list.filter((a) => !hiddenAgents.includes(a.id));
  }, [customAgents, hiddenAgents]);

  const saveCustomAgent = (agent: Agent) => {
    setCustomAgents((prev) => {
      const exists = prev.find((a) => a.id === agent.id);
      const updated = exists
        ? prev.map((a) => (a.id === agent.id ? agent : a))
        : [...prev, agent];
      localStorage.setItem('custom_agents', JSON.stringify(updated));
      return updated;
    });
  };

  const hideAgent = (agentId: string) => {
    setHiddenAgents((prev) => {
      const updated = [...prev, agentId];
      localStorage.setItem('hidden_agents', JSON.stringify(updated));
      return updated;
    });

    setCustomAgents((prev) => {
      const updated = prev.filter((a) => a.id !== agentId);
      localStorage.setItem('custom_agents', JSON.stringify(updated));
      return updated;
    });
  };

  return {
    allAgents,
    customAgents,
    hiddenAgents,
    saveCustomAgent,
    hideAgent,
  };
}

