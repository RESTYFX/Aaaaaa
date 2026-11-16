import React, { useState } from 'react';
import { TradeParameters } from '../types';
import { Hash, ArrowRight, CheckCircle2, AlertCircle, Minimize2, Maximize2 } from 'lucide-react';
import { autoRecoveryStorage } from '../services/autoRecoveryStorage';

interface VirtualCountSectionProps {
  params: TradeParameters;
  onUpdateParams: (newParams: Partial<TradeParameters>) => void;
  isInVirtualCount?: boolean;
  virtualCountLosses?: number;
}

export const VirtualCountSection: React.FC<VirtualCountSectionProps> = ({
  params,
  onUpdateParams,
  isInVirtualCount = false,
  virtualCountLosses = 0,
}) => {
  const isEnabled = Boolean(params.virtualCountEnabled);
  const threshold = Math.max(1, params.virtualCountThreshold ?? 3);

  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    return autoRecoveryStorage.loadVirtualCountMinimized();
  });

  const handleToggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      autoRecoveryStorage.saveVirtualCountMinimized(next);
      return next;
    });
  };

  const handleToggle = () => {
    onUpdateParams({ virtualCountEnabled: !isEnabled });
  };

  const handleThresholdChange = (val: number) => {
    const safeVal = Math.max(1, Math.min(50, Math.floor(val) || 1));
    onUpdateParams({ virtualCountThreshold: safeVal });
  };

  return (
    <div
      id="virtual-count-card"
      className={`rounded-xl border transition-all p-2.5 sm:p-3 space-y-2.5 min-w-0 ${
        isEnabled
          ? 'bg-zinc-950/70 border-purple-500/40 shadow-sm shadow-purple-950/20'
          : 'bg-zinc-950/50 border-zinc-800/80'
      }`}
    >
      {/* Header Row: Title, Status Badge, Minimize Button & Toggle Switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
            isEnabled ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
          }`}>
            <Hash className="w-3 h-3" />
          </div>
          <span className="text-[11px] sm:text-xs font-semibold text-zinc-200 truncate">
            Virtual Count
          </span>
          {isEnabled && (
            <span
              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 flex items-center gap-1 ${
                isInVirtualCount
                  ? 'text-purple-300 bg-purple-500/20 border-purple-500/40 animate-pulse'
                  : 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30'
              }`}
            >
              {isInVirtualCount ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                  <span>Virtual ({virtualCountLosses}/{threshold} Losses)</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                  <span>Real Account Active</span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Action Controls: Minimize Button & Toggle Switch */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            id="toggle-minimize-virtual-count-btn"
            onClick={handleToggleMinimize}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800/80 transition-colors cursor-pointer"
            title={isMinimized ? 'Expand Virtual Count box' : 'Minimize Virtual Count box'}
          >
            {isMinimized ? (
              <>
                <Maximize2 className="w-3 h-3 text-purple-400" />
                <span className="hidden xs:inline text-[9px] font-mono">Expand</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3 h-3 text-zinc-400" />
                <span className="hidden xs:inline text-[9px] font-mono">Minimize</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-1 pl-1 border-l border-zinc-800/80">
            <span className={`text-[10px] font-mono font-bold ${isEnabled ? 'text-purple-400' : 'text-zinc-500'}`}>
              {isEnabled ? 'ON' : 'OFF'}
            </span>
            <button
              id="toggle-virtual-count-btn"
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={handleToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isEnabled ? 'bg-purple-600' : 'bg-zinc-700 hover:bg-zinc-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* When Virtual Count is Enabled and NOT Minimized */}
      {isEnabled && !isMinimized && (
        <div className="space-y-2 pt-1 border-t border-zinc-800/80">
          {/* Controls Row: Input & Quick Presets */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="virtual-count-input" className="text-[11px] sm:text-xs font-semibold text-zinc-300">
                Consecutive Losses:
              </label>
              <input
                id="virtual-count-input"
                type="number"
                min="1"
                max="50"
                step="1"
                value={threshold}
                onChange={(e) => handleThresholdChange(Number(e.target.value))}
                className="w-14 sm:w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-mono text-zinc-500 mr-0.5">Presets:</span>
              {[1, 2, 3, 4, 5].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleThresholdChange(preset)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                    threshold === preset
                      ? 'bg-purple-500/30 text-purple-200 border border-purple-500/60'
                      : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Visual Loss Counting Track */}
          <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/70 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-zinc-400 font-medium">Virtual Loss Sequence:</span>
              <span className="text-zinc-300 font-bold">
                {isInVirtualCount ? `${virtualCountLosses} / ${threshold} Counted` : 'Switched to Real'}
              </span>
            </div>

            {/* Step Blocks */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              {Array.from({ length: Math.min(10, threshold) }).map((_, idx) => {
                const stepNum = idx + 1;
                const isHit = isInVirtualCount && virtualCountLosses >= stepNum;
                const isCurrent = isInVirtualCount && virtualCountLosses === idx;

                return (
                  <div
                    key={stepNum}
                    className={`flex-1 min-w-[36px] py-1 px-1 rounded flex flex-col items-center justify-center border text-[9px] font-mono transition-all ${
                      isHit
                        ? 'bg-rose-950/60 border-rose-500/60 text-rose-300'
                        : isCurrent
                        ? 'bg-purple-950/60 border-purple-500/80 text-purple-200 ring-1 ring-purple-500/50 animate-pulse'
                        : 'bg-zinc-950/40 border-zinc-800 text-zinc-500'
                    }`}
                  >
                    <span className="text-[8px] opacity-75">Loss</span>
                    <span className="font-bold">#{stepNum}</span>
                  </div>
                );
              })}

              <ArrowRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />

              {/* Real Account Target Box */}
              <div
                className={`min-w-[68px] py-1 px-1.5 rounded flex flex-col items-center justify-center border text-[9px] font-mono transition-all ${
                  !isInVirtualCount
                    ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/60 shadow-sm animate-pulse'
                    : 'bg-zinc-950/50 border-zinc-800 text-zinc-500'
                }`}
              >
                <span className="text-[8px] opacity-75">Switches to</span>
                <span className="font-bold text-white whitespace-nowrap">Real Account</span>
              </div>
            </div>

            {/* Live Explanatory Status Note */}
            <div className="flex items-center gap-1.5 text-[9px] text-zinc-400 pt-0.5 border-t border-zinc-800/60">
              {isInVirtualCount ? (
                <>
                  <AlertCircle className="w-3 h-3 text-purple-400 shrink-0" />
                  <span>
                    Trading virtually ($0.00 risk). After {threshold} consecutive losses, trading automatically switches to real funds.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>
                    Real account trade active! Trading continues on real account until profit (win), then automatically returns to virtual count.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
