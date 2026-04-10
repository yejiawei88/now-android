import React, { useState } from 'react';
import { useLanSync } from '../hooks/useLanSync';
import Icon from '../components/Icon';
import MutualTransferModal from './MutualTransferModal';
import ConnectComputerModal from './ConnectComputerModal';

// ─── 主面板 ──────────────────────────────────────────────────────

const SyncPanel: React.FC = () => {
  const {
    status,
    progress,
    isLoading,
    pairedSession,
    startServer,
    stopServer,
    refreshPin,
    setPin,
    pairWithDevice,
    unpair,
    syncAll,
  } = useLanSync();

  const [mode, setMode] = useState<'idle' | 'send' | 'mutual'>('idle');
  const [pinInput, setPinInput] = useState('');
  const [showMutualModal, setShowMutualModal] = useState(false);
  const [mutualError, setMutualError] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // 进度条
  const progressColor =
    progress.phase === 'error' ? 'bg-red-500'
    : progress.phase === 'done' ? 'bg-green-500'
    : 'bg-blue-500 animate-pulse';

  const progressPercent = progress.total > 0
    ? Math.round((progress.synced / progress.total) * 100)
    : progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error' ? 30
    : 0;

  const isSyncing = ['connecting', 'pulling', 'pushing', 'applying_deletes'].includes(progress.phase);



  // ─── 连接电脑弹窗
  const handleOpenConnectModal = () => {
    setShowConnectModal(true);
  };

  const handleCloseConnectModal = () => {
    setShowConnectModal(false);
  };

  const handleStartServer = async () => {
    await startServer();
  };

  const handleStopServer = async () => {
    await stopServer();
  };

  const handlePairWithDevice = async (pin: string): Promise<boolean> => {
    const token = await pairWithDevice('', 0, pin, 'Android');
    return !!token;
  };

  // ─── 互传模式
  const handleStartMutual = () => {
    setShowMutualModal(true);
    setMutualError(null);
  };

  const handleMutualConfirm = async (pin: string) => {
    setPinInput(pin);
    const token = await pairWithDevice('', 0, pin, 'Android');
    if (token) {
      setShowMutualModal(false);
      setPinInput('');
      setMutualError(null);
    } else {
      setMutualError('配对失败，请检查配对码是否正确');
    }
  };

  const handleMutualClose = () => {
    setShowMutualModal(false);
    setPinInput('');
    setMutualError(null);
  };

  const handleStopReceive = async () => {
    await stopServer();
    setMode('idle');
  };

  // ─── 配对
  const handlePair = async () => {
    if (pinInput.length !== 6) return;
    // Android 作为客户端，向 PC 发起配对请求
    // 需要通过 discovery 发现 PC，然后发送配对请求
    const token = await pairWithDevice('', 0, pinInput, 'Android');
    if (token) {
      setMode('idle');
    }
  };

  // ─── 同步
  const handleSync = async () => {
    await syncAll('');
  };

  // 复制配对码到剪贴板
  const copyPin = () => {
    if (status.pin) {
      navigator.clipboard.writeText(status.pin);
    }
  };

  // ─── 渲染 ─────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* 标题栏 */}
      <div className="flex items-center gap-2">
        <Icon name="info" size={16} className="text-blue-400" />
        <span className="text-[15px] font-semibold text-white">局域网同步</span>
      </div>

      {/* 内容区域 */}
      <div className="space-y-4">

      {/* ── 已配对状态 ── */}
      {pairedSession && mode === 'idle' && (
        <div className="space-y-2">
          <div className="bg-white/5 border border-white/8 rounded-xl p-3 space-y-2">

            {/* 连接信息 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-[12px] text-green-400 font-medium">已配对</span>
              </div>
              <span className="text-[11px] text-white/40 font-mono">
                {pairedSession.deviceName}
              </span>
            </div>

            {/* 进度区域 */}
            {progress.phase !== 'idle' && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px] text-white/40">
                  <span>{progress.message}</span>
                  {progress.synced > 0 && (
                    <span className="text-white/60">
                      ↓{progress.synced} ↑{progress.synced} 🗑{progress.deleted}
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${progressColor} rounded-full transition-all duration-500`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {/* 同步详情 */}
                {progress.phase === 'done' && (
                  <div className="flex gap-3 text-[10px]">
                    <span className="text-blue-400">↓写入 {progress.synced}</span>
                    <span className="text-red-400">🗑删除 {progress.deleted}</span>
                    {progress.skipped > 0 && (
                      <span className="text-white/30">跳过 {progress.skipped}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/20 text-blue-300 text-[12px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon name="refresh" size={13} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? '同步中...' : '增量同步'}
              </button>
              <button
                onClick={() => { unpair(); setMode('idle'); }}
                disabled={isSyncing}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 text-white/50 text-[12px] transition-all"
              >
                <Icon name="close" size={13} />
                断开配对
              </button>
            </div>
          </div>

          {/* 错误/成功消息 */}
          {(progress.phase === 'error') && (
            <div className="text-[11px] px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400">
              {progress.message}
            </div>
          )}
        </div>
      )}

      {/* ── 未配对 + 初始选择 ── */}
      {!pairedSession && mode === 'idle' && (
        <div className="space-y-3">
          {/* 连接电脑 - 未连接状态 */}
          <div
            className="flex items-center justify-between cursor-pointer active:opacity-70"
            onClick={handleOpenConnectModal}
          >
            <div className="flex items-center gap-2">
              <Icon name="upload" size={16} className="text-white/60" />
              <span className="text-[15px] text-white/80">连接电脑</span>
            </div>
            <button className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 active:scale-[0.98] transition-all">
              <span className="text-[13px] font-medium text-white/40">未连接</span>
            </button>
          </div>

          {/* 互传 - 连接状态 */}
          <div
            className="flex items-center justify-between cursor-pointer active:opacity-70"
            onClick={handleStartMutual}
          >
            <div className="flex items-center gap-2">
              <Icon name="sync_alt" size={16} className="text-white/60" />
              <span className="text-[15px] text-white/80">互传</span>
            </div>
            <button className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 active:scale-[0.98] transition-all">
              <span className="text-[13px] font-medium text-white/80">互传</span>
            </button>
          </div>

          {/* 互传弹窗 */}
          <MutualTransferModal
            isOpen={showMutualModal}
            onClose={handleMutualClose}
            onSendToComputer={handleMutualConfirm}
            onImportToPhone={handleMutualConfirm}
            isConnected={!!pairedSession}
          />

          {/* 连接电脑弹窗 */}
          <ConnectComputerModal
            isOpen={showConnectModal}
            onClose={handleCloseConnectModal}
            onStartServer={handleStartServer}
            onStopServer={handleStopServer}
            onPairWithDevice={handlePairWithDevice}
            serverStatus={{
              running: status.running,
              pin: status.pin,
            }}
          />
        </div>
      )}

      {/* ── 发送模式：输入 6 位配对码 ── */}
      {mode === 'send' && (
        <div className="space-y-2">
          <div className="bg-white/5 border border-white/8 rounded-xl p-3 space-y-2.5">
            <p className="text-[11px] text-white/40 text-center">输入电脑端显示的 6 位配对码</p>

            <input
              type="text"
              placeholder="000000"
              value={pinInput}
              onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-[24px] font-mono tracking-[0.5em] text-white placeholder-white/20 text-center focus:outline-none focus:border-white/25"
            />

            <button
              onClick={handlePair}
              disabled={pinInput.length !== 6 || progress.phase === 'connecting'}
              className="w-full py-2.5 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 text-[12px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {progress.phase === 'connecting' ? '配对中...' : '配对'}
            </button>

            {progress.phase === 'error' && (
              <p className="text-[11px] text-red-400 text-center">{progress.message}</p>
            )}
          </div>

          <button
            onClick={() => { setMode('idle'); setPinInput(''); }}
            className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/8 text-white/40 text-[12px] transition-all"
          >
            取消
          </button>
        </div>
      )}
      </div>
    </div>
  );
};

export default SyncPanel;
