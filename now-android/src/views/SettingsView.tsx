import React, { useState, useEffect } from 'react';
import { ApiConfig, AppSettings, ViewType, TranslationSettings } from '../types';
import IOSGroup from '../components/IOSGroup';
import IOSRow from '../components/IOSRow';
import IOSSwitch from '../components/IOSSwitch';
import { BackendService } from '../backend';
import { API_PRESETS, ApiPreset } from '../constants';

import { translations, Language } from '../i18n';
import Icon from '../components/Icon';
import SyncPanel from '../components/SyncPanel';

interface SettingsViewProps {
  settings: AppSettings;
  translationSettings: TranslationSettings;
  shortcutsActive: boolean;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onUpdateTranslationSettings: (settings: TranslationSettings) => void;
  onNavigate: (view: ViewType) => void;
  onToggleShortcuts: (active: boolean) => void;
  onExportData: (type: 'ALL' | 'CLIPBOARD' | 'TABLE') => void;
  onImportData: (type: 'ALL' | 'CLIPBOARD' | 'OFFICIAL' | 'TABLE') => void;

  initialTab?: 'GENERAL' | 'MODEL';
  hideBack?: boolean;
  onOpenActivationModal?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  translationSettings,
  shortcutsActive,
  onUpdateSetting,
  onUpdateTranslationSettings,
  onNavigate,
  onToggleShortcuts,
  onExportData,
  onImportData,
  initialTab = 'GENERAL',
  hideBack = false,
  onOpenActivationModal
}) => {
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'MODEL'>(
    (['GENERAL', 'MODEL'] as const).includes(initialTab as any) ? initialTab : 'GENERAL'
  );
  const [showKey, setShowKey] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'success' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDataModal, setShowDataModal] = useState(false);
  const [dataModalTab, setDataModalTab] = useState<'EXPORT' | 'IMPORT'>('IMPORT');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('custom');
  const [editingEndpoint, setEditingEndpoint] = useState(translationSettings.endpoint || '');
  const [editingModel, setEditingModel] = useState(translationSettings.model || '');
  const [editingApiKey, setEditingApiKey] = useState(translationSettings.apiKey || '');
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [renamingConfigId, setRenamingConfigId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [editingAccount, setEditingAccount] = useState<ApiConfig | null>(null);
  const [showModalKey, setShowModalKey] = useState(false);
  const [modalKeyCopied, setModalKeyCopied] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const t = translations[settings.language || 'zh'];

  const handleTranslationChange = (key: keyof TranslationSettings, value: any) => {
    const processedValue = (key === 'apiKey' || key === 'endpoint') && typeof value === 'string' ? value.trim() : value;

    if (key === 'endpoint') setEditingEndpoint(processedValue);
    else if (key === 'model') setEditingModel(processedValue);
    else if (key === 'apiKey') setEditingApiKey(processedValue);

    // If API key changes away from the currently selected saved account,
    // treat it as a new account draft to avoid overwriting the old one on verify.
    if (key === 'apiKey' && editingConfigId) {
      const boundConfig = (translationSettings.savedConfigs || []).find(c => c.id === editingConfigId);
      if (boundConfig && boundConfig.apiKey !== processedValue) {
        setEditingConfigId(null);
      }
    }

    const next = { ...translationSettings, [key]: processedValue, verified: key === 'apiKey' ? false : translationSettings.verified };
    onUpdateTranslationSettings(next);
    if (key === 'apiKey' || key === 'endpoint') {
      setVerificationStatus('idle');
      setErrorMessage(null);
    }
  };

  const handleRemoveConfig = (id: string) => {
    const savedConfigs = translationSettings.savedConfigs || [];
    const removed = savedConfigs.find(c => c.id === id);
    const remaining = savedConfigs.filter(c => c.id !== id);

    const isRemovingActive = Boolean(
      removed &&
      translationSettings.apiKey === removed.apiKey &&
      translationSettings.endpoint === removed.endpoint &&
      translationSettings.model === removed.model
    );

    if (isRemovingActive) {
      // If active account is removed, switch to another available account.
      // If no account remains, clear current API credentials and leave API mode.
      if (remaining.length > 0) {
        const fallback = remaining[0];
        onUpdateTranslationSettings({
          ...translationSettings,
          savedConfigs: remaining,
          endpoint: fallback.endpoint,
          model: fallback.model,
          apiKey: fallback.apiKey,
          verified: Boolean(fallback.verified),
          provider: 'API'
        });
        setEditingEndpoint(fallback.endpoint);
        setEditingModel(fallback.model);
        setEditingApiKey(fallback.apiKey);
        setEditingConfigId(fallback.id);
      } else {
        onUpdateTranslationSettings({
          ...translationSettings,
          savedConfigs: [],
          endpoint: '',
          model: '',
          apiKey: '',
          verified: false,
          provider: 'YOUDAO'
        });
        setEditingEndpoint('');
        setEditingModel('');
        setEditingApiKey('');
        setEditingConfigId(null);
      }
      setVerificationStatus('idle');
      setErrorMessage(null);
      return;
    }

    onUpdateTranslationSettings({ ...translationSettings, savedConfigs: remaining });
    if (editingConfigId === id) {
      setEditingConfigId(null);
    }
  };

  const handleSwitchConfig = (config: ApiConfig) => {
    onUpdateTranslationSettings({
      ...translationSettings,
      endpoint: config.endpoint,
      model: config.model,
      apiKey: config.apiKey,
      verified: Boolean(config.verified),
      provider: 'API'
    });
  };

  const handleRename = (id: string, newName: string) => {
    if (!newName.trim()) return;
    onUpdateTranslationSettings({
      ...translationSettings,
      savedConfigs: (translationSettings.savedConfigs || []).map(c =>
        c.id === id ? { ...c, name: newName.trim() } : c
      )
    });
    setRenamingConfigId(null);
  };

  const handleVerify = async () => {
    setVerificationStatus('verifying');
    setErrorMessage(null);

    const verifySettings = {
      ...translationSettings,
      endpoint: editingEndpoint,
      model: editingModel,
      apiKey: editingApiKey
    };

    try {
      const backend = BackendService.getInstance();
      const success = await backend.verifyAiSettings(verifySettings);
      if (success) {
        setVerificationStatus('success');

        const savedConfigs = translationSettings.savedConfigs || [];
        const existingConfigIdx = editingConfigId ? savedConfigs.findIndex(c => c.id === editingConfigId) : -1;
        const existingConfig = existingConfigIdx !== -1 ? savedConfigs[existingConfigIdx] : null;
        const canUpdateExistingById = Boolean(existingConfig && existingConfig.apiKey === editingApiKey);

        if (canUpdateExistingById && existingConfigIdx !== -1) {
          // Update existing account
          const updatedConfigs = [...savedConfigs];
          updatedConfigs[existingConfigIdx] = {
            ...updatedConfigs[existingConfigIdx],
            endpoint: editingEndpoint,
            model: editingModel,
            apiKey: editingApiKey,
            verified: true
          };
          onUpdateTranslationSettings({
            ...translationSettings,
            endpoint: editingEndpoint,
            model: editingModel,
            apiKey: editingApiKey,
            verified: true,
            savedConfigs: updatedConfigs,
            provider: 'API'
          });
        } else {
          // The selected ID points to a different API key account; do not overwrite it.
          if (existingConfigIdx !== -1 && existingConfig && existingConfig.apiKey !== editingApiKey) {
            setEditingConfigId(null);
          }

          // Match by content if no manual ID match (or check if already exists by content)
          const matchByContentIdx = savedConfigs.findIndex(c =>
            c.endpoint === editingEndpoint &&
            c.model === editingModel &&
            c.apiKey === editingApiKey
          );

          if (matchByContentIdx === -1) {
            const newConfig = {
              id: Date.now().toString(),
              name: editingModel || t.api_unnamed_config,
              endpoint: editingEndpoint,
              model: editingModel,
              apiKey: editingApiKey,
              verified: true
            };
            onUpdateTranslationSettings({
              ...translationSettings,
              endpoint: editingEndpoint,
              model: editingModel,
              apiKey: editingApiKey,
              verified: true,
              savedConfigs: [...savedConfigs, newConfig],
              provider: 'API'
            });
            setEditingConfigId(newConfig.id);
          } else {
            onUpdateTranslationSettings({
              ...translationSettings,
              endpoint: editingEndpoint,
              model: editingModel,
              apiKey: editingApiKey,
              verified: true,
              savedConfigs: savedConfigs.map((config, idx) =>
                idx === matchByContentIdx ? { ...config, verified: true } : config
              ),
              provider: 'API'
            });
            setEditingConfigId(savedConfigs[matchByContentIdx].id);
          }
        }
      } else {
        setVerificationStatus('failed');
        setErrorMessage(t.api_verify_failed);
      }
    } catch (error: any) {
      setVerificationStatus('failed');
      const msg = error.message || String(error);
      const shortMsg = msg.length > 30 ? msg.substring(0, 30) + '...' : msg;
      setErrorMessage(shortMsg);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#09090B]">
      <header className="px-4 pt-4 pb-3 sticky top-0 z-20 drag-region bg-transparent">
        {!hideBack && (
          <div className="flex items-center justify-between h-11">
            <button
              onClick={() => onNavigate(ViewType.HOME)}
              className="text-white/60 flex items-center text-[15px] active:opacity-60 transition-opacity no-drag relative z-[110]"
            >
              <Icon name="chevron_left" className="!text-[20px]" size={20} />
              <span>{t.back}</span>
            </button>
          </div>
        )}
        <div className="bg-[#08090D] p-1 rounded-2xl flex border border-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] mt-0 no-drag relative z-[110]">
          {(['GENERAL', 'MODEL'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-[15px] font-bold rounded-xl transition-all ${activeTab === tab ? 'bg-[#232323] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)]' : 'text-white/65 hover:text-white'}`}
              title={tab === 'GENERAL' ? t.tab_general : t.tab_api}
            >
              {tab === 'GENERAL' ? t.tab_general : t.tab_api}
            </button>
          ))}
        </div>
      </header>

      <main className="mt-2 flex-1 overflow-y-auto custom-scrollbar pb-10 px-4 space-y-6">
        {activeTab === 'GENERAL' && (
          <div className="animate-fade-in space-y-4">
            {/* 设置语言 - 放在卡片外面避免被遮挡 */}
            <div className="flex items-center justify-between bg-[#121214] rounded-2xl border border-white/5 px-4 py-3">
              <span className="text-[15px] font-medium text-white">{t.language}</span>
              <div className="relative">
                <button
                  onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                  className="flex items-center gap-2 bg-[#1A1A1D] text-white text-[14px] font-medium py-2 px-4 rounded-xl border border-white/10 hover:bg-[#222225] transition-all"
                >
                  <span>{settings.language === 'en' ? 'English' : '中文'}</span>
                  <Icon name={langDropdownOpen ? 'expand_less' : 'expand_more'} size={18} className="text-white/60" />
                </button>
                {langDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setLangDropdownOpen(false)} />
                    <div className="absolute right-0 mt-2 w-32 bg-[#1A1A1D] border border-white/10 rounded-xl overflow-hidden shadow-xl z-50">
                      <button
                        onClick={() => {
                          onUpdateSetting('language', 'zh');
                          setLangDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-[14px] transition-all ${
                          settings.language === 'zh' ? 'bg-blue-500/20 text-blue-400' : 'text-white/80 hover:bg-white/5'
                        }`}
                      >
                        中文
                      </button>
                      <button
                        onClick={() => {
                          onUpdateSetting('language', 'en');
                          setLangDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-[14px] transition-all ${
                          settings.language === 'en' ? 'bg-blue-500/20 text-blue-400' : 'text-white/80 hover:bg-white/5'
                        }`}
                      >
                        English
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 数据备份与设置 */}
            <div className="bg-gradient-to-br from-[#121214] to-[#09090B] rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-4 space-y-4">
                {/* 标题栏 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="settings" size={18} className="text-white/80" />
                    <span className="text-[17px] font-bold text-white">{t.data_backup}</span>
                  </div>
                  <div className="flex gap-3 items-center">
                    <button onClick={() => onOpenActivationModal?.()} className="h-11 w-11 bg-[#09090B] hover:bg-white/5 border border-white/10 rounded-xl text-[#3E4048] transition-all flex items-center justify-center shadow-lg" title={t.about_activation}>
                      <Icon name="verified" className="!text-[18px]" size={18} />
                    </button>
                    <button
                      onClick={() => {
                        setDataModalTab('IMPORT');
                        setShowDataModal(true);
                      }}
                      className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[14px] font-bold text-white hover:bg-white/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2 h-11 whitespace-nowrap"
                    >
                      <Icon name="import_export" className="text-[20px] shrink-0" size={20} /><span className="truncate">{t.import_export}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 局域网同步 */}
            <div className="bg-gradient-to-br from-[#121214] to-[#09090B] rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-4">
                <SyncPanel />
              </div>
            </div>

            </div>
          )}

        {
          activeTab === 'MODEL' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-gradient-to-br from-[#121214] to-[#09090B] rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="key" className="text-[24px] text-white/80" size={24} />
                    <span className="text-[17px] font-bold text-white">{t.api_config}</span>
                  </div>

                </div>
                <div className="p-4 space-y-4">
                  {/* 预设服务商选择 */}
                  <div className="space-y-2">
                    <label className="text-[13px] text-white/80">{t.api_provider || '服务商'}</label>
                    <div className="flex flex-wrap gap-2">
                      {API_PRESETS.map(preset => (
                        <button
                          key={preset.id}
                          onClick={() => {
                            setSelectedPresetId(preset.id);
                            if (preset.id !== 'custom') {
                              // Gemini 需要替换 {model}
                              const endpoint = preset.endpoint.includes('{model}')
                                ? preset.endpoint.replace('{model}', preset.defaultModel)
                                : preset.endpoint;

                              // Update local state first
                              setEditingEndpoint(endpoint);
                              setEditingModel(preset.defaultModel);

                              // 合并更新 endpoint 和 model，避免 React 状态更新异步导致覆盖问题
                              onUpdateTranslationSettings({
                                ...translationSettings,
                                endpoint: endpoint,
                                model: preset.defaultModel,
                                verified: false
                              });
                            }
                            setVerificationStatus('idle');
                            setErrorMessage(null);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${selectedPresetId === preset.id
                            ? 'bg-white text-black'
                            : 'bg-[#1C1C1E] text-white/80 hover:bg-[#3A3A3C]'
                            }`}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const currentPreset = API_PRESETS.find(p => p.id === selectedPresetId);
                      return currentPreset?.hint && (
                        <p className="text-[11px] text-white/40 mt-1 flex items-center gap-1">
                          <Icon name="info" className="!text-[14px]" size={14} />
                          {currentPreset.hint}
                        </p>
                      );
                    })()}
                  </div>

                  {/* API 地址 */}
                  <div className="space-y-2">
                    <label className="text-[13px] text-white/80">{t.api_endpoint}</label>
                    <input
                      type="text"
                      value={editingEndpoint}
                      onChange={(e) => {
                        setEditingEndpoint(e.target.value);
                        setSelectedPresetId('custom');
                      }}
                      onBlur={() => handleTranslationChange('endpoint', editingEndpoint)}
                      placeholder={t.api_endpoint_eg}
                      className="w-full bg-[#09090B] text-white text-[14px] px-4 py-3 rounded-xl border border-white/10 focus:outline-none transition-colors"
                    />
                  </div>

                  {/* 模型和 Key */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[13px] text-white/80">{t.api_model}</label>
                      {(() => {
                        const currentPreset = API_PRESETS.find(p => p.id === selectedPresetId);
                        const hasModels = currentPreset && currentPreset.models.length > 0;

                        return hasModels ? (
                          <div className="relative">
                            <select
                              value={translationSettings.model}
                              onChange={(e) => {
                                handleTranslationChange('model', e.target.value);
                                // 如果是 Gemini，更新 endpoint 中的 model
                                if (currentPreset?.endpoint.includes('{model}')) {
                                  const newEndpoint = currentPreset.endpoint.replace('{model}', e.target.value);
                                  handleTranslationChange('endpoint', newEndpoint);
                                }
                              }}
                              style={{ colorScheme: 'dark' }}
                              className="w-full appearance-none bg-[#09090B] text-white text-[14px] px-4 py-3 rounded-xl border border-white/10 focus:outline-none transition-colors cursor-pointer pr-10"
                            >
                              {currentPreset?.models.map(model => (
                                <option key={model} value={model} style={{ backgroundColor: '#2C2C2E' }}>{model}</option>
                              ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/60">
                              <Icon name="expand_more" className="!text-[18px]" size={18} />
                            </div>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={editingModel}
                            onChange={(e) => setEditingModel(e.target.value)}
                            onBlur={() => handleTranslationChange('model', editingModel)}
                            placeholder="gpt-4o"
                            className="w-full bg-[#09090B] text-white text-[14px] px-4 py-3 rounded-xl border border-white/10 focus:outline-none transition-colors"
                          />
                        );
                      })()}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[13px] text-white/80">{t.api_key}</label>
                        <button
                          onClick={() => setShowKey(!showKey)}
                          className="text-white/40 hover:text-white/80 transition-colors"
                        >
                          <Icon name={showKey ? 'visibility_off' : 'visibility'} className="!text-[16px]" size={16} />
                        </button>
                      </div>
                      <input
                        type={showKey ? "text" : "password"}
                        value={editingApiKey}
                        onChange={(e) => setEditingApiKey(e.target.value)}
                        onBlur={() => handleTranslationChange('apiKey', editingApiKey)}
                        placeholder={t.api_input_key}
                        className="w-full bg-[#09090B] text-white text-[14px] px-4 py-3 rounded-xl border border-white/10 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>



                  {/* 验证按钮 */}
                  <div className="flex justify-end pt-2 items-center gap-3">
                    {errorMessage && <span className="text-white/40 text-[12px] max-w-[200px] truncate">{errorMessage}</span>}
                    <button onClick={handleVerify} disabled={verificationStatus === 'verifying'} className={`px-6 py-2.5 rounded-xl text-[14px] font-medium transition-all active:scale-95 ${verificationStatus === 'verifying' ? 'bg-[#1C1C1E]' : verificationStatus === 'success' ? 'bg-white/10 text-white' : verificationStatus === 'failed' ? 'bg-white/5 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}>
                      {verificationStatus === 'verifying' ? t.verifying : verificationStatus === 'success' ? t.verified_success : verificationStatus === 'failed' ? t.verified_failed : t.verify_conn}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-[#121214] to-[#09090B] rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5">
                  <span className="text-[17px] font-bold text-white">{t.saved_accounts}</span>
                </div>
                <div className="p-4">
                  {(translationSettings.savedConfigs || []).length === 0 ? (
                    <div className="py-8 text-center bg-[#1C1C1E]/30 rounded-xl border border-dashed border-white/5 text-white/80">{t.no_saved_accounts}</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {translationSettings.savedConfigs.map(config => {
                        const isActive = translationSettings.apiKey === config.apiKey && translationSettings.endpoint === config.endpoint && translationSettings.model === config.model;
                        return (
                          <div
                            key={config.id}
                            onClick={() => handleSwitchConfig(config)}
                            className={`group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99] ${isActive
                              ? 'bg-[#122016] border-[#30D158]/85'
                              : 'bg-[#1C1C1E]/50 border-white/5 hover:bg-[#1C1C1E] hover:border-white/20'}`}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              {isActive && (
                                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                                  <Icon name="check" className="text-white !text-[16px]" size={16} />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                {renamingConfigId === config.id ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    value={renamingValue}
                                    onChange={(e) => setRenamingValue(e.target.value)}
                                    onBlur={() => handleRename(config.id, renamingValue)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRename(config.id, renamingValue);
                                      if (e.key === 'Escape') setRenamingConfigId(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full bg-[#09090B] text-white text-[15px] font-medium px-2 py-1 rounded border border-white/20 focus:border-[#30D158] focus:outline-none"
                                  />
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[15px] font-medium truncate ${isActive ? 'text-white' : 'text-white'}`}>{config.name}</span>
                                      {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white font-medium shrink-0">{t.api_in_use || '使用中'}</span>}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingAccount(config);
                                }}
                                className="p-2 text-white/40 hover:text-white transition-all"
                                title={t.edit || '编辑'}
                              >
                                <Icon name="edit" className="text-[20px]" size={20} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveConfig(config.id); }}
                                className="p-2 text-white/40 hover:text-white transition-all"
                                title={t.delete || '删除'}
                              >
                                <Icon name="delete" className="text-[20px]" size={20} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        }
      </main >

      {showDataModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowDataModal(false)}>
          <div className="w-[420px] max-w-[92vw] bg-[#101010] border border-white/15 rounded-3xl shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[17px] font-bold text-white tracking-tight leading-none">{t.data_manage}</span>
              <button onClick={() => setShowDataModal(false)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all">
                <Icon name="close" className="text-[20px]" size={20} />
              </button>
            </div>
            <div className="bg-[#0F0F10] p-1 rounded-2xl flex border border-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] mb-2">
              <button
                onClick={() => setDataModalTab('IMPORT')}
                className={`flex-1 py-2 text-[14px] font-bold rounded-xl transition-all ${dataModalTab === 'IMPORT' ? 'bg-[#2A2A2D] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)]' : 'text-white/65 hover:text-white'}`}
              >
                {settings.language === 'en' ? 'Import' : '导入'}
              </button>
              <button
                onClick={() => setDataModalTab('EXPORT')}
                className={`flex-1 py-2 text-[14px] font-bold rounded-xl transition-all ${dataModalTab === 'EXPORT' ? 'bg-[#2A2A2D] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)]' : 'text-white/65 hover:text-white'}`}
              >
                {settings.language === 'en' ? 'Export' : '导出'}
              </button>
            </div>

            {dataModalTab === 'EXPORT' && (
              <>
                <button onClick={() => { onExportData('ALL'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="upload" className="text-[18px]" size={18} />
                    <span>{t.export_all}</span>
                  </div>
                  {settings.exportAllShortcut && <span className="text-[12px] text-white/50 font-mono">{settings.exportAllShortcut}</span>}
                </button>
                <button onClick={() => { onExportData('CLIPBOARD'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="favorite" className="text-[18px]" size={18} />
                    <span>{t.export_lib}</span>
                  </div>
                  {settings.exportClipboardShortcut && <span className="text-[12px] text-white/50 font-mono">{settings.exportClipboardShortcut}</span>}
                </button>
                <button onClick={() => { onExportData('TABLE'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="import_export" className="text-[18px]" size={18} />
                    <span>{settings.language === 'en' ? 'Export Table (CSV/XLSX)' : '导出表格（CSV/XLSX）'}</span>
                  </div>
                </button>
              </>
            )}

            {dataModalTab === 'IMPORT' && (
              <>
                <button onClick={() => { onImportData('ALL'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="download" className="text-[18px]" size={18} />
                    <span>{t.import_all}</span>
                  </div>
                  {settings.importAllShortcut && <span className="text-[12px] text-white/50 font-mono">{settings.importAllShortcut}</span>}
                </button>
                <button onClick={() => { onImportData('OFFICIAL'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="library_add" className="text-[18px]" size={18} />
                    <span>{t.first_run_import}</span>
                  </div>
                </button>
                <button onClick={() => { onImportData('CLIPBOARD'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="favorite" className="text-[18px]" size={18} />
                    <span>{t.import_lib}</span>
                  </div>
                  {settings.importClipboardShortcut && <span className="text-[12px] text-white/50 font-mono">{settings.importClipboardShortcut}</span>}
                </button>
                <button onClick={() => { onImportData('TABLE'); setShowDataModal(false); }} className="w-full h-[58px] bg-[#2A2A2D] hover:bg-[#343438] text-white rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-between px-6">
                  <div className="flex items-center gap-3">
                    <Icon name="import_export" className="text-[18px]" size={18} />
                    <span>{settings.language === 'en' ? 'Import Table (CSV/XLSX)' : '导入表格（CSV/XLSX）'}</span>
                  </div>
                </button>
              </>
            )}

          </div>
        </div>
      )}

      {editingAccount && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setEditingAccount(null)}>
          <div className="w-[360px] bg-[#09090B] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[17px] font-bold text-white">账户详情</span>
              <button onClick={() => setEditingAccount(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-all">
                <Icon name="close" className="text-[20px]" size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] text-white/80">名称</label>
                <input
                  type="text"
                  value={editingAccount.name}
                  onChange={(e) => setEditingAccount({ ...editingAccount, name: e.target.value })}
                  placeholder="请输入自定义名称"
                  className="w-full bg-[#09090B] text-white text-[14px] px-3 py-2.5 rounded-xl border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] text-white/80">API 地址</label>
                <div className="w-full bg-[#09090B] text-white text-[14px] px-3 py-2.5 rounded-xl border border-white/10 break-all select-text max-h-[80px] overflow-y-auto custom-scrollbar">
                  {editingAccount.endpoint}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] text-white/80">模型</label>
                <div className="w-full bg-[#09090B] text-white text-[14px] px-3 py-2.5 rounded-xl border border-white/10 break-all select-text">
                  {editingAccount.model || '-'}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] text-white/80">密钥</label>
                  {editingAccount.apiKey && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          if (editingAccount.apiKey) {
                            void BackendService.getInstance().writeClipboard(editingAccount.apiKey);
                            setModalKeyCopied(true);
                            setTimeout(() => setModalKeyCopied(false), 1500);
                          }
                        }} 
                        className="text-white/40 hover:text-white/80 transition-colors flex items-center justify-center w-6 h-6 hover:bg-white/5 rounded-full"
                        title="复制"
                      >
                        <Icon name={modalKeyCopied ? 'check' : 'content_copy'} className={`!text-[16px] ${modalKeyCopied ? 'text-[#30D158]' : ''}`} size={16} />
                      </button>
                      <button onClick={() => setShowModalKey(!showModalKey)} className="text-white/40 hover:text-white/80 transition-colors flex items-center justify-center w-6 h-6 hover:bg-white/5 rounded-full">
                        <Icon name={showModalKey ? 'visibility_off' : 'visibility'} className="!text-[16px]" size={16} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="w-full bg-[#09090B] text-white text-[14px] px-3 py-2.5 rounded-xl border border-white/10 break-all select-text font-mono">
                  {editingAccount.apiKey ? (showModalKey ? editingAccount.apiKey : editingAccount.apiKey.substring(0, 8) + '********' + editingAccount.apiKey.slice(-4)) : '-'}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 gap-3">
              <button
                onClick={() => { setEditingAccount(null); setShowModalKey(false); }}
                className="px-5 py-2 rounded-xl text-[14px] font-medium transition-all bg-white/5 text-white hover:bg-white/10 active:scale-95"
              >
                取消
              </button>
              <button
                onClick={() => {
                  handleRename(editingAccount.id, editingAccount.name);
                  setEditingAccount(null);
                  setShowModalKey(false);
                }}
                className="px-5 py-2 rounded-xl text-[14px] font-medium transition-all bg-white text-black hover:bg-white/90 active:scale-95"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default SettingsView;
