export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
  // For UI preview (e.g., pasted/uploaded images)
  imagePreview?: string;
  // Quoted context attached at send time (for UI-only display under sent bubble)
  quotedContext?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: Message[];
  agentId?: string;
}

export interface Agent {
  id: string;
  name: string;
  desc?: string;
  icon: string;
  color: string;
  systemPrompt: string;
  isCustom?: boolean;
}


