
/**
 * 定义一个通用的请求适配器接口
 */
export interface LLMRequestAdapter {
    /**
     * 将 OpenAI 格式的请求参数转换为目标协议的 RequestInit
     * 返回 url 和 fetch options
     */
    createRequest(
        endpoint: string,
        apiKey: string,
        model: string,
        messages: Array<{ role: string; content: any }>,
        stream: boolean,
        extraParams?: any
    ): { url: string, options: RequestInit };

    /**
     * 解析流式响应的 Chunk 数据，返回增量文本内容
     */
    parseStreamLine(line: string): string | null;

    /**
     * 解析非流式响应的完整 JSON 数据
     */
    parseResponse(data: any): string;
}

/**
 * OpenAI 协议适配器 (标准)
 * 适配 智谱(GLM), DeepSeek, OpenAI, Moonshot 等主流厂商
 */
export const OpenAIAdapter: LLMRequestAdapter = {
    createRequest(endpoint, apiKey, model, messages, stream, extraParams) {
        const body: any = { model, messages, stream };

        // 自动适配智谱 GLM-4.5 的思考模式关
        if (extraParams?.thinking === 'disabled' || (model.includes('glm-4.5') && extraParams?.isTranslation)) {
            body.thinking = { type: 'disabled' };
        }

        return {
            url: endpoint,
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Accept': stream ? 'text/event-stream' : 'application/json'
                },
                body: JSON.stringify(body)
            }
        };
    },

    parseStreamLine(line: string) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return null;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return null;
        try {
            const json = JSON.parse(data);
            return json.choices?.[0]?.delta?.content || null;
        } catch {
            return null;
        }
    },

    parseResponse(data: any) {
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content || '';
        }
        return null as any; // Return null to indicate failure to parse content
    }
};

/**
 * Google Gemini (Native REST) 协议适配器
 */
export const GeminiAdapter: LLMRequestAdapter = {
    createRequest(endpoint, apiKey, model, messages, stream, extraParams) {
        // 1. 分离 system_instruction 和 regular contents
        const systemMessage = messages.find(m => m.role === 'system');
        const contents = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));

        // 2. 动态替换 URL 中的 model 占位符
        let finalUrl = endpoint.replace('{model}', model);

        // 3. Streaming 切换 Verb
        if (stream) {
            finalUrl = finalUrl.replace(':generateContent', ':streamGenerateContent');
        }

        // 4. 添加 API Key 和 SSE 参数
        const separator = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${separator}key=${apiKey.trim()}`;

        // Streaming 必须加 alt=sse
        if (stream && !finalUrl.includes('alt=sse')) {
            finalUrl = `${finalUrl}&alt=sse`;
        }

        const body: any = {
            contents: contents
        };

        if (systemMessage) {
            body.system_instruction = {
                parts: [{ text: systemMessage.content }]
            };
        }

        return {
            url: finalUrl,
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': stream ? 'text/event-stream' : 'application/json'
                },
                body: JSON.stringify({
                    ...body,
                    generationConfig: {
                        maxOutputTokens: 2048,
                    }
                })
            }
        };
    },

    parseStreamLine(line: string) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return null;
        try {
            const jsonStr = trimmed.slice(5).trim();
            const data = JSON.parse(jsonStr);
            return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        } catch {
            return null;
        }
    },

    parseResponse(data: any) {
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
};

/**
 * Anthropic Messages 协议适配器
 * 适配 Claude 原生 API
 */
export const AnthropicAdapter: LLMRequestAdapter = {
    createRequest(endpoint, apiKey, model, messages, stream, extraParams) {
        // Anthropic 的格式将 system 作为顶层参数，而不是 message
        const systemMessage = messages.find(m => m.role === 'system');
        const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }));

        const body: any = {
            model,
            messages: userMessages,
            stream,
            max_tokens: 4096
        };

        if (systemMessage) {
            body.system = systemMessage.content;
        }

        return {
            url: endpoint,
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey.trim(),
                    'anthropic-version': '2023-06-01',
                    'Accept': stream ? 'text/event-stream' : 'application/json'
                },
                body: JSON.stringify(body)
            }
        };
    },

    parseStreamLine(line: string) {
        const trimmed = line.trim();
        // Anthropic SSE 格式通常是 event: content_block_delta \n data: {...}
        if (!trimmed.startsWith('data:')) return null;

        const dataStr = trimmed.slice(5).trim();
        try {
            const data = JSON.parse(dataStr);
            if (data.type === 'content_block_delta' && data.delta?.text) {
                return data.delta.text;
            }
            return null;
        } catch {
            return null;
        }
    },

    parseResponse(data: any) {
        // 非流式响应结果在 content 数组中
        if (data.content && Array.isArray(data.content)) {
            return data.content.map((c: any) => c.text || '').join('');
        }
        return '';
    }
};

/**
 * 工厂函数：获取适配器
 */
export function getAdapter(protocol: string): LLMRequestAdapter {
    if (protocol === 'GEMINI') return GeminiAdapter;
    if (protocol === 'ANTHROPIC') return AnthropicAdapter;
    return OpenAIAdapter;
}
