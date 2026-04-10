import React, { useState } from 'react';
import Icon from './Icon';

type ConnectMode = 'select' | 'server' | 'client';
type ClientPhase = 'idle' | 'connecting' | 'error';

export interface ConnectComputerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartServer: () => Promise<void>;
  onStopServer: () => Promise<void>;
  onPairWithDevice: (pin: string) => Promise<boolean>;
  serverStatus: {
    running: boolean;
    pin?: string;
  };
  /** 默认打开输入配对码模式（客户端模式） */
  defaultMode?: 'client' | 'select';
}

export const ConnectComputerModal: React.FC<ConnectComputerModalProps> = ({
  isOpen,
  onClose,
  onStartServer,
  onStopServer,
  onPairWithDevice,
  serverStatus,
  defaultMode = 'client',
}) => {
  const [mode, setMode] = useState<ConnectMode>(defaultMode);
  const [pinInput, setPinInput] = useState('');
  const [clientPhase, setClientPhase] = useState<ClientPhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [customPin, setCustomPin] = useState('');

  // 每次打开时重置状态
  React.useEffect(() => {
    if (isOpen) {
      setMode(defaultMode);
      setPinInput('');
      setClientPhase('idle');
      setErrorMsg(null);
      setCustomPin('');
    }
  }, [isOpen, defaultMode]);

  if (!isOpen) return null;

  const handleClose = () => {
    setMode('select');
    setPinInput('');
    setClientPhase('idle');
    setErrorMsg(null);
    setCustomPin('');
    onClose();
  };

  const handleStartServer = async () => {
    setMode('server');
    await onStartServer();
  };

  const handleStopServer = async () => {
    await onStopServer();
    setMode('select');
  };

  const handlePair = async () => {
    if (pinInput.length !== 6) return;
    setClientPhase('connecting');
    setErrorMsg(null);
    const success = await onPairWithDevice(pinInput);
    if (success) {
      handleClose();
    } else {
      setClientPhase('error');
      setErrorMsg('配对失败，请检查配对码是否正确');
    }
  };

  const copyPin = () => {
    if (serverStatus.pin) {
      navigator.clipboard.writeText(serverStatus.pin);
    }
  };

  // ─── 选择界面 ─────────────────────────────────────────────
  const renderSelectView = () => (
    <>
      {/* 标题 */}
      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
          <Icon name="laptop_mac" className="text-white/60" size={24} />
        </div>
        <h3 className="text-white font-bold text-[17px]">连接电脑</h3>
        <p className="text-white/50 text-[13px] mt-1">选择连接方式</p>
      </div>

      {/* 选择按钮 */}
      <div className="space-y-3">
        {/* 作为服务端 */}
        <button
          onClick={handleStartServer}
          className="w-full p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Icon name="wifi_tethering" className="text-blue-400" size={20} />
          </div>
          <div className="text-left">
            <div className="text-white font-medium text-[15px]">开启服务</div>
            <div className="text-white/40 text-[12px]">手机作为服务器，等待电脑连接</div>
          </div>
          <Icon name="chevron_right" className="text-white/30 ml-auto" size={18} />
        </button>

        {/* 作为客户端 */}
        <button
          onClick={() => setMode('client')}
          className="w-full p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Icon name="link" className="text-green-400" size={20} />
          </div>
          <div className="text-left">
            <div className="text-white font-medium text-[15px]">输入配对码</div>
            <div className="text-white/40 text-[12px]">输入电脑端显示的配对码</div>
          </div>
          <Icon name="chevron_right" className="text-white/30 ml-auto" size={18} />
        </button>
      </div>

      {/* 取消按钮 */}
      <button
        onClick={handleClose}
        className="w-full mt-4 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-medium hover:bg-white/10 transition-all active:scale-95"
      >
        取消
      </button>
    </>
  );

  // ─── 服务端界面 ─────────────────────────────────────────────
  const renderServerView = () => (
    <>
      {/* 标题 */}
      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-500/20 flex items-center justify-center">
          <Icon name="wifi_tethering" className="text-blue-400" size={24} />
        </div>
        <h3 className="text-white font-bold text-[17px]">开启服务</h3>
        <p className="text-white/50 text-[13px] mt-1">等待电脑连接</p>
      </div>

      {/* 状态内容 */}
      <div className="space-y-4">
        {serverStatus.running ? (
          <>
            {/* 运行中状态 */}
            <div className="bg-white/5 border border-white/8 rounded-xl p-4 space-y-3">
              {/* 状态指示 */}
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[13px] text-green-400 font-medium">服务运行中</span>
              </div>

              {/* 配对码显示 */}
              {serverStatus.pin && (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/40">将此配对码输入电脑</p>
                  <div 
                    className="flex items-center justify-center py-3 rounded-xl bg-black/30 cursor-pointer active:opacity-70"
                    onClick={copyPin}
                  >
                    <span className="text-[28px] font-mono tracking-[0.4em] text-white font-bold">
                      {serverStatus.pin}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/30 text-center">点击复制</p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* 启动中状态 */
          <div className="flex items-center gap-2 py-4 justify-center">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-[13px] text-yellow-400">正在启动服务...</span>
          </div>
        )}
      </div>

      {/* 停止按钮 */}
      <button
        onClick={handleStopServer}
        className="w-full mt-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 text-[14px] font-medium transition-all active:scale-95"
      >
        停止服务
      </button>

      {/* 返回按钮 */}
      <button
        onClick={() => setMode('select')}
        className="w-full mt-2 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-medium hover:bg-white/10 transition-all active:scale-95"
      >
        返回
      </button>
    </>
  );

  // ─── 客户端界面（输入链接码）────────────────────────────────
  const renderClientView = () => (
    <>
      {/* 标题 */}
      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
          <Icon name="link" className="text-white/60" size={24} />
        </div>
        <h3 className="text-white font-bold text-[17px]">连接电脑</h3>
        <p className="text-white/50 text-[13px] mt-1">输入电脑端显示的链接码</p>
      </div>

      {/* 输入框 */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="请输入"
          value={pinInput}
          onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
          maxLength={6}
          className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3.5 text-[24px] font-mono tracking-[0.5em] text-white placeholder-white/20 text-center focus:outline-none focus:border-white/25"
        />

        {/* 错误提示 */}
        {errorMsg && (
          <p className="text-[12px] text-red-400 text-center">{errorMsg}</p>
        )}

        {/* 确认按钮 */}
        <button
          onClick={handlePair}
          disabled={pinInput.length !== 6 || clientPhase === 'connecting'}
          className="w-full py-2.5 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 text-[14px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
        >
          {clientPhase === 'connecting' ? '连接中...' : '连接'}
        </button>
      </div>

      {/* 取消按钮 */}
      <button
        onClick={handleClose}
        className="w-full mt-3 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-medium hover:bg-white/10 transition-all active:scale-95"
      >
        取消
      </button>
    </>
  );

  return (
    <div className="absolute inset-0 z-[1001] flex items-center justify-center px-6 animate-in fade-in zoom-in-95 duration-200">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-[320px] bg-[#09090B] border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50">
        {mode === 'select' && renderSelectView()}
        {mode === 'server' && renderServerView()}
        {mode === 'client' && renderClientView()}
      </div>
    </div>
  );
};

export default ConnectComputerModal;
