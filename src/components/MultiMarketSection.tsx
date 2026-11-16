import React, { useState } from 'react';
import { VOLATILITY_MARKETS } from '../data/markets';
import { MultiMarketScanItem, MarketMartingaleState } from '../types';
import { Layers, CheckSquare, Square, Eye, TrendingUp, TrendingDown, Minus, Zap, Lock, Maximize2, Minimize2, RotateCcw, GitBranch, Sparkles } from 'lucide-react';
import { autoRecoveryStorage } from '../services/autoRecoveryStorage';

interface MultiMarketSectionProps {
  multiMarketEnabled: boolean;
  onToggleMultiMarket: (enabled: boolean) => void;
  selectedMarkets: string[];
  onToggleMarket: (symbol: string) => void;
  onSelectAllMarkets: (symbols: string[]) => void;
  onClearAllMarkets: () => void;
  marketScanStatus: Record<string, MultiMarketScanItem>;
  currentSymbol: string;
  currentSymbolName: string;
  activeTradeSymbol?: string;
  activeTradeSymbols?: string[];
  onViewChart: (symbol: string, name: string) => void;
  isAutoTrading: boolean;
  recoveryLockedMarket?: { symbol: string; symbolName: string } | null;
  onUnlockMarkets?: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: (maximized: boolean) => void;
  individualMultiMarketEnabled?: boolean;
  onToggleIndividualMultiMarket?: (enabled: boolean) => void;
  maxConcurrentTrades?: number;
  onUpdateMaxConcurrentTrades?: (count: number) => void;
  marketMartingaleStates?: Record<string, MarketMartingaleState>;
  onResetAllMarketMartingales?: () => void;
  baseStake?: number;
}

export const MultiMarketSection: React.FC<MultiMarketSectionProps> = ({
  multiMarketEnabled,
  onToggleMultiMarket,
  selectedMarkets,
  onToggleMarket,
  onSelectAllMarkets,
  onClearAllMarkets,
  marketScanStatus,
  currentSymbol,
  currentSymbolName,
  activeTradeSymbol,
  activeTradeSymbols = [],
  onViewChart,
  isAutoTrading,
  recoveryLockedMarket,
  onUnlockMarkets,
  isMaximized: controlledMaximized,
  onToggleMaximize: controlledToggleMaximize,
  individualMultiMarketEnabled = false,
  onToggleIndividualMultiMarket = () => {},
  maxConcurrentTrades = 1,
  onUpdateMaxConcurrentTrades,
  marketMartingaleStates = {},
  onResetAllMarketMartingales,
  baseStake = 1.0,
}) => {
  // Always load minimized state from autoRecoveryStorage so it survives auto-refresh
  const [internalMaximized, setInternalMaximized] = useState<boolean>(() => {
    return autoRecoveryStorage.loadMultiMarketMaximized();
  });

  const isMaximized = controlledMaximized !== undefined ? controlledMaximized : internalMaximized;

  const handleToggleMaximize = (nextValue?: boolean) => {
    const updated = typeof nextValue === 'boolean' ? nextValue : !isMaximized;
    setInternalMaximized(updated);
    autoRecoveryStorage.saveMultiMarketMaximized(updated);
    if (controlledToggleMaximize) {
      controlledToggleMaximize(updated);
    }
  };

  const allSymbols = VOLATILITY_MARKETS.map((m) => m.symbol);
  const standardSymbols = VOLATILITY_MARKETS.filter((m) => m.category === 'standard').map((m) => m.symbol);
  const oneSecSymbols = VOLATILITY_MARKETS.filter((m) => m.category === '1s').map((m) => m.symbol);
  const stepSymbols = VOLATILITY_MARKETS.filter((m) => m.category === 'step').map((m) => m.symbol);
  const jumpSymbols = VOLATILITY_MARKETS.filter((m) => m.category === 'jump').map((m) => m.symbol);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 sm:p-4 backdrop-blur-sm">
      {/* Header with Title and Toggle Switch */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-zinc-800/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] sm:text-xs font-bold text-white tracking-wide truncate">
            Multi-Market Trading &amp; Scanner
          </span>
          {multiMarketEnabled && (
            <span className="text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
              {selectedMarkets.length}
            </span>
          )}
        </div>

        {/* Action Controls: Minimize/Maximize button & Toggle Switch */}
        <div className="flex items-center gap-2 shrink-0">
          {multiMarketEnabled && (
            <button
              type="button"
              id="toggle-maximize-multimarket-btn"
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
                  <Maximize2 className="w-3 h-3 text-indigo-400" />
                  <span>Maximize</span>
                </>
              )}
            </button>
          )}

          {/* Toggle Switch */}
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-mono font-bold ${multiMarketEnabled ? 'text-indigo-400' : 'text-zinc-500'}`}>
              {multiMarketEnabled ? 'ON' : 'OFF'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={multiMarketEnabled}
              onClick={() => {
                const next = !multiMarketEnabled;
                onToggleMultiMarket(next);
                if (next) {
                  handleToggleMaximize(true);
                }
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                multiMarketEnabled ? 'bg-indigo-600' : 'bg-zinc-700 hover:bg-zinc-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  multiMarketEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Content depending on state */}
      {!multiMarketEnabled ? (
        <div className="mt-2.5 p-2.5 bg-zinc-950/60 border border-zinc-800/80 rounded-lg flex items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
            <span className="truncate text-[11px]">
              Single Market: <strong className="text-white font-mono">{currentSymbolName}</strong>
            </span>
          </div>
          <span className="text-[10px] text-zinc-500">Enable Multi-Market above to scan all volatilities</span>
        </div>
      ) : !isMaximized ? (
        /* Minimized View when Multi-Market is ON */
        <div className="mt-2.5 p-2.5 bg-zinc-950/60 border border-zinc-800/80 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse"></span>
            <span className="truncate text-xs">
              Multi-Market: <strong className="text-indigo-300 font-mono">{selectedMarkets.length} markets active</strong>
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
              individualMultiMarketEnabled
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}>
              {individualMultiMarketEnabled ? 'Individual Martingale ON' : 'Global Martingale'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleToggleMaximize(true)}
            className="px-2.5 py-1 text-xs text-white bg-indigo-600/90 hover:bg-indigo-500 font-semibold rounded-lg shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Show All Individual Markets &amp; Martingale Status</span>
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3.5">
          {/* Individual Multi-Market Feature Card */}
          <div className="p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/40 via-purple-950/25 to-zinc-950/60 border border-indigo-500/40 shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                  <GitBranch className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs sm:text-sm font-bold text-white tracking-wide">
                      Individual Multi-Market
                    </span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                      individualMultiMarketEnabled
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                    }`}>
                      {individualMultiMarketEnabled ? 'Independent Martingale' : 'Shared Global Martingale'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Each enabled market operates with its own independent Martingale progression, loss storage, and post-martingale pause. Allows concurrent trades across markets.
                  </p>
                </div>
              </div>

              {/* Toggle Switch */}
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <span className={`text-xs font-mono font-bold ${individualMultiMarketEnabled ? 'text-indigo-400' : 'text-zinc-500'}`}>
                  {individualMultiMarketEnabled ? 'ON' : 'OFF'}
                </span>
                <button
                  id="toggle-individual-multi-market-btn"
                  type="button"
                  role="switch"
                  aria-checked={individualMultiMarketEnabled}
                  onClick={() => onToggleIndividualMultiMarket(!individualMultiMarketEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    individualMultiMarketEnabled ? 'bg-indigo-600' : 'bg-zinc-700 hover:bg-zinc-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      individualMultiMarketEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Trade at a time setting */}
            <div className="pt-2.5 border-t border-indigo-500/20 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <div>
                  <label htmlFor="trade-at-a-time-input" className="text-xs font-semibold text-zinc-200 cursor-pointer">
                    Trade at a time
                  </label>
                  <p className="text-[10px] text-zinc-400">
                    Max active trades allowed simultaneously ({maxConcurrentTrades} max)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  id="trade-at-a-time-input"
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={maxConcurrentTrades}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onUpdateMaxConcurrentTrades?.(isNaN(val) ? 1 : Math.max(1, Math.min(10, val)));
                  }}
                  className="w-16 bg-zinc-900/90 border border-indigo-500/40 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-center text-white focus:outline-none focus:ring-1 focus:ring-indigo-400 shadow-inner"
                  placeholder="1"
                />
              </div>
            </div>

            {/* Active individual states summary if enabled */}
            {individualMultiMarketEnabled && (
              <div className="pt-2 border-t border-indigo-500/20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2 text-zinc-300">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>
                    Active trades: <strong className="text-emerald-400">{activeTradeSymbols.length} / {maxConcurrentTrades} running</strong> • Independent Martingales
                  </span>
                </div>
                {onResetAllMarketMartingales && Object.values(marketMartingaleStates).some((s) => s && (s.currentMartingaleStep > 0 || (s.accumulatedLoss || 0) > 0 || s.isPausedAwaitingSignal)) && (
                  <button
                    type="button"
                    onClick={onResetAllMarketMartingales}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset All Market Martingales</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quick Filter Selection Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-400 text-[11px] font-medium mr-1">Quick Select:</span>
              <button
                type="button"
                onClick={() => onSelectAllMarkets(allSymbols)}
                className="px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium border border-zinc-700/60 transition-colors"
              >
                All Markets ({allSymbols.length})
              </button>
              <button
                type="button"
                onClick={() => onSelectAllMarkets(standardSymbols)}
                className="px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium border border-zinc-700/60 transition-colors"
              >
                Standard VIX ({standardSymbols.length})
              </button>
              <button
                type="button"
                onClick={() => onSelectAllMarkets(oneSecSymbols)}
                className="px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium border border-zinc-700/60 transition-colors"
              >
                1-Sec VIX ({oneSecSymbols.length})
              </button>
              <button
                type="button"
                onClick={() => onSelectAllMarkets(stepSymbols)}
                className="px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-cyan-300 text-[11px] font-medium border border-cyan-800/50 transition-colors"
              >
                Step Indices ({stepSymbols.length})
              </button>
              <button
                type="button"
                onClick={() => onSelectAllMarkets(jumpSymbols)}
                className="px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-purple-300 text-[11px] font-medium border border-purple-800/50 transition-colors"
              >
                Jump Indices ({jumpSymbols.length})
              </button>
              <button
                type="button"
                onClick={onClearAllMarkets}
                className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 text-[11px] font-medium border border-zinc-800 transition-colors"
              >
                Clear All
              </button>
            </div>
            <div className="text-[11px] font-mono text-zinc-400">
              <span className="text-indigo-400 font-semibold">{selectedMarkets.length}</span> / {VOLATILITY_MARKETS.length} ticked
            </div>
          </div>

          {/* Recovery Locked Market Banner (Only shown when Individual Multi-Market is OFF and bot is locked) */}
          {!individualMultiMarketEnabled && recoveryLockedMarket && (
            <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-lg flex items-center justify-between gap-3 text-xs text-amber-200 shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-amber-500/20 text-amber-400 shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <span>Martingale Recovery Locked:</span>
                    <span className="text-amber-400 underline decoration-amber-400/50">
                      {recoveryLockedMarket.symbolName} ({recoveryLockedMarket.symbol})
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Bot is strictly executing recovery trades on this volatility. Other markets are bypassed until this recovery cycle wins or hits the post-loss pause target.
                  </p>
                </div>
              </div>
              {onUnlockMarkets && (
                <button
                  type="button"
                  onClick={onUnlockMarkets}
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors shrink-0"
                >
                  Free All Markets
                </button>
              )}
            </div>
          )}

          {/* Market Checkboxes Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {VOLATILITY_MARKETS.map((market) => {
              const isChecked = selectedMarkets.includes(market.symbol);
              const scan = marketScanStatus[market.symbol];
              const isTradedNow = activeTradeSymbol === market.symbol || activeTradeSymbols.includes(market.symbol);
              const isArmed = Boolean(scan?.armedBreak);
              const isChartActive = currentSymbol === market.symbol;
              const isLockedMarket = !individualMultiMarketEnabled && recoveryLockedMarket?.symbol === market.symbol;
              const isOtherMarketDuringLock = !individualMultiMarketEnabled && Boolean(recoveryLockedMarket && !isLockedMarket);
              const mState = marketMartingaleStates[market.symbol];

              return (
                <div
                  key={market.symbol}
                  className={`relative p-3 rounded-lg border transition-all flex flex-col justify-between gap-2 ${
                    isLockedMarket
                      ? 'bg-amber-950/40 border-amber-500/80 ring-1 ring-amber-500/60 shadow-lg shadow-amber-500/10'
                      : isTradedNow
                      ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/40 shadow-lg shadow-emerald-500/10'
                      : isArmed
                      ? 'bg-amber-950/30 border-amber-500/50 shadow-md shadow-amber-500/10'
                      : isChecked
                      ? isOtherMarketDuringLock
                        ? 'bg-zinc-950/60 border-zinc-800/80 opacity-70'
                        : 'bg-zinc-950/80 border-zinc-700/80 hover:border-zinc-600'
                      : 'bg-zinc-950/40 border-zinc-800/60 opacity-50 hover:opacity-90'
                  }`}
                >
                  {/* Top row: Checkbox + Name + Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleMarket(market.symbol)}
                        className="sr-only"
                      />
                      <span className="text-zinc-400 hover:text-white transition-colors">
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-indigo-400 fill-indigo-400/20" />
                        ) : (
                          <Square className="w-4 h-4 text-zinc-500" />
                        )}
                      </span>
                      <span className="text-xs font-bold text-white tracking-tight">
                        {market.shortName}
                      </span>
                    </label>

                    <div className="flex items-center gap-1">
                      {market.category === 'step' && (
                        <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          Step
                        </span>
                      )}
                      {market.category === 'jump' && (
                        <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          Jump
                        </span>
                      )}
                      {market.category === '1s' && (
                        <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          1s
                        </span>
                      )}
                      {isLockedMarket && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Locked
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                        {market.symbol}
                      </span>
                    </div>
                  </div>

                  {/* Middle row: Live Quote & SMC Trend */}
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-300 font-semibold">
                      {scan?.lastQuote !== undefined ? scan.lastQuote.toFixed(2) : '---'}
                    </span>

                    {/* Trend indicator */}
                    <div className="flex items-center gap-1 text-[11px]">
                      {scan?.trend === 'BULLISH' ? (
                        <span className="flex items-center gap-0.5 text-emerald-400 font-semibold">
                          <TrendingUp className="w-3 h-3" /> Bullish
                        </span>
                      ) : scan?.trend === 'BEARISH' ? (
                        <span className="flex items-center gap-0.5 text-rose-400 font-semibold">
                          <TrendingDown className="w-3 h-3" /> Bearish
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-zinc-500">
                          <Minus className="w-3 h-3" /> Neutral
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Individual Multi-Market Martingale State Line */}
                  {individualMultiMarketEnabled && isChecked && (
                    <div className="py-1 px-1.5 rounded bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">Martingale:</span>
                      {mState && mState.isPausedAwaitingSignal ? (
                        <span className="font-bold text-purple-300 bg-purple-500/20 px-1.5 py-0.2 rounded border border-purple-500/40">
                          Paused (Awaiting Signal)
                        </span>
                      ) : mState && mState.currentMartingaleStep > 0 ? (
                        <span className="font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-500/40">
                          Step {mState.currentMartingaleStep} (-${(mState.accumulatedLoss || 0).toFixed(2)})
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-semibold">
                          Base (${baseStake.toFixed(2)})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Bottom row: Status Tag & View Chart button */}
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px]">
                    {/* Status Badge */}
                    {isTradedNow ? (
                      <span className="flex items-center gap-1 font-bold text-emerald-400 uppercase animate-pulse">
                        <Zap className="w-3 h-3 fill-emerald-400" /> Trading Now
                      </span>
                    ) : individualMultiMarketEnabled && isChecked && mState?.isPausedAwaitingSignal ? (
                      <span className="flex items-center gap-1 font-bold text-purple-400 uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                        Paused (Awaiting Signal)
                      </span>
                    ) : isLockedMarket ? (
                      <span className="flex items-center gap-1 font-bold text-amber-400 uppercase animate-pulse">
                        <Lock className="w-3 h-3" /> In Recovery
                      </span>
                    ) : isOtherMarketDuringLock && isChecked ? (
                      <span className="text-zinc-500 italic">
                        Bypassed (Locked)
                      </span>
                    ) : isArmed ? (
                      <span className="flex items-center gap-1 font-bold text-amber-400 uppercase animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                        Armed ({scan.armedBreak?.type} Close)
                      </span>
                    ) : isChecked && isAutoTrading ? (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Scanning BOS/CHoCH
                      </span>
                    ) : isChecked ? (
                      <span className="text-zinc-500">Ready to trade</span>
                    ) : (
                      <span className="text-zinc-600">Unticked</span>
                    )}

                    {/* View Chart Button */}
                    <button
                      type="button"
                      onClick={() => onViewChart(market.symbol, market.name)}
                      title={`View ${market.name} chart`}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                        isChartActive
                          ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                      }`}
                    >
                      <Eye className="w-2.5 h-2.5" />
                      <span>{isChartActive ? 'On Chart' : 'Chart'}</span>
                    </button>
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
