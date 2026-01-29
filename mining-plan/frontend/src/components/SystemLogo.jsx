import React, { useId } from 'react';

// 核心系统图标组件 - 简约智能化风（渐变 id 使用 useId 防止冲突）
export default function SystemLogo({ size = 64, className = '' }) {
  const uid = useId();
  const strokeId = `${uid}-stroke`;
  const fillId = `${uid}-fill`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={strokeId} x1="10" y1="12" x2="54" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id={fillId} x1="16" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eff6ff" />
          <stop offset="1" stopColor="#eef2ff" />
        </linearGradient>
      </defs>

      {/* 中部核心（放大版）：不带底框/圆环，仅保留智能网络形状 */}
      <path
        d="M14 38L30 14L50 30L34 50L14 38Z"
        fill={`url(#${fillId})`}
        stroke="#94a3b8"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M30 14L34 50" stroke={`url(#${strokeId})`} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M14 38L50 30" stroke={`url(#${strokeId})`} strokeWidth="3.2" strokeLinecap="round" />

      {/* 节点（更大更醒目） */}
      <circle cx="30" cy="14" r="4.5" fill="#0ea5e9" />
      <circle cx="50" cy="30" r="4.5" fill="#6366f1" />
      <circle cx="34" cy="50" r="4.5" fill="#0ea5e9" />
      <circle cx="14" cy="38" r="4.5" fill="#38bdf8" />

      {/* 小“数据脉冲”点（保留但靠近主体，避免太散） */}
      <circle cx="18" cy="16" r="1.3" fill="#94a3b8" />
      <circle cx="54" cy="18" r="1.3" fill="#94a3b8" />
      <circle cx="54" cy="48" r="1.3" fill="#94a3b8" />
    </svg>
  );
}
