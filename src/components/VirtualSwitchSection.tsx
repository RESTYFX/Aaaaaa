import React, { useState } from 'react';
import { TradeParameters } from '../types';
import { CheckSquare, Square, ToggleRight, Minimize2, Maximize2 } from 'lucide-react';
import { autoRecoveryStorage } from '../services/autoRecoveryStorage';

interface VirtualSwitchSectionProps {
  params: TradeParameters;
  onUpdateParams: (newParams: Partial<TradeParameters>) => void;
  currentStage?: number;
  stageProfit?: number;
  isInVirtualSwitch?: boolean;
  realConsecutiveLosses?: number;
}

export const VirtualSwitchSection: React.FC<VirtualSwitchSectionProps> = ({
  params,
  onUpdateParams,
  currentStage = 1,
  stageProfit = 0,
  isInVirtualSwitch = false,
  realConsecutiveLosses = 0,
}) => {
  const isEnabled = Boolean(params.virtualSwitchEnabled);
  const selectedBoxes: number[] = Array.isArray(params.virtualSwitchBoxes) && params.virtualSwitchBoxes.length > 0
    ? params.virtualSwitchBoxes
    : [1, 2, 3];
  const takeProfitVal = params.virtualSwitchTakeProfit ?? 0.5;

  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    return autoRecoveryStorage.loadVirtualSwitchMinimized();
  });

  const handleToggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      autoRecoveryStorage.saveVirtualSwitchMinimized(next);
      return next;
    });
  };

  const handleToggle = () => {
    onUpdateParams({ virtualSwitchEnabled: !isEnabled });
  };

  const handleToggleBox = (boxNum: number) => {
    let nextBoxes: number[];
    if (selectedBoxes.includes(boxNum)) {
      // If only 1 box left, do not allow unchecking all
      if (selectedBoxes.length <= 1) return;
      nextBoxes = selectedBoxes.filter((b) => b !== boxNum);
    } else {
      nextBoxes = [...selectedBoxes, boxNum].sort((a, b) => a - b);
    }
    onUpdateParams({ virtualSwitchBoxes: nextBoxes });
  };

  const handleTakeProfitChange = (val: number) => {
    const safeVal = Math.max(0.1, Number(val) || 0.1);
    onUpdateParams({ virtualSwitchTakeProfit: safeVal });
  };

  return (
    <div
      id="virtual-switch-card"
      className={`rounded-xl border transition-all p-2.5 sm:p-3 space-y-2.5 min-w-0 ${
        isEnabled
          ? 'bg-zinc-950/70 border-emerald-500/40 shadow-sm shadow-emerald-950/20'
          : 'bg-zinc-950/50 border-zinc-800/80'
      }`}
    >
      {/* Header Row: Title, Status Badge, Minimize Button & Toggle Switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
            isEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
          }`}>
            <ToggleRight className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] sm:text-xs font-semibold text-zinc-200 truncate">
            Virtual Switch
          </span>
          {isEnabled && (
            <span
              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                isInVirtualSwitch
                  ? 'text-purple-300 bg-purple-500/20 border-purple-500/40 animate-pulse'
                  : 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30'
              }`}
            >
              {isInVirtualSwitch
                ? `Virtual (Box ${currentStage})`
                : `Box ${currentStage} (+$${stageProfit.toFixed(2)}/+$${takeProfitVal.toFixed(2)})`}
            </span>
          )}
        </div>

        {/* Action Controls: Minimize Button & Toggle Switch */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            id="toggle-minimize-virtual-switch-btn"
            onClick={handleToggleMinimize}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800/80 transition-colors cursor-pointer"
            title={isMinimized ? 'Expand Virtual Switch box' : 'Minimize Virtual Switch box'}
          >
            {isMinimized ? (
              <>
                <Maximize2 className="w-3 h-3 text-emerald-400" />
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
            <span className={`text-[10px] font-mono font-bold ${isEnabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {isEnabled ? 'ON' : 'OFF'}
            </span>
            <button
              id="toggle-virtual-switch-btn"
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={handleToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isEnabled ? 'bg-emerald-600' : 'bg-zinc-700 hover:bg-zinc-600'
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

      {/* When Virtual Switch is Enabled and NOT Minimized */}
      {isEnabled && !isMinimized && (
        <div className="space-y-2 pt-1 border-t border-zinc-800/80">
          {/* 5 Small Checkbox Boxes */}
          <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
            {[1, 2, 3, 4, 5].map((boxNum) => {
              const isChecked = selectedBoxes.includes(boxNum);
              const isCurrent = currentStage === boxNum;

              return (
                <button
                  key={boxNum}
                  type="button"
                  id={`virtual-switch-box-${boxNum}`}
                  onClick={() => handleToggleBox(boxNum)}
                  className={`flex flex-col items-center justify-center py-1 sm:py-1.5 px-1 rounded-lg border text-center transition-all cursor-pointer select-none ${
                    isChecked
                      ? isCurrent
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/60 shadow-sm shadow-emerald-950/40'
                        : 'bg-zinc-900 border-zinc-700 hover:border-zinc-600 text-zinc-200'
                      : 'bg-zinc-950/40 border-zinc-800/80 hover:border-zinc-700/60 text-zinc-500 opacity-60'
                  }`}
                  title={`Toggle Box ${boxNum} (${boxNum} consecutive loss threshold)`}
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    {isChecked ? (
                      <CheckSquare className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <Square className="w-3 h-3 text-zinc-600 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] sm:text-[11px] font-bold font-mono whitespace-nowrap">
                    Box {boxNum}
                  </span>
                  <span className="text-[8px] text-zinc-400 font-mono">
                    {boxNum} {boxNum === 1 ? 'loss' : 'losses'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Real account loss tracker & take profit row */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/60 px-2.5 py-1.5 rounded-lg border border-zinc-800/70">
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-[11px] font-semibold text-zinc-300">
                Current Losses:
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700">
                {realConsecutiveLosses} / {currentStage}
              </span>
              <span className="text-[9px] text-zinc-400">
                {isInVirtualSwitch
                  ? '(In Virtual: 1 virtual win returns to real)'
                  : `(Switches to virtual at ${currentStage} loss${currentStage > 1 ? 'es' : ''})`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="virtual-switch-tp-input"
                className="text-[11px] sm:text-xs font-semibold text-zinc-300 truncate"
              >
                Stage Take Profit:
              </label>
              <div className="relative w-20 sm:w-24">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">$</span>
                <input
                  id="virtual-switch-tp-input"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={takeProfitVal}
                  onChange={(e) => handleTakeProfitChange(parseFloat(e.target.value) || 0.1)}
                  className="w-full bg-zinc-950 border border-zinc-700/80 rounded pl-5 pr-2 py-0.5 text-xs font-mono font-bold text-white text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="0.50"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
