
import React from 'react';

interface IOSSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const IOSSwitch: React.FC<IOSSwitchProps> = ({ checked, onChange }) => {
  return (
    <label className="relative inline-block w-[40px] h-[24px] cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="w-full h-full bg-[#39393D] rounded-full transition-colors duration-300 peer-checked:bg-[#0A84FF] border border-white/5"></div>
      <div className={`absolute top-[2px] left-[2px] w-[20px] h-[20px] bg-white rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-all duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] ${checked ? 'translate-x-[16px]' : 'translate-x-0'}`}></div>
    </label>
  );
};

export default IOSSwitch;
