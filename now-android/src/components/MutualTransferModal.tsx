import React, { useState } from 'react';
import Icon from './Icon';

type TransferState = 'select' | 'success' | 'error' | 'disconnected';

export interface MutualTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendToComputer?: () => Promise<boolean> | boolean;
  onImportToPhone?: () => Promise<boolean> | boolean;
  isConnected?: boolean;
}

export const MutualTransferModal: React.FC<MutualTransferModalProps> = ({
  isOpen,
  onClose,
  onSendToComputer,
  onImportToPhone,
  isConnected = false,
}) => {
  const [transferState, setTransferState] = useState<TransferState>('select');
  const [transferType, setTransferType] = useState<'send' | 'import'>('send');

  if (!isOpen) return null;

  // 每次打开时检查连接状态
  if (transferState === 'select' && !isConnected) {
    setTransferState('disconnected');
  }

  const handleClose = () => {
    setTransferState('select');
    onClose();
  };

  const handleSendToComputer = async () => {
    setTransferType('send');
    if (onSendToComputer) {
      const result = await onSendToComputer();
      setTransferState(result ? 'success' : 'error');
    } else {
      // 模拟成功
      setTimeout(() => setTransferState('success'), 500);
    }
  };

  const handleImportToPhone = async () => {
    setTransferType('import');
    if (onImportToPhone) {
      const result = await onImportToPhone();
      setTransferState(result ? 'success' : 'error');
    } else {
      // 模拟成功
      setTimeout(() => setTransferState('success'), 500);
    }
  };

  const handleBack = () => {
    setTransferState('select');
  };

  // 未连接界面
  const renderDisconnectedView = () => (
    <>
      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
          <Icon name="sync_alt" className="text-white/60" size={24} />
        </div>
        <h3 className="text-white font-bold text-[17px]">互传</h3>
        <p className="text-white/50 text-[13px] mt-1">请先连接电脑</p>
      </div>

      {/* 未连接提示 */}
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="wifi_off" className="text-red-400" size={16} />
          </div>
          <div>
            <p className="text-white font-medium text-[14px] mb-1">未连接电脑</p>
            <p className="text-white/50 text-[12px]">请在设置中先连接电脑后再使用互传功能</p>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <button
        onClick={handleClose}
        className="w-full mt-4 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-medium hover:bg-white/10 transition-all active:scale-95"
      >
        知道了
      </button>
    </>
  );

  // 选择界面
  const renderSelectView = () => (
    <>
      {/* 标题 */}
      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
          <Icon name="sync_alt" className="text-white/60" size={24} />
        </div>
        <h3 className="text-white font-bold text-[17px]">互传</h3>
        <p className="text-white/50 text-[13px] mt-1">选择互传方式</p>
      </div>

      {/* 选择按钮 */}
      <div className="space-y-3">
        {/* 传到电脑 */}
        <button
          onClick={handleSendToComputer}
          className="w-full p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Icon name="laptop_mac" className="text-blue-400" size={20} />
          </div>
          <div className="text-left">
            <div className="text-white font-medium text-[15px]">传到电脑</div>
            <div className="text-white/40 text-[12px]">将手机上的文件发送到电脑</div>
          </div>
          <Icon name="chevron_right" className="text-white/30 ml-auto" size={18} />
        </button>

        {/* 导入手机 */}
        <button
          onClick={handleImportToPhone}
          className="w-full p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Icon name="smartphone" className="text-green-400" size={20} />
          </div>
          <div className="text-left">
            <div className="text-white font-medium text-[15px]">导入手机</div>
            <div className="text-white/40 text-[12px]">从电脑接收文件到手机</div>
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

  // 成功界面
  const renderSuccessView = () => (
    <>
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
          <Icon name="check" className="text-green-400" size={32} />
        </div>
        <h3 className="text-white font-bold text-[18px]">传输成功</h3>
        <p className="text-white/50 text-[14px] mt-2">
          {transferType === 'send' ? '文件已成功发送到电脑' : '文件已成功导入手机'}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleBack}
          className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-medium hover:bg-white/10 transition-all active:scale-95"
        >
          返回
        </button>
        <button
          onClick={handleClose}
          className="flex-1 py-2.5 rounded-xl bg-green-500/20 text-green-300 text-[14px] font-medium border border-green-500/30 hover:bg-green-500/30 transition-all active:scale-95"
        >
          完成
        </button>
      </div>
    </>
  );

  // 失败界面
  const renderErrorView = () => (
    <>
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
          <Icon name="close" className="text-red-400" size={32} />
        </div>
        <h3 className="text-white font-bold text-[18px]">传输失败</h3>
        <p className="text-white/50 text-[14px] mt-2">
          {transferType === 'send' ? '发送到电脑失败，请重试' : '导入手机失败，请重试'}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleBack}
          className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-medium hover:bg-white/10 transition-all active:scale-95"
        >
          返回
        </button>
        <button
          onClick={transferType === 'send' ? handleSendToComputer : handleImportToPhone}
          className="flex-1 py-2.5 rounded-xl bg-red-500/20 text-red-300 text-[14px] font-medium border border-red-500/30 hover:bg-red-500/30 transition-all active:scale-95"
        >
          重试
        </button>
      </div>
    </>
  );

  return (
    <div className="absolute inset-0 z-[1001] flex items-center justify-center px-6 animate-in fade-in zoom-in-95 duration-200">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-[320px] bg-[#09090B] border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50">
        {transferState === 'disconnected' && renderDisconnectedView()}
        {transferState === 'select' && renderSelectView()}
        {transferState === 'success' && renderSuccessView()}
        {transferState === 'error' && renderErrorView()}
      </div>
    </div>
  );
};

export default MutualTransferModal;
