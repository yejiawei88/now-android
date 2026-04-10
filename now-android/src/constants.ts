
export const API_ENDPOINTS = {
    GLM_4: 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
};

// 预设 API 服务商配置
export interface ApiPreset {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    defaultModel: string;
    protocol: 'OPENAI' | 'GEMINI' | 'ANTHROPIC';
    hint?: string;
}

export const API_PRESETS: ApiPreset[] = [
    {
        id: 'zhipu',
        name: '智谱 AI (GLM)',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        models: ['glm-4-flash', 'glm-4.5-flash', 'glm-4.5', 'glm-4.5-air', 'glm-4-plus', 'glm-4-0520', 'glm-4-air', 'glm-4-long', 'glm-4v-flash'],
        defaultModel: 'glm-4-flash',
        protocol: 'OPENAI',
        hint: '智谱旗舰模型，推荐已升级用户使用'
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com/chat/completions',
        models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat',
        protocol: 'OPENAI',
        hint: '性价比高，编程能力强'
    },
    {
        id: 'openai',
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        defaultModel: 'gpt-4o-mini',
        protocol: 'OPENAI',
        hint: '需科学上网'
    },
    {
        id: 'moonshot',
        name: '月之暗面',
        endpoint: 'https://api.moonshot.cn/v1/chat/completions',
        models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        defaultModel: 'moonshot-v1-8k',
        protocol: 'OPENAI',
        hint: '国产优质模型'
    },
    {
        id: 'qwen',
        name: '通义千问',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
        defaultModel: 'qwen-turbo',
        protocol: 'OPENAI',
        hint: '阿里自研大模型'
    },
    {
        id: 'doubao',
        name: '豆包',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        models: ['doubao-lite-4k', 'doubao-pro-4k', 'doubao-pro-32k'],
        defaultModel: 'doubao-lite-4k',
        protocol: 'OPENAI',
        hint: '字节自研大模型'
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview'],
        defaultModel: 'gemini-2.5-flash',
        protocol: 'GEMINI',
        hint: '需科学上网或使用代理，URL 中的 {model} 会自动替换'
    },
    {
        id: 'claude',
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
        defaultModel: 'claude-3-5-sonnet-20241022',
        protocol: 'ANTHROPIC',
        hint: '需科学上网，使用原生 Anthropic 协议'
    },
    {
        id: 'nvidia',
        name: 'NVIDIA NIM',
        endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
        models: [
            'z-ai/glm4.7',
            'meta/llama-3.1-70b-instruct',
            'meta/llama-3.1-405b-instruct',
            'nvidia/nemotron-4-340b-instruct',
            'minimaxai/minimax-m2.1'
        ],
        defaultModel: 'z-ai/glm4.7',
        protocol: 'OPENAI',
        hint: 'NVIDIA 提供的极致推理服务'
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        models: [
            'meta-llama/llama-3.2-3b-instruct:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemma-2-9b-it:free',
            'microsoft/phi-3-medium-128k-instruct:free',
            'mistralai/pixtral-12b:free',
            'anthropic/claude-3.5-sonnet',
            'openai/gpt-4o'
        ],
        defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
        protocol: 'OPENAI',
        hint: '聚合多家模型，部分免费'
    },
    {
        id: 'custom',
        name: '自定义 (OpenAI 兼容)',
        endpoint: '',
        models: [],
        defaultModel: '',
        protocol: 'OPENAI',
        hint: '填写任意 OpenAI 兼容的 API 地址'
    }
];

// 开发者可以在此处填入内置的免费/低价 API Key (如智谱 GLM-4-Flash 或 DeepSeek)
// 这样用户无需配置即可通过 "内置 AI" 模式使用
// 注意: 客户端硬编码 Key 有泄露风险，建议配合后端使用，或者仅用于免费/低额度 Key
export const BUILT_IN_KEY = '';


export const DEFAULT_SETTINGS = {
    MODEL: 'glm-4-flash',
    WIDTH: 900,
    HEIGHT: 650,
    MIN_WIDTH: 500,
    MIN_HEIGHT: 400
};

export const UI_COLORS = {
    IOS_BLUE: '#0A84FF',
    IOS_GREEN: '#30D158',
    IOS_RED: '#FF453A',
    IOS_ORANGE: '#FF9500'
};

export const TYPE_LABELS = {
    ALL: '全部',
    APP: '应用',
    URL: '网页',
    TEXT: '文本'
} as const;

export const SUPABASE_CONFIG = {
    URL: 'https://exajwgltiwgcyejqattm.supabase.co',
    ANON_KEY: 'sb_publishable_cRSufSJlOdKNPmO80ViBag_3JuKvG3p'
};

export const STYLES = {
    CARD_CONTAINER: "group/card relative rounded-[24px] p-5 transition-all duration-200 select-none shadow-lg shadow-black/40",
    CARD_ACTIVE: "bg-[#121214] border-white/10",
    CARD_INACTIVE: "backdrop-blur-md bg-gradient-to-br from-[#121214] to-[#09090B] border-white/5",
    MODAL_OVERLAY: "fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200",
    PRIMARY_BUTTON: "px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white/80 hover:text-white",
    ICON_BUTTON: "p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all",
    MODAL_CONTAINER: "bg-gradient-to-br from-[#121214] to-[#121214] border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-400",
    MODAL_TEXTAREA: "w-full bg-gradient-to-br from-[#121214] to-[#121214] rounded-[24px] p-5 text-white text-[15px] leading-[1.8] focus:outline-none focus-visible:ring-0 placeholder:text-white/20 custom-scrollbar resize-none caret-white selection:bg-white/20 transition-none",
} as const;

export const CATEGORY_HISTORY_KEYS = ['历史', 'History'] as const;
export const CATEGORY_ALL_KEYS = ['全部', 'All'] as const;

export const DOC_TYPE_DOCUMENT = 'DOCUMENT' as const;

export const DEFAULT_LIBRARY_ID = 'default' as const;

export const isHistoryLikeCategory = (cat?: string | null): boolean =>
    !!cat && (CATEGORY_HISTORY_KEYS as readonly string[]).includes(cat);

export const isAllLikeCategory = (cat?: string | null): boolean =>
    !!cat && (CATEGORY_ALL_KEYS as readonly string[]).includes(cat);


