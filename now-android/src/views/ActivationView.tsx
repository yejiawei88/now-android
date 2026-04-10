import React, { useCallback, useEffect, useState } from 'react';
import { BackendService } from '../backend';
import Icon from '../components/Icon';
import { ViewType } from '../types';

interface ActivationViewProps {
  onNavigate: (view: ViewType) => void;
}

type VerifyStatus = 'idle' | 'verifying' | 'success' | 'failed';
type ActivationType = 'month' | 'year' | 'buyout' | string;

const backend = BackendService.getInstance();
const INVALID_LICENSE_KEYS = new Set(['ACTIVATED', 'Unknown License']);

const normalizeLicenseKey = (value: unknown): string => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || INVALID_LICENSE_KEYS.has(candidate)) return '';
  return candidate;
};

const localizeActivationMessage = (raw: string): string => {
  if (!raw) return raw;

  const trialMatch = raw.match(/Trial Mode \((\d+)\s+days left\)/i);
  if (trialMatch?.[1]) {
    return `试用模式（剩余 ${trialMatch[1]} 天）`;
  }

  const usedMatch = raw.match(/License activated successfully\s*\((\d+)\/(\d+)\s+devices used\)/i);
  if (usedMatch?.[1] && usedMatch?.[2]) {
    return `授权激活成功（已使用 ${usedMatch[1]}/${usedMatch[2]} 台设备）`;
  }

  const map: Record<string, string> = {
    'License activated successfully': '授权激活成功',
    'Trial Expired': '试用已到期',
    'No valid license key found. Please reactivate and sync first.': '未找到有效序列号，请先重新激活并同步',
    'Please enter a valid license key before unbinding.': '解绑前请先输入有效序列号',
    'Network Request Failed': '网络请求失败',
  };

  return map[raw] ?? raw;
};

const parseActivationMeta = (res: any): { activationType: ActivationType | null; expiresAt: string | null } => {
  const info = res?.license_info ?? {};
  const rawType = info?.activation_type ?? info?.type ?? null;
  const rawExpires = info?.expires_at ?? info?.expiry_at ?? info?.expire_at ?? null;
  return {
    activationType: typeof rawType === 'string' && rawType.trim() ? rawType.trim().toLowerCase() : null,
    expiresAt: typeof rawExpires === 'string' && rawExpires.trim() ? rawExpires.trim() : null,
  };
};

const calcRemainingDays = (expiresAt: string | null): number | null => {
  if (!expiresAt) return null;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return null;
  const diffMs = expiresMs - Date.now();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
};

const formatExpiryLocal = (expiresAt: string | null): string | null => {
  if (!expiresAt) return null;
  const dt = new Date(expiresAt);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const ActivationView: React.FC<ActivationViewProps> = ({ onNavigate }) => {
  const [key, setKey] = useState('');
  const [resolvedLicenseKey, setResolvedLicenseKey] = useState('');
  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [machineId, setMachineId] = useState('加载中...');
  const [message, setMessage] = useState('');
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [activationType, setActivationType] = useState<ActivationType | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [devices, setDevices] = useState<Array<{ device_id: string; activate_time?: string }>>([]);
  const [isDevicesLoading, setIsDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');

  const getEffectiveLicenseKey = () => {
    return normalizeLicenseKey(resolvedLicenseKey) || normalizeLicenseKey(key);
  };

  const canManageDevices = Boolean(normalizeLicenseKey(resolvedLicenseKey));

  const syncLicenseStatus = useCallback(async () => {
    try {
      const res = await backend.checkLicenseStatus();
      const meta = parseActivationMeta(res);
      setActivationType(meta.activationType);
      setExpiresAt(meta.expiresAt);
      const serverKey = normalizeLicenseKey(res?.license_info?.key);
      setResolvedLicenseKey(serverKey);

      if (res?.success && res?.license_info) {
        setStatus('success');
        setMessage(localizeActivationMessage(res.message || ''));
        if (serverKey) setKey(serverKey);
        return serverKey;
      }

      if ((res?.message || '').includes('Trial Mode')) {
        const days = String(res.message).match(/(\d+) days/);
        if (days?.[1]) setTrialDays(parseInt(days[1], 10));
      } else {
        setTrialDays(0);
      }

      setKey((prev) => normalizeLicenseKey(prev));
      return serverKey;
    } catch (e) {
      console.error('[ActivationView] syncLicenseStatus error:', e);
      setMessage('获取激活状态失败，请检查网络连接');
      setTrialDays(0);
      return '';
    }
  }, []);

  const getAuthoritativeLicenseKey = useCallback(async () => {
    try {
      return await syncLicenseStatus();
    } catch {
      return normalizeLicenseKey(resolvedLicenseKey);
    }
  }, [resolvedLicenseKey, syncLicenseStatus]);

  useEffect(() => {
    backend.getMachineId().then(setMachineId);
    void syncLicenseStatus();
  }, [syncLicenseStatus]);

  const handleActivate = async () => {
    if (!key.trim()) return;
    setStatus('verifying');
    setMessage('');

    try {
      const res = await backend.verifyLicense(key.trim(), '', '');
      if (res.success) {
        const meta = parseActivationMeta(res);
        setActivationType(meta.activationType);
        setExpiresAt(meta.expiresAt);
        setStatus('success');
        setMessage(localizeActivationMessage(res.message));
        await syncLicenseStatus();
      } else {
        setStatus('failed');
        setMessage(localizeActivationMessage(res.message));
      }
    } catch (e: any) {
      setStatus('failed');
      setMessage(e?.message || '网络错误');
    }
  };

  const handleManageDevices = async () => {
    setIsModalOpen(true);
    setIsDevicesLoading(true);
    setDevicesError('');
    setDevices([]);
    try {
      const cachedKey = getEffectiveLicenseKey();
      const effectiveKey = cachedKey || (await getAuthoritativeLicenseKey());
      if (!effectiveKey) {
        setDevicesError('请先重新激活同步到服务器后再管理设备');
        return;
      }

      const res = await backend.getLicenseDevices(effectiveKey, '', '');

      if (res && Array.isArray(res.devices)) {
        setDevices(res.devices);
      } else {
        setDevicesError(res?.message || '获取设备列表失败');
      }
    } catch (e: any) {
      setDevicesError(e?.message || e || '获取设备列表错误');
    } finally {
      setIsDevicesLoading(false);
    }
  };

  const handleRemoveDevice = async (deviceId: string) => {
    if (!window.confirm('确定要解绑该设备吗？')) return;

    const effectiveKey = await getAuthoritativeLicenseKey();
    if (!effectiveKey) {
      alert('未找到有效序列号，请先重新激活');
      return;
    }

    try {
      const res = await backend.unbindLicense(effectiveKey, '', deviceId, '');

      if (res.success) {
        setDevices((prev) => prev.filter((d) => d.device_id !== deviceId));
      } else {
        alert(res.message || '解绑失败');
      }
    } catch (e: any) {
      alert(e?.message || e || '解绑错误');
    }
  };

  const handleClearLicenseInput = () => {
    setStatus('idle');
    setMessage('');
    setKey('');
    setResolvedLicenseKey('');
    setActivationType(null);
    setExpiresAt(null);
    setIsModalOpen(false);
    setDevices([]);
    setDevicesError('');
  };

  const renderValidityText = () => {
    if (status !== 'success') {
      return trialDays !== null ? `${trialDays} 天` : '计算中...';
    }

    const normalizedType = (activationType || '').toLowerCase();
    if (normalizedType === 'buyout') return '永久有效';
    if (normalizedType === 'month' || normalizedType === 'year') {
      const expiryText = formatExpiryLocal(expiresAt);
      if (expiryText) return expiryText;
      return normalizedType === 'month' ? '月度有效' : '年度有效';
    }

    if (expiresAt) {
      const expiryText = formatExpiryLocal(expiresAt);
      if (expiryText) return expiryText;
    }

    return '已激活';
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#09090B] overflow-y-auto custom-scrollbar">
      <header className="px-4 pt-4 pb-3 sticky top-0 z-20 drag-region bg-[#09090B] border-b border-white/5">
        <div className="flex items-center justify-between h-11">
          <button
            onClick={() => onNavigate(ViewType.SETTINGS)}
            className="text-white/60 flex items-center text-[15px] active:opacity-60 transition-opacity no-drag relative z-[110]"
          >
            <Icon name="chevron_left" className="!text-[20px]" size={20} />
            <span>返回</span>
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-y-auto custom-scrollbar">
        <div className="w-full max-w-[460px] mx-auto bg-[#0A0A0C] rounded-2xl border border-white/5 overflow-hidden">
          {/* 左侧信息区 - PC端显示，移动端隐藏 */}
          <div className="hidden md:block p-8 bg-gradient-to-br from-white/[0.02] to-transparent border-b border-white/5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.08] border border-white/[0.15] text-white/90 text-[12px] font-bold tracking-wider uppercase mb-4">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/40 shadow-white/50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white/60" />
              </span>
              {status === 'success' ? '专业版' : '免费试用'}
            </div>

            <h1 className="text-2xl lg:text-3xl font-bold text-white mb-3 tracking-tight leading-tight">
              终身授权
              <br />
              <span className="text-white/30 font-medium text-base lg:text-xl">永久免费更新</span>
            </h1>

            <p className="text-white/50 text-[14px] max-w-[280px] mb-4 leading-relaxed">
              购买后即可永久使用 Now 所有功能，并享受后续所有大版本免费升级。
            </p>

            <div className="space-y-3 text-white/90">
              {[
                { icon: 'devices', text: '1 组序列号绑定 2 台设备' },
                { icon: 'update', text: '永久免费获得后续版本更新' },
                { icon: 'verified_user', text: '无需订阅，一次买断' },
                { icon: 'info', text: '当前可免费试用 2 个月（60天）' },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center border border-white/[0.03]">
                    <Icon name={item.icon} className="!text-[16px] text-white/90" size={16} />
                  </div>
                  <span className="text-[13px] font-medium">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧表单区 */}
          <div className="w-full p-6 bg-black/30">
            <div className="space-y-6">
              {/* 剩余体验时间 */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="flex items-center gap-2 text-[12px] text-white/80 font-bold uppercase tracking-wider">
                    <Icon name="schedule" className="!text-[14px]" size={14} />
                    剩余体验时间
                  </label>
                  <button
                    onClick={() => window.open('http://nowai.cc.cd')}
                    className="text-[12px] text-white/60 hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer"
                  >
                    获取授权 ›
                  </button>
                </div>
                <div className="w-full bg-white/[0.02] text-white/80 text-[14px] font-medium p-4 rounded-xl border border-white/[0.03] flex items-center justify-between">
                  <span>{renderValidityText()}</span>
                  {status === 'success' && (
                    <span className="text-[10px] text-white bg-white/10 px-2 py-1 rounded-full border border-white/20 uppercase tracking-wider">已激活</span>
                  )}
                </div>
              </div>

              {/* 序列号输入 */}
              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <label className="flex items-center gap-2 text-[12px] text-white/80 font-bold uppercase tracking-wider">
                    <Icon name="key" className="!text-[14px]" size={14} />
                    序列号 / 激活码
                  </label>
                  <div className="flex items-center gap-3">
                    {status === 'success' && (
                      <button
                        onClick={handleClearLicenseInput}
                        className="text-[12px] text-white/60 hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer"
                      >
                        清除
                      </button>
                    )}
                    {canManageDevices && (
                      <button
                        onClick={handleManageDevices}
                        disabled={isDevicesLoading}
                        className="text-[12px] text-white/60 hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer disabled:text-white/30 disabled:cursor-wait"
                      >
                        管理设备 ›
                      </button>
                    )}
                  </div>
                </div>

                {status === 'success' ? (
                  <div className="group relative">
                    <div className="w-full bg-white/5 text-white/90 text-[14px] font-mono p-4 rounded-xl border border-white/5 flex items-center justify-center tracking-wider break-all">
                      {getEffectiveLicenseKey() || '请重新激活同步到服务器'}
                    </div>
                    <button
                      onClick={() => void backend.writeClipboard(getEffectiveLicenseKey())}
                      className="absolute right-3 bottom-3 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                      title="复制序列号"
                    >
                      <Icon name="content_copy" className="!text-[18px]" size={18} />
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => setKey(e.target.value.trim())}
                    placeholder="输入授权序列号"
                    className="w-full bg-white/[0.02] text-white/90 text-[14px] p-4 rounded-xl border border-white/[0.08] focus:border-white/30 transition-all duration-300 placeholder:text-white/10 text-center"
                  />
                )}
              </div>

              {/* 状态消息 */}
              {message && (
                <div
                  className={`text-[13px] p-4 rounded-xl flex items-start gap-3 ${
                    status === 'success'
                      ? 'relative overflow-hidden text-blue-100/76 bg-[linear-gradient(120deg,rgba(3,14,36,0.86)_0%,rgba(7,28,70,0.74)_42%,rgba(12,33,82,0.68)_100%)] backdrop-blur-[1px]'
                      : 'bg-white/5 text-white/70 border border-white/10'
                  }`}
                >
                  {status === 'success' && (
                    <>
                      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.01)_28%,rgba(255,255,255,0)_60%)]" />
                      <div className="pointer-events-none absolute -top-10 right-6 h-24 w-24 rounded-full bg-blue-500/10 blur-2xl" />
                    </>
                  )}
                  <Icon name={status === 'success' ? 'verified' : 'error'} className="relative z-10 text-[18px] text-blue-100/75 shrink-0 mt-0.5" size={18} />
                  <span className="relative z-10 leading-snug font-medium text-blue-100/80">{message}</span>
                </div>
              )}

              {/* 激活按钮 */}
              <button
                onClick={handleActivate}
                disabled={status === 'verifying' || !key}
                className={`w-full h-[56px] flex items-center justify-center rounded-xl font-bold text-[15px] transition-all duration-300 active:scale-[0.98] ${
                  status === 'success' ? 'bg-white/10 text-white cursor-default' : 'bg-white text-black hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                } disabled:opacity-20 disabled:cursor-not-allowed disabled:shadow-none`}
              >
                <div className="relative z-10 flex items-center justify-center gap-3">
                  {status === 'verifying' && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                  {status === 'success' ? '激活成功' : '立即激活授权'}
                </div>
              </button>

              <p className="text-[11px] text-white/20 text-center px-4 leading-relaxed">
                激活过程中遇到问题？请联系 support@nowai.cc.cd 或访问 http://nowai.cc.cd
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* 设备管理弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-[380px] bg-[#0A0A0C] border border-white/5 rounded-2xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-3">
              <h3 className="text-white font-bold text-[16px]">管理已绑定设备</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-white/40 hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="space-y-3 max-h-[260px] overflow-y-auto custom-scrollbar">
              {isDevicesLoading ? (
                <p className="text-white/50 text-center py-8 text-[13px]">加载设备列表中...</p>
              ) : devicesError ? (
                <p className="text-red-300/80 text-center py-8 text-[13px]">{devicesError}</p>
              ) : devices.length === 0 ? (
                <p className="text-white/40 text-center py-8 text-[13px]">暂无绑定设备</p>
              ) : (
                devices.map((d) => (
                  <div key={d.device_id} className="flex justify-between items-center bg-white/[0.03] border border-white/[0.05] rounded-xl p-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-white/90 font-medium text-[13px]">{d.device_id === machineId ? '当前设备（本机）' : '外部设备'}</span>
                      <span className="text-white/30 font-mono text-[11px] truncate w-[200px]" title={d.device_id}>
                        ID: {d.device_id}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveDevice(d.device_id)}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors text-[11px] font-medium cursor-pointer border-none"
                    >
                      解绑
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivationView;
