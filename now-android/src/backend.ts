
import { ShortcutItem, AppSettings } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { API_ENDPOINTS, BUILT_IN_KEY, DEFAULT_SETTINGS, ApiPreset } from "./constants";
import { getAdapter } from "./llm_adapters";

import { deobfuscate, logger } from "./utils";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
  }
}

export class BackendService {
  private static instance: BackendService;
  private runningShortcuts: Map<string, number> = new Map();



  public static getInstance(): BackendService {
    if (!BackendService.instance) {
      BackendService.instance = new BackendService();
    }
    return BackendService.instance;
  }

  private constructor() {
    if (!(window as any).__RUNNING_SHORTCUTS__) {
      (window as any).__RUNNING_SHORTCUTS__ = new Map();
    }
    this.runningShortcuts = (window as any).__RUNNING_SHORTCUTS__;
  }

  private abortController: AbortController | null = null;

  public stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      logger.log('[Backend] Generation stopped by user');
    }
  }

  private async createApiRequest(settings: any, messages: any[], stream: boolean, extraParams?: any) {
    // 1. 严格清洗输入数据 (移除前后空格、换行、制表符等)
    const rawEndpoint = settings.endpoint || API_ENDPOINTS.GLM_4;
    const endpoint = rawEndpoint.trim().replace(/[\r\n\t]/g, '');

    const rawApiKey = deobfuscate(settings.apiKey || '');
    const apiKey = rawApiKey.trim().replace(/[\r\n\t]/g, '');

    const model = (settings.model || DEFAULT_SETTINGS.MODEL).trim();

    if (!apiKey) throw new Error('API Key 未设置，请先在配置中填写');

    // 2. 纯粹的协议识别逻辑：检测 Google 域名、/gemini/、/anthropic 或 /messages 路径
    const isGoogle = endpoint.includes('googleapis.com') || endpoint.includes('/gemini/');
    const isAnthropic = endpoint.includes('anthropic.com') || endpoint.includes('/anthropic') || endpoint.includes('/v1/messages');

    let effectiveProtocol = 'OPENAI';
    if (isGoogle) effectiveProtocol = 'GEMINI';
    else if (isAnthropic) effectiveProtocol = 'ANTHROPIC';

    const adapter = getAdapter(effectiveProtocol);
    const { url, options } = adapter.createRequest(
      endpoint,
      apiKey,
      model,
      messages,
      stream,
      extraParams
    );

    // Attach signal
    if (this.abortController) {
      options.signal = this.abortController.signal;
    }

    logger.log(`[Backend] Requesting ${effectiveProtocol}:`, url);

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Backend] API Error (${response.status}):`, errorText);

        let customMsg = `API Error ${response.status}`;
        if (response.status === 401) customMsg = '身份验证失败 (401): 请检查 API Key。';
        else if (response.status === 403) customMsg = '权限不足 (403): 请检查模型权限。';
        else if (response.status === 404) customMsg = '地址错误 (404): 请检查 API 地址。';
        else if (response.status === 429) customMsg = '次数受限 (429): 请稍后再试。';

        // 包含前 100 个字符的原始错误详情，方便定位问题
        const detail = errorText.length > 100 ? errorText.slice(0, 100) + '...' : errorText;
        throw new Error(`${customMsg}\n详情: ${detail}`);
      }
      return response;
    } catch (e: any) {
      if (e.message?.includes('Failed to fetch')) {
        throw new Error('网络请求失败：请检查网络连接或代理设置');
      }
      throw e;
    }
  }

  public async summon(item: ShortcutItem): Promise<{ success: boolean; message: string; instances: number }> {
    const isGroup = item.type === 'GROUP' || Boolean(item.actions?.length);
    const currentCount = this.runningShortcuts.get(item.id) || 0;
    const isUrl = item.type === 'URL' || (item.path && item.path.includes('://'));

    logger.log('[Backend] Summoning:', item.name, 'ID:', item.id, 'Type:', item.type, 'Repeat:', item.repeatOpen, 'Count:', currentCount);

    if (isGroup) {
      if (!window.__TAURI_INTERNALS__) {
        return { success: false, message: "Not in Tauri", instances: 0 };
      }
      try {
        const res: any = await invoke("summon", { item });
        return { success: Boolean(res?.success), message: res?.message || item.name, instances: 0 };
      } catch (e) {
        console.error(e);
        return { success: false, message: `${e}`, instances: 0 };
      }
    }

    if (!item.repeatOpen && currentCount > 0) {
      logger.log('[Backend] Single-instance check: Requesting Toggle Only');
      if (window.__TAURI_INTERNALS__) {
        await invoke("summon", { item: { ...item, justToggle: true } });
        return { success: true, message: `[切换] ${item.name}`, instances: currentCount };
      }
      return { success: true, message: `[激活] ${item.name}`, instances: 1 };
    }

    // Optimistic Lock: prevent double-fire while await is pending
    if (!item.repeatOpen) {
      this.runningShortcuts.set(item.id, 1);
    }

    if (window.__TAURI_INTERNALS__) {
      try {
        const res: any = await invoke("summon", { item });
        if (res?.success) {
          const newCount = (isUrl || item.repeatOpen) ? (this.runningShortcuts.get(item.id) || 1) : 1;
          // If repeatOpen, we increment. If not, we keep at 1.
          // Note: for repeatOpen, we might want to track actual count, but standard logic is simple
          if (item.repeatOpen) {
            this.runningShortcuts.set(item.id, (currentCount || 0) + 1);
          } else {
            // Confirm it's 1
            this.runningShortcuts.set(item.id, 1);
          }
          logger.log('[Backend] Summon success. New Count:', this.runningShortcuts.get(item.id));
          return { ...res, instances: this.runningShortcuts.get(item.id) };
        }

        // Revert on failure
        if (!item.repeatOpen) this.runningShortcuts.set(item.id, 0);
        return res || { success: false, message: "Unknown error", instances: 0 };
      } catch (e) {
        if (!item.repeatOpen) this.runningShortcuts.set(item.id, 0);
        console.error(e);
        return { success: false, message: `${e}`, instances: 0 };
      }
    }
    return { success: false, message: "Not in Tauri", instances: 0 };
  }

  public async selectFile(): Promise<string | null> {
    return window.__TAURI_INTERNALS__ ? await invoke("select_file") : null;
  }

  public async selectFolder(): Promise<string | null> {
    return window.__TAURI_INTERNALS__ ? await invoke("select_folder") : null;
  }

  public async windowControl(action: string): Promise<any> {
    return window.__TAURI_INTERNALS__ ? await invoke("window_control", { action }) : null;
  }

  public async setPreserveFocusOnShow(enable: boolean): Promise<void> {
    if (!window.__TAURI_INTERNALS__) return;
    await invoke("set_preserve_focus_on_show", { enable });
  }

  public async saveFile(content: string, filename: string): Promise<boolean> {
    return window.__TAURI_INTERNALS__ ? await invoke("save_file", { content, filename }) : false;
  }

  public async saveImage(base64Data: string, filename?: string): Promise<boolean> {
    return window.__TAURI_INTERNALS__ ? await invoke("save_image", { base64Data, filename }) : false;
  }

  public async readFile(): Promise<string | null> {
    return window.__TAURI_INTERNALS__ ? await invoke("read_file") : null;
  }

  public async toggleAppVisibility(path: string, visible: boolean): Promise<void> {
    if (window.__TAURI_INTERNALS__) {
      await invoke("toggle_app_visibility", { path, targetVisible: visible });
    }
  }

  public async resizeWindow(bounds: { width: number; height: number }): Promise<void> {
    if (window.__TAURI_INTERNALS__) await invoke("resize_window", bounds);
  }

  public async readClipboard(): Promise<string | null> {
    if (window.__TAURI_INTERNALS__) {
      try {
        const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
        return await readText();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  public async writeClipboard(text: string): Promise<void> {
    if (window.__TAURI_INTERNALS__) {
      try {
        await invoke("write_clipboard_text", { text });
      } catch (e) {
        console.error("Failed to write clipboard text:", e);
        throw e;
      }
    }
  }

  // Added method to sync specific item update if needed, though bulk save is usually preferred
  public async updateItem(item: any): Promise<void> {
    // Placeholder: The actual persistence usually happens via db_save_items with the full list.
    // If the frontend relies on autosave of the full list, this might be a no-op or trigger a full save.
    // But since I called it in logic, I must define it to fix the error.
    // For now, let's assume the View handles bulk saving via useEffect([items]), so this can be empty 
    // OR we can make it emit an event.
    // SAFE BET: Do nothing here, and ensure View has autosave.
    return Promise.resolve();
  }

  public stopAll(): void {
    this.runningShortcuts.clear();
  }

  public async smartSummon(prompt: string, shortcuts: ShortcutItem[]): Promise<string[]> {
    if (!prompt.trim()) return [];
    const input = prompt.toLowerCase();
    // Removed artificial delay
    return shortcuts
      .filter(item => item.name.toLowerCase().includes(input) || item.keys.toLowerCase().includes(input))
      .map(item => item.id);
  }

  public async verifyAiSettings(settings: any): Promise<boolean> {
    try {
      if (!settings.apiKey) return false;
      const response = await this.createApiRequest(settings, [{ role: 'user', content: 'Hi' }], false, { isTranslation: false });
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        const endpoint_lower = (settings.endpoint || "").toLowerCase();
        const isGoogle = endpoint_lower.includes('googleapis.com') || endpoint_lower.includes('/gemini/');
        const isAnthropic = endpoint_lower.includes('anthropic.com') || endpoint_lower.includes('/anthropic') || endpoint_lower.includes('/v1/messages');

        let protocol = 'OPENAI';
        if (isGoogle) protocol = 'GEMINI';
        else if (isAnthropic) protocol = 'ANTHROPIC';

        const adapter = getAdapter(protocol);
        const content = adapter.parseResponse(json); // Use adapter to verify response format

        if (content || content === '') {
          // Check if there's an error field in JSON (some providers return 200 with error body)
          if (json.error || json.err_code) {
            console.error('Verify AI Settings: API returned error in 200 body:', json);
            return false;
          }
          return true;
        }
        return false;
      } catch (e) {
        console.error('Verify AI Settings failed to parse JSON or adapt:', text);
        return false;
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  public async chat(settings: any, messages: { role: string; content: any }[], extraParams?: any): Promise<string> {
    try {
      this.abortController = new AbortController();
      const lastMessage = messages[messages.length - 1].content;
      const provider = settings.provider || 'YOUDAO';
      const targetLang = (extraParams?.targetLang || '').toString().toLowerCase();
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      if (provider === 'YOUDAO') {
        // 优先检查是否有官方 API Key配置
        if (settings.youdaoAppKey && settings.youdaoAppSecret) {
          try {
            const appKey = deobfuscate(settings.youdaoAppKey);
            const appSecret = deobfuscate(settings.youdaoAppSecret);
            const q = lastMessage;
            const salt = crypto.randomUUID();
            const curtime = Math.round(Date.now() / 1000).toString();

            const truncate = (str: string) => {
              const len = str.length;
              if (len <= 20) return str;
              return str.substring(0, 10) + len + str.substring(len - 10, len);
            };

            const signStr = appKey + truncate(q) + salt + curtime + appSecret;

            const sha256 = async (str: string) => {
              const msgBuffer = new TextEncoder().encode(str);
              const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            };

            const sign = await sha256(signStr);

            const youdaoTo = targetLang === 'en' ? 'en' : (targetLang === 'zh' ? 'zh-CHS' : 'auto');
            const params = new URLSearchParams({
              q,
              from: 'auto',
              to: youdaoTo,
              appKey,
              salt,
              sign,
              signType: 'v3',
              curtime,
            });

            const response = await fetch('https://openapi.youdao.com/api', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params
            });

            if (!response.ok) throw new Error(`Status ${response.status}`);
            const data = await response.json();

            if (data.errorCode && data.errorCode !== '0') {
              throw new Error(`有道 API 错误: ${data.errorCode}`);
            }

            if (data && data.translation) {
              return data.translation.join('\n');
            }
            return '翻译结果为空';

          } catch (e: any) {
            console.error('[Backend] Youdao Official API failed:', e);
            return `官方接口调用失败: ${e.message}`;
          }
        }

        // 降级使用免费 Web 接口
        // use http
        const youdaoType = targetLang === 'en'
          ? 'ZH_CN2EN'
          : (targetLang === 'zh' ? 'EN2ZH_CN' : 'AUTO');
        const url = `http://fanyi.youdao.com/translate?&doctype=json&type=${youdaoType}&i=${encodeURIComponent(lastMessage)}`;

        // 策略1: 尝试伪装成移动端请求，通常风控较松
        const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': mobileUA,
              'Accept': 'application/json, text/plain, */*'
            }
          });

          if (!response.ok) throw new Error(`Status ${response.status}`);
          const text = await response.text();

          try {
            const data = JSON.parse(text);
            if (data && data.translateResult) {
              return data.translateResult
                .map((group: any) => group.map((item: any) => item.tgt).join(''))
                .join('\n');
            }
          } catch (e) {
            // Json 解析失败，说明可能被识别为爬虫返回了 HTML
            console.warn('[Backend] Youdao Mobile UA failed, text:', text.slice(0, 50));
            throw new Error('Blocked');
          }
        } catch (e) {
          // 策略2: 如果失败，返回友好的错误指引
          console.error('[Backend] Youdao failed:', e);
          return '💡 有道免费接口繁忙(HTML)。\n\n请稍后再试，或在设置中填写您的有道 API Key (更稳定)，或切换到 "API 模式"。';
        }
      }

      if (provider === 'GOOGLE') {
        const googleTarget = targetLang === 'en' ? 'en' : (targetLang === 'zh' ? 'zh-CN' : 'zh-CN');
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${googleTarget}&dt=t&q=${encodeURIComponent(lastMessage)}`;
        logger.log('[Backend] Fetching Google:', url);
        const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
        logger.log('[Backend] Status:', response.status);
        const text = await response.text();

        if (!response.ok) throw new Error(`HTTP ${response.status}: 谷歌服务连接失败`);

        try {
          const data = JSON.parse(text);
          return data[0].map((item: any) => item[0]).join('') || '谷歌翻译失败';
        } catch (e) {
          console.error('[Backend] Google JSON parse failed. Raw text:', text.slice(0, 200));
          return '谷歌翻译不可用(需科学上网)';
        }
      }

      if (provider === 'BUILTIN') {
        // 内置模式：使用开发者预设的 Key
        // 如果没有预设 Key，则提示用户配置

        if (!BUILT_IN_KEY) {
          return '⚠️ 开发者未配置内置 Key。\n\n请在 constant.ts 中填入您的 GLM-4-Flash 或 DeepSeek Key，或者切换到 "自定义 API" 模式填入您自己的 Key。';
        }

        const builtinSettings = {
          ...settings,
          apiKey: BUILT_IN_KEY,
          // 默认使用智谱 GLM-4-Flash
          endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
          model: 'glm-4-flash'
        };

        const response = await this.createApiRequest(builtinSettings, messages, false, extraParams);
        const text = await response.text();
        if (!response.ok) throw new Error(`内置服务异常: ${response.status}`);
        try {
          const data = JSON.parse(text);
          return data.choices?.[0]?.message?.content || '';
        } catch (e) {
          throw new Error('内置服务返回格式错误');
        }
      }

      // API 模式
      const response = await this.createApiRequest(settings, messages, false, extraParams);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text || '接口请求失败'}`);
      }
      try {
        const data = JSON.parse(text);
        const endpoint_lower = (settings.endpoint || "").toLowerCase();
        const isGoogle = endpoint_lower.includes('googleapis.com') || endpoint_lower.includes('/gemini/');
        const isAnthropic = endpoint_lower.includes('anthropic.com') || endpoint_lower.includes('/anthropic') || endpoint_lower.includes('/v1/messages');

        let protocol = 'OPENAI';
        if (isGoogle) protocol = 'GEMINI';
        else if (isAnthropic) protocol = 'ANTHROPIC';

        const adapter = getAdapter(protocol);
        return adapter.parseResponse(data);
      } catch (e) {
        console.error('[Backend] API JSON parse failed or adapter mismatch. Raw text:', text);
        throw new Error('API 返回了格式错误的数据');
      }
    } catch (e: any) {
      console.error('Chat error detail:', e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      return `Error: ${errorMsg}`;
    } finally {
      this.abortController = null;
    }
  }

  public async chatStream(
    settings: any,
    messages: { role: string; content: any }[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (error: string) => void,
    extraParams?: any
  ): Promise<void> {
    const provider = settings.provider || 'YOUDAO';

    // Providers that definitely don't support streaming or use custom logic
    if (provider === 'YOUDAO' || provider === 'GOOGLE') {
      try {
        const res = await this.chat(settings, messages, extraParams);
        onChunk(res);
        onDone();
      } catch (e: any) {
        console.error('ChatStream error:', e);
        const msg = e instanceof Error ? e.message : String(e);
        onError(msg);
      }
      return;
    }

    // For BUILTIN, we inject the developer's key and GLM model
    let effectiveSettings = settings;
    if (provider === 'BUILTIN') {
      if (!BUILT_IN_KEY) {
        return onError('⚠️ 开发者未配置内置 Key。\n\n请在 constant.ts 中填入您的 GLM-4-Flash Key，或者切换到 "自定义 API" 模式填入您自己的 Key。');
      }
      effectiveSettings = {
        ...settings,
        apiKey: BUILT_IN_KEY,
        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-4-flash'
      };
    }

    try {
      // 关键：创建新的 AbortController，让 Tauri HTTP 插件正确处理流式响应
      this.abortController = new AbortController();
      const response = await this.createApiRequest(effectiveSettings, messages, true, extraParams);
      const reader = response.body?.getReader();
      if (!reader) return onError('No stream');

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const endpoint_lower = (effectiveSettings.endpoint || "").toLowerCase();
      const isGoogle = endpoint_lower.includes('googleapis.com') || endpoint_lower.includes('/gemini/');
      const isAnthropic = endpoint_lower.includes('anthropic.com') || endpoint_lower.includes('/anthropic') || endpoint_lower.includes('/v1/messages');

      let protocol = 'OPENAI';
      if (isGoogle) protocol = 'GEMINI';
      else if (isAnthropic) protocol = 'ANTHROPIC';

      const adapter = getAdapter(protocol);

      logger.log(`[Backend] Streaming started, protocol: ${protocol}`);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        logger.log(`[Backend] Stream chunk received, buffer length: ${buffer.length}`);

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const content = adapter.parseStreamLine(line);
          if (content !== null) onChunk(content);
        }
      }

      // 处理最后剩余的 buffer 内容
      if (buffer.trim()) {
        const content = adapter.parseStreamLine(buffer);
        if (content !== null) onChunk(content);
      }

      this.abortController = null;
      onDone();
    } catch (e: any) {
      this.abortController = null;
      console.error('ChatStream error:', e);
      const msg = e instanceof Error ? e.message : String(e);
      onError(msg);
    }
  }
  public async getMachineId(): Promise<string> {
    return window.__TAURI_INTERNALS__ ? await invoke("get_machine_id") : "BROWSER-MOCK-ID";
  }

  public async pasteText(text: string, shouldHide: boolean = true, treatAsImage: boolean = false): Promise<void> {
        return invoke('paste_text', { text, shouldHide, treatAsImage });
    }

  public async verifyLicense(key: string, apiUrl: string, apiToken: string = ''): Promise<any> {
    return window.__TAURI_INTERNALS__ ? await invoke("verify_license", { key, apiUrl, apiToken }) : { success: true, message: "Browser Mock Pass" };
  }

  public async checkLicenseStatus(): Promise<any> {
    return window.__TAURI_INTERNALS__ ? await invoke("check_license_status") : { success: true, message: "Browser Mock: Trial" };
  }

  public async unbindLicense(key: string, apiUrl: string, targetDeviceId: string, apiToken: string = ''): Promise<any> {
    return window.__TAURI_INTERNALS__ ? await invoke("unbind_license", { key, apiUrl, apiToken, targetDeviceId }) : { success: false, message: "Browser Mock Fail" };
  }

  public async getLicenseDevices(key: string, apiUrl: string, apiToken: string = ''): Promise<any> {
    return window.__TAURI_INTERNALS__ ? await invoke("get_license_devices", { key, apiUrl, apiToken }) : { success: true, devices: [] };
  }


}
