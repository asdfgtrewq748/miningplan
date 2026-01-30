import React from 'react';

const SmoothnessSlider = ({
  value,
  onChange,
  disabled = false,
  label = '平滑度',
  min = 0,
  max = 6,
  step = 1,
  title,
  className = '',
}) => {
  return (
    <div className={`flex items-center gap-1 ${className}`.trim()}>
      <div className="text-[11px] text-slate-500 font-bold">{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(value)}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className={`w-16 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        disabled={disabled}
        title={title}
      />
      <div className="text-[11px] text-slate-600 font-mono w-5 -ml-2 text-right">{Number(value)}</div>
    </div>
  );
};

export default SmoothnessSlider;
