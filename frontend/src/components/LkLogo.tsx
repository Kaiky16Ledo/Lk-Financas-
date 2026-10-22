import React from 'react';

interface LkLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  subtitle?: string;
}

export const LkLogo: React.FC<LkLogoProps> = ({
  size = 'md',
  showText = true,
  subtitle = 'Cofre Pessoal Zero-Knowledge',
}) => {
  const dimensions = {
    sm: 'w-9 h-9',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-20 h-20',
  }[size];

  const titleClass = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-3xl',
  }[size];

  return (
    <div className="inline-flex items-center gap-3 select-none">
      <div
        className={`${dimensions} relative flex items-center justify-center rounded-2xl shadow-lg ring-2 ring-amber-400/70 bg-gradient-to-br from-emerald-900 via-emerald-700 to-slate-900 shrink-0`}
        aria-label="Logo LK Finanças"
      >
        <svg viewBox="0 0 120 120" className="w-full h-full p-1" fill="none">
          <defs>
            <linearGradient id="lkGoldInline" x1="20" y1="15" x2="100" y2="105" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="50%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
          </defs>
          <rect
            x="10"
            y="10"
            width="100"
            height="100"
            rx="22"
            stroke="#34D399"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          {/* Letra L */}
          <path d="M26 32H40V74H60V87H26V32Z" fill="#FFFFFF" />
          {/* Letra K */}
          <path
            d="M58 32H72V55L89 32H105L83 58L106 87H89L72 64V87H58V32Z"
            fill="url(#lkGoldInline)"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col leading-tight">
          <div className={`font-extrabold tracking-tight ${titleClass} flex items-center gap-1.5`}>
            <span className="text-emerald-700 dark:text-emerald-400">LK</span>
            <span className="text-slate-900 dark:text-white">Finanças</span>
          </div>
          {subtitle && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
