import { useState } from 'react';
import type { TranslationSettings } from '../../types';
import { translations } from '../../i18n';
import { deobfuscate } from '../../utils';

type UseTranslationSettingsArgs = {
  language: 'zh' | 'en' | undefined;
  initialSettings: TranslationSettings;
};

export const useTranslationSettings = ({
  language,
  initialSettings,
}: UseTranslationSettingsArgs) => {
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(() => {
    const t = translations[language || 'zh'];
    const EN_PROMPTS = {
      quick_translate: `Translate according to these rules and output only the translated result:
1) Chinese input -> English output
2) English input -> Chinese output
3) Mixed Chinese-English input -> Chinese output
4) When the target is Chinese, the final output must contain no Latin letters; convert names/brands to Chinese form
{{text}}`,
      prompt_optimize: `Optimize the following prompt with CO-STAR and return only the optimized prompt:
{{text}}`,
      summarize_text: `Summarize the following content in the same language as input:
{{text}}
Use SCQA and markdown bullet points.`,
    };
    const ZH_PROMPTS = {
      quick_translate: `请按以下规则翻译，并且只输出译文：
1) 输入中文 -> 输出英文
2) 输入英文 -> 输出中文
3) 输入中英混杂 -> 输出中文
4) 当目标语言是中文时，结果中不允许出现英文字母；人名/品牌名请转换为常见中文写法或音译
{{text}}`,
      prompt_optimize: `请使用 CO-STAR 框架优化以下提示词，并且只返回优化后的提示词：
{{text}}`,
      summarize_text: `请用与输入内容相同的语言总结以下内容：
{{text}}
请使用 SCQA 结构和 Markdown 项目符号。`,
    };
    const defaultActions = [
      {
        id: 'quick_translate',
        name: t.sc_quick_translate,
        prompt: ZH_PROMPTS.quick_translate,
        shortcut: 'Shift+X',
        isSystem: true,
      },
      {
        id: 'prompt_optimize',
        name: t.sc_prompt_optimize,
        prompt: ZH_PROMPTS.prompt_optimize,
        shortcut: 'Alt+Y',
        isSystem: false,
      },
      {
        id: 'summarize_text',
        name: t.sc_summarize,
        prompt: ZH_PROMPTS.summarize_text,
        shortcut: 'Alt+J',
        isSystem: false,
      },
    ];

    try {
      const saved = localStorage.getItem('translation_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        const savedActions = parsed.customActions || [];
        const finalActions = [...savedActions];

        finalActions.forEach((a: any) => {
          if (a.id === 'prompt_optimize' || a.id === 'summarize_text') {
            a.isSystem = false;
            if (a.name === 'sc_prompt_optimize') a.name = t.sc_prompt_optimize;
            if (a.name === 'sc_summarize') a.name = t.sc_summarize;
          }
          if (a.id === 'quick_translate' && a.prompt === EN_PROMPTS.quick_translate) {
            a.prompt = ZH_PROMPTS.quick_translate;
          }
          if (a.id === 'quick_translate' && a.prompt === `Translate the following text and output only the translated result:
{{text}}`) {
            a.prompt = ZH_PROMPTS.quick_translate;
          }
          if (a.id === 'quick_translate' && a.prompt === `Translate the following text into Chinese and output only the translated result.
If the input is mixed Chinese-English, output fully in Chinese.
{{text}}`) {
            a.prompt = ZH_PROMPTS.quick_translate;
          }
          if (a.id === 'quick_translate' && a.prompt === `请翻译以下文本，只输出翻译结果：
{{text}}`) {
            a.prompt = ZH_PROMPTS.quick_translate;
          }
          if (a.id === 'quick_translate' && a.prompt === `请将以下文本翻译成中文，只输出译文。
若输入为中英混杂，也请统一输出为中文。
{{text}}`) {
            a.prompt = ZH_PROMPTS.quick_translate;
          }
          if (a.id === 'quick_translate' && a.prompt === `请将以下文本翻译成英文，只输出译文。
若输入为中英混杂，也请统一输出为英文。
{{text}}`) {
            a.prompt = ZH_PROMPTS.quick_translate;
          }
          if (a.id === 'prompt_optimize' && a.prompt === EN_PROMPTS.prompt_optimize) {
            a.prompt = ZH_PROMPTS.prompt_optimize;
          }
          if (a.id === 'summarize_text' && a.prompt === EN_PROMPTS.summarize_text) {
            a.prompt = ZH_PROMPTS.summarize_text;
          }
        });

        defaultActions.forEach((def) => {
          if (!finalActions.some((a: any) => a.id === def.id)) {
            finalActions.push(def);
          }
        });

        const qt = finalActions.find((a: any) => a.id === 'quick_translate');
        if (qt && !qt.shortcut) {
          qt.shortcut = 'Shift+X';
        }

        return {
          ...initialSettings,
          ...parsed,
          apiKey: deobfuscate(parsed.apiKey),
          youdaoAppKey: deobfuscate(parsed.youdaoAppKey),
          youdaoAppSecret: deobfuscate(parsed.youdaoAppSecret),
          savedConfigs: (parsed.savedConfigs || []).map((c: any) => ({
            ...c,
            apiKey: deobfuscate(c.apiKey),
          })),
          customActions: finalActions,
        };
      }
    } catch (e) {
      console.error('Failed to load translation settings:', e);
    }

    return {
      ...initialSettings,
      selectionShortcut: '',
      customActions: defaultActions,
    };
  });

  return { translationSettings, setTranslationSettings };
};

