import React, { useState } from 'react';
import {
  GitFork,
  Maximize2,
  Minimize2,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { TradeParameters, InInterModeConfig, DEFAULT_IN_INTER_MODES, normalizeModesConfig } from '../types';
import { autoRecoveryStorage } from '../services/autoRecoveryStorage';

interface InInterModeMartingaleSectionProps {
  params: TradeParameters;
  onUpdateParams: (newParams: Partial<TradeParameters>) => void;
  currentMode?: number;
  maxModeReached?: number;
  inModeLossCount?: number;
  modeFirstStake?: number;
  modeAccumulatedLoss?: number;
  currentCalculatedStake?: number;
  currency?: string;
}

export const InInterModeMartingaleSection: React.FC<InInterModeMartingaleSectionProps> = ({
  params,
  onUpdateParams,
  currentMode = 0,
  maxModeReached = 0,
  inModeLossCount = 0,
  modeFirstStake = 0,
  modeAccumulatedLoss = 0,
  currentCalculatedStake = 0,
}) => {
  const [isMaximized, setIsMaximized] = useState<boolean>(() => {
    return autoRecoveryStorage.loadInInterModeMaximized();
  });
  const [consecDraft, setConsecDraft] = useState<string | null>(null);
  const [modeDrafts, setModeDrafts] = useState<Record<string, string>>({});

  const handleToggleMaximize = (nextVal?: boolean) => {
    const updated = typeof nextVal === 'boolean' ? nextVal : !isMaximized;
    setIsMaximized(updated);
    autoRecoveryStorage.saveInInterModeMaximized(updated);
  };

  const isEnabled = Boolean(params.inInterModeEnabled);
  const consecutivesToSwitch = params.consecutivesToSwitchMode ?? 3;
  const modes: InInterModeConfig[] = normalizeModesConfig(params.modesConfig);

  const handleUpdateMode = (index: number, field: 'inModeMartingale' | 'steps', value: number) => {
    const updated = modes.map((m, idx) => {
      if (idx === index) {
        if (field === 'steps') {
          return {
            ...m,
            steps: Math.max(1, Math.min(100, Math.round(value))),
          };
        }
        return {
          ...m,
          inModeMartingale: Math.max(1.0, Math.min(10, Number(value.toFixed(2)))),
        };
      }
      return m;
    });
    onUpdateParams({ modesConfig: updated });
  };

  const handleResetDefaults = () => {
    setConsecDraft(null);
    setModeDrafts({});
    onUpdateParams({
      modesConfig: DEFAULT_IN_INTER_MODES,
      consecutivesToSwitchMode: 3,
    });
  };

  return (
    <div
      id="in-inter-mode-card"
      className={`rounded-xl border transition-all ${
        isEnabled
          ? 'bg-zinc-950/70 border-cyan-500/40 shadow-sm shadow-cyan-950/20'
          : 'bg-zinc-950/50 border-zinc-800/80'
      } p-2.5 sm:p-3 space-y-2.5`}
    >
      {/* Header Row: Title, Toggle switch & Maximize/Minimize */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
          <GitFork className={`w-3.5 h-3.5 shrink-0 ${isEnabled ? 'text-cyan-400' : 'text-zinc-500'}`} />
          <span className="text-[11px] sm:text-xs font-semibold text-zinc-200 truncate">
            In-Mode &amp; Steps Martingale
          </span>
          {isEnabled && (
            <>
              <span className="text-[9px] font-mono font-bold text-cyan-300 bg-cyan-500/20 px-1.5 py-0.5 rounded border border-cyan-500/30 shrink-0">
                {currentMode > 0 ? (
                  <>
                    Current: Mode {currentMode} ({inModeLossCount}/{consecutivesToSwitch}) • 1st: ${modeFirstStake.toFixed(2)} • Rem: ${modeAccumulatedLoss.toFixed(2)}
                    {currentCalculatedStake > 0 ? ` • Next: $${currentCalculatedStake.toFixed(2)}` : ''}
                  </>
                ) : (
                  'Current: Default'
                )}
              </span>
              <span
                id="in-inter-max-mode-badge"
                className="text-[9px] font-mono font-bold text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/35 shrink-0"
                title="Highest mode reached so far in In-Mode & Steps Martingale"
              >
                Max Mode: {Math.max(maxModeReached, currentMode) > 0 ? `Mode ${Math.max(maxModeReached, currentMode)}` : '0'}
              </span>
            </>
          )}
        </div>

        {/* Action Controls: Minimize/Maximize button & Toggle switch */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Maximize / Minimize Button */}
          <button
            type="button"
            id="toggle-maximize-modes-btn"
            onClick={() => handleToggleMaximize()}
            className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 transition-all cursor-pointer"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? (
              <>
                <Minimize2 className="w-3 h-3 text-zinc-400" />
                <span>Minimize</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3 text-cyan-400" />
                <span>Maximize</span>
              </>
            )}
          </button>

          {/* Toggle Switch */}
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-mono font-bold ${isEnabled ? 'text-cyan-400' : 'text-zinc-500'}`}>
              {isEnabled ? 'ON' : 'OFF'}
            </span>
            <button
              id="toggle-in-inter-mode-btn"
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={() => {
                const nextState = !isEnabled;
                onUpdateParams({ inInterModeEnabled: nextState });
                const persistedState = autoRecoveryStorage.loadInInterModeMaximized();
                if (nextState && persistedState) {
                  handleToggleMaximize(true);
                }
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isEnabled ? 'bg-cyan-600' : 'bg-zinc-700 hover:bg-zinc-600'
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

      {/* When Maximized: Show configuration without unnecessary info or clutter */}
      {isMaximized && (
        <div className="space-y-2.5 pt-1 border-t border-zinc-800/80">
          {/* Consecutive Losses to Switch */}
          <div className="flex items-center justify-between gap-2 bg-zinc-900/60 px-2.5 py-1.5 rounded-lg border border-zinc-800/70">
            <label
              htmlFor="consecutive-switch-input"
              className="text-[11px] sm:text-xs font-semibold text-zinc-300 flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Consecutive Losses to Switch:</span>
            </label>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                id="consecutive-switch-input"
                type="number"
                min="1"
                max="10"
                step="1"
                value={consecDraft !== null ? consecDraft : String(consecutivesToSwitch)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setConsecDraft(raw);
                  const parsed = parseInt(raw, 10);
                  if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
                    onUpdateParams({ consecutivesToSwitchMode: parsed });
                  }
                }}
                onBlur={() => {
                  const parsed = parseInt(consecDraft ?? '', 10);
                  const clamped = isNaN(parsed) ? consecutivesToSwitch : Math.max(1, Math.min(10, parsed));
                  setConsecDraft(null);
                  onUpdateParams({ consecutivesToSwitchMode: clamped });
                }}
                className="w-14 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-xs font-mono font-bold text-center text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <span className="text-[10px] text-zinc-500 font-mono">losses</span>
            </div>
          </div>

          {/* Header for 10 Modes */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-zinc-400">
              10 Modes (In-Mode &amp; Steps)
            </span>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Grid of 10 Modes (2 columns on mobile, 5 on larger screens) */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {modes.map((modeConfig, idx) => {
              const modeNumber = idx + 1;
              const isCurrentMode = currentMode === modeNumber;
              const inKey = `${idx}-in`;
              const stepsKey = `${idx}-steps`;

              return (
                <div
                  key={`mode-box-${modeNumber}`}
                  className={`p-2 rounded-lg border transition-all ${
                    isCurrentMode
                      ? 'bg-cyan-950/40 border-cyan-400 ring-1 ring-cyan-500/40'
                      : 'bg-zinc-950/80 border-zinc-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-white">
                      Mode {modeNumber}
                    </span>
                    {isCurrentMode && (
                      <span className="text-[8px] font-bold uppercase px-1 rounded bg-cyan-500/20 text-cyan-300">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div>
                      <span className="text-[10px] text-zinc-400 block mb-0.5">In-Mode:</span>
                      <div className="relative">
                        <input
                          id={`in-mode-input-${modeNumber}`}
                          type="number"
                          step="0.05"
                          min="1.0"
                          max="10"
                          value={inKey in modeDrafts ? modeDrafts[inKey] : String(modeConfig.inModeMartingale)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setModeDrafts((prev) => ({ ...prev, [inKey]: raw }));
                            const parsed = parseFloat(raw);
                            if (!isNaN(parsed) && parsed >= 1.0 && parsed <= 10) {
                              handleUpdateMode(idx, 'inModeMartingale', parsed);
                            }
                          }}
                          onBlur={() => {
                            const raw = modeDrafts[inKey];
                            if (raw !== undefined) {
                              const parsed = parseFloat(raw);
                              const fallback = DEFAULT_IN_INTER_MODES[idx]?.inModeMartingale ?? 1.4;
                              handleUpdateMode(
                                idx,
                                'inModeMartingale',
                                !isNaN(parsed) ? parsed : fallback
                              );
                              setModeDrafts((prev) => {
                                const next = { ...prev };
                                delete next[inKey];
                                return next;
                              });
                            }
                          }}
                          className="w-full bg-zinc-900 border border-zinc-700/80 rounded px-1.5 py-0.5 pr-4 text-[11px] font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 text-[9px] font-mono">
                          x
                        </span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] text-cyan-300 block mb-0.5">Steps:</span>
                      <div className="relative">
                        <input
                          id={`steps-mode-input-${modeNumber}`}
                          type="number"
                          step="1"
                          min="1"
                          max="100"
                          value={stepsKey in modeDrafts ? modeDrafts[stepsKey] : String(modeConfig.steps)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setModeDrafts((prev) => ({ ...prev, [stepsKey]: raw }));
                            const parsed = parseInt(raw, 10);
                            if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                              handleUpdateMode(idx, 'steps', parsed);
                            }
                          }}
                          onBlur={() => {
                            const raw = modeDrafts[stepsKey];
                            if (raw !== undefined) {
                              const parsed = parseInt(raw, 10);
                              const fallback = DEFAULT_IN_INTER_MODES[idx]?.steps ?? 5;
                              handleUpdateMode(
                                idx,
                                'steps',
                                !isNaN(parsed) ? parsed : fallback
                              );
                              setModeDrafts((prev) => {
                                const next = { ...prev };
                                delete next[stepsKey];
                                return next;
                              });
                            }
                          }}
                          className="w-full bg-zinc-900 border border-zinc-700/80 rounded px-1.5 py-0.5 text-[11px] font-mono font-bold text-cyan-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
