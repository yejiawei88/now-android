import type { Agent } from './types';

export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'default',
    name: '通用助手',
    icon: 'chat_bubble',
    color: 'bg-white/10',
    desc: '擅长各类任务的 AI 助手',
    systemPrompt: '',
  },
  {
    id: 'translate',
    name: '翻译助手',
    icon: 'translate',
    color: 'bg-white/5',
    desc: '精准的多语言翻译专家',
    systemPrompt:
      '你是专业的翻译助手。请将用户输入的文本翻译成目标语言（默认中文译英文，英文译中文），保持信达雅。',
  },
  {
    id: 'coder',
    name: '代码专家',
    icon: 'code',
    color: 'bg-white/5',
    desc: '编程、调试与代码解释',
    systemPrompt:
      '你是资深全栈工程师。请编写高质量、可维护的代码，并提供清晰的注释和解释。',
  },
  {
    id: 'writer',
    name: '写作助手',
    icon: 'edit_note',
    color: 'bg-white/5',
    desc: '文案润色与创意写作',
    systemPrompt: '你是创意写作专家。请帮助用户润色文案、撰写文章、优化表达。',
  },
];

export const PACKAGED_CUSTOM_AGENTS: Agent[] = [
  {
    id: 'polish',
    name: '完善',
    icon: 'trending_up',
    color: 'bg-white/5',
    desc: '继续完善输入内容',
    systemPrompt: '你把输入框内的内容继续完善',
    isCustom: true,
  },
  {
    id: 'translate',
    name: '翻译',
    icon: 'translate',
    color: 'bg-white/5',
    desc: '精准翻译',
    systemPrompt:
      '你是专业的翻译助手。请将用户输入的文本翻译成目标语言（默认中文译英文，英文译中文），保持信达雅。',
    isCustom: true,
  },
  {
    id: 'explain',
    name: '解释',
    icon: 'smart_toy',
    color: 'bg-white/5',
    desc: '通俗解释内容',
    systemPrompt: '通俗易懂解释以下以下内容',
    isCustom: true,
  },
];

export const PACKAGED_PINNED_AGENT_IDS: string[] = ['explain', 'translate', 'polish'];
