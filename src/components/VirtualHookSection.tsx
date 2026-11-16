import React from 'react';
import { TradeParameters } from '../types';

interface VirtualHookSectionProps {
  params: TradeParameters;
  onUpdateParams: (newParams: Partial<TradeParameters>) => void;
  isInVirtualHook?: boolean;
  virtualHookLossCount?: number;
  realConsecutiveLosses?: number;
  currency?: string;
}

export const VirtualHookSection: React.FC<VirtualHookSectionProps> = ({
  params,
  onUpdateParams,
}) => {
  const isEnabled = Boolean(params.virtualHookEnabled);
  const threshold = Math.max(1, params.virtualHookLossThreshold ?? 1);

  const handleToggle = () => {
    onUpdateParams({ virtualHookEnabled: !isEnabled });
  };

  const handleThresholdChange = (val: number) => {
    const safeVal = Math.max(1, Math.min(50, Math.floor(val) || 1));
    onUpdateParams({ virtualHookLossThreshold: safeVal });
  };

  return (
    <div
      id="virtual-hook-card"
      className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between transition-colors min-w-0"
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[11px] sm:text-xs font-semibold text-zinc-300 truncate">
          Virtual Hook
        </span>
        <span className={`text-[10px] font-mono font-bold ${isEnabled ? 'text-purple-400' : 'text-zinc-500'}`}>
          {isEnabled ? 'ON' : 'OFF'}
        </span>
      </div>
      <div className="flex items-center justify-between pt-0.5">
        <button
          type="button"
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            isEnabled ? 'bg-purple-600' : 'bg-zinc-700 hover:bg-zinc-600'
          }`}
          role="switch"
          aria-checked={isEnabled}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              isEnabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* If user switches it on, bring out input for number of consecutive losses */}
      {isEnabled && (
        <div className="mt-1 pt-1.5 border-t border-zinc-800/80 flex items-center justify-between gap-1.5">
          <label className="text-[10px] sm:text-[11px] text-zinc-400 truncate">
            Losses:
          </label>
          <input
            type="number"
            min="1"
            max="50"
            step="1"
            value={threshold}
            onChange={(e) => handleThresholdChange(Number(e.target.value))}
            className="w-12 sm:w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 sm:px-2 sm:py-1 text-[11px] sm:text-xs font-mono font-bold text-center text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
            placeholder="1"
          />
        </div>
      )}
    </div>
  );
};
