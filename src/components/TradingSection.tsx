import React from 'react';
import { TradeParameters, TradingStrategy, MultiMarketScanItem, MarketMartingaleState } from '../types';
import { TRADING_STRATEGIES } from '../data/strategies';
import { MultiMarketSection } from './MultiMarketSection';
import { InInterModeMartingaleSection } from './InInterModeMartingaleSection';
import { VirtualHookSection } from './VirtualHookSection';
import { VirtualSwitchSection } from './VirtualSwitchSection';
import { VirtualCountSection } from './VirtualCountSection';
import {
  Sliders,
  Play,
  Square,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Target,
  Layers,
  RotateCcw,
  Info,
  Pause,
  Calculator,
} from 'lucide-react';

interface TradingSectionProps {
  params: TradeParameters;
  onUpdateParams: (newParams: Partial<TradeParameters>) => void;
  selectedStrategy?: TradingStrategy;
  onSelectStrategy?: (strategy: TradingStrategy) => void;
  isAutoTrading: boolean;
  onToggleAutoTrading: () => void;
  onManualTrade: (contractType: 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD') => void;
  currentMartingaleStep: number;
  currentCalculatedStake: number;
  onResetMartingale: () => void;
  isTradePending: boolean;
  currency: string;
  botStatusMessage: string;
  isAuthorized: boolean;
  isPausedAwaitingSignal?: boolean;
  cycleLossCount?: number;
  multiMarketEnabled?: boolean;
  onToggleMultiMarket?: (enabled: boolean) => void;
  selectedMarkets?: string[];
  onToggleMarket?: (symbol: string) => void;
  onSelectAllMarkets?: (symbols: string[]) => void;
  onClearAllMarkets?: () => void;
  marketScanStatus?: Record<string, MultiMarketScanItem>;
  activeTradeSymbol?: string;
  onViewChart?: (symbol: string, name: string) => void;
  recoveryLockedMarket?: { symbol: string; symbolName: string } | null;
  onUnlockMarkets?: () => void;
  accumulatedLoss?: number;
  currentPhase?: number;
  currentMode?: number;
  defaultModeLossCount?: number;
  inModeLossCount?: number;
  modeFirstStake?: number;
  modeAccumulatedLoss?: number;
  isInVirtualHook?: boolean;
  virtualHookLossCount?: number;
  realConsecutiveLosses?: number;
  isInVirtualSwitch?: boolean;
  currentVirtualSwitchStage?: number;
  virtualSwitchStageProfit?: number;
  isInVirtualCount?: boolean;
  virtualCountLosses?: number;
  individualMultiMarketEnabled?: boolean;
  onToggleIndividualMultiMarket?: (enabled: boolean) => void;
  marketMartingaleStates?: Record<string, MarketMartingaleState>;
  onResetAllMarketMartingales?: () => void;
  activeTradeSymbols?: string[];
}

export const TradingSection: React.FC<TradingSectionProps> = ({
  params,
  onUpdateParams,
  selectedStrategy,
  onSelectStrategy,
  isAutoTrading,
  onToggleAutoTrading,
  onManualTrade,
  currentMartingaleStep,
  currentCalculatedStake,
  onResetMartingale,
  isTradePending,
  currency,
  botStatusMessage,
  isPausedAwaitingSignal = false,
  cycleLossCount = 0,
  currentPhase = 1,
  multiMarketEnabled = false,
  onToggleMultiMarket = () => {},
  selectedMarkets = [],
  onToggleMarket = () => {},
  onSelectAllMarkets = () => {},
  onClearAllMarkets = () => {},
  marketScanStatus = {},
  activeTradeSymbol,
  onViewChart = () => {},
  recoveryLockedMarket,
  onUnlockMarkets,
  accumulatedLoss = 0,
  currentMode = 0,
  defaultModeLossCount = 0,
  inModeLossCount = 0,
  modeFirstStake = 0,
  modeAccumulatedLoss = 0,
  isInVirtualHook = false,
  virtualHookLossCount = 0,
  realConsecutiveLosses = 0,
  isInVirtualSwitch = false,
  currentVirtualSwitchStage = 1,
  virtualSwitchStageProfit = 0,
  isInVirtualCount = false,
  virtualCountLosses = 0,
  individualMultiMarketEnabled = false,
  onToggleIndividualMultiMarket = () => {},
  marketMartingaleStates = {},
  onResetAllMarketMartingales,
  activeTradeSymbols = [],
}) => {
  const [tpInput, setTpInput] = React.useState<string>(() => String(params.takeProfit ?? 10));
  const [slInput, setSlInput] = React.useState<string>(() => String(params.stopLoss ?? 10));
  const [tpFocused, setTpFocused] = React.useState(false);
  const [slFocused, setSlFocused] = React.useState(false);

  React.useEffect(() => {
    if (!tpFocused && params.takeProfit > 0) {
      setTpInput(String(params.takeProfit));
    }
  }, [params.takeProfit, tpFocused]);

  React.useEffect(() => {
    if (!slFocused && params.stopLoss > 0) {
      setSlInput(String(params.stopLoss));
    }
  }, [params.stopLoss, slFocused]);

  return (
    <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800/80 overflow-hidden backdrop-blur-sm">
      {/* Top Header & Strategy Selector */}
      <div className="px-4 py-3 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 bg-zinc-950/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#ff444f]/10 text-[#ff444f] border border-[#ff444f]/20">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">Trading Parameters</h2>
            <p className="text-[11px] text-zinc-400">Configure bot execution logic & risk</p>
          </div>
        </div>

        {/* Strategy Selector Dropdown */}
        {onSelectStrategy && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-400 hidden sm:inline">Strategy:</span>
            <div className="relative">
              <select
                id="strategy-selector"
                value={selectedStrategy?.id || 'smc_structure_confluence'}
                onChange={(e) => {
                  const found = TRADING_STRATEGIES.find((s) => s.id === e.target.value);
                  if (found) onSelectStrategy(found);
                }}
                className="bg-zinc-900 border border-zinc-700/80 hover:border-emerald-500/60 rounded-xl px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-sm"
              >
                {TRADING_STRATEGIES.map((strat) => (
                  <option key={strat.id} value={strat.id} className="bg-zinc-900 text-white">
                    {strat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="p-2.5 sm:p-4 md:p-5 space-y-3 sm:space-y-4">
        {/* Continuous Trade Strategy Banner */}
        {selectedStrategy?.id === 'continuous_trade' && (
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/40 via-zinc-900/90 to-cyan-950/40 border border-emerald-500/40 text-xs shadow-md">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-bold text-emerald-300">Continuous Trade Strategy Active</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Every Candle @ 58s (59s Settle)
                </span>
              </div>
            </div>
            <p className="text-zinc-300 text-[11px] mt-1.5">
              Continuously executes trades at <strong>58s</strong> of every candle based on the latest <strong>Change of Character (CHoCH)</strong>. If bullish CHoCH, the bot continuously buys (Rise/CALL) until a bearish CHoCH occurs, immediately flipping to selling (Fall/PUT). Settle occurs at 59s with instant lot size recovery calculation on the next trade.
            </p>
          </div>
        )}

        {/* Trading Parameters 2-Column Grid (Active across mobile, tablet & desktop) */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {/* 1. Base Stake (Row 1, Left) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 focus-within:border-[#ff444f]/60 transition-colors min-w-0">
            <label htmlFor="stake-input" className="block text-[11px] sm:text-xs font-semibold text-zinc-300 mb-1 truncate">
              Base Stake
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">$</span>
              <input
                id="stake-input"
                type="number"
                min="0.35"
                step="0.5"
                value={params.stake}
                onChange={(e) => onUpdateParams({ stake: Math.max(0.35, parseFloat(e.target.value) || 0.35) })}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-5 pr-2 py-1 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#ff444f]"
                placeholder="1.00"
              />
            </div>
          </div>

          {/* 2. Multiplier (Row 1, Right - opposite to Base Stake) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 focus-within:border-[#ff444f]/60 transition-colors min-w-0">
            <label htmlFor="multiplier-input" className="block text-[11px] sm:text-xs font-semibold text-zinc-300 mb-1 truncate">
              Multiplier
            </label>
            <div className="relative">
              <input
                id="multiplier-input"
                type="number"
                min="1.0"
                max="10.0"
                step="0.1"
                disabled={params.autoMartingaleEnabled}
                value={params.multiplier}
                onChange={(e) => onUpdateParams({ multiplier: Math.max(1.0, parseFloat(e.target.value) || 1.0) })}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#ff444f] disabled:cursor-not-allowed disabled:text-zinc-500"
                placeholder="2.0"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">x</span>
            </div>
          </div>

          {/* 3. Take Profit (Row 2, Left - under Base Stake) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 focus-within:border-emerald-500/60 transition-colors min-w-0">
            <label htmlFor="take-profit-input" className="block text-[11px] sm:text-xs font-semibold text-emerald-400 mb-1 truncate">
              Take Profit
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">$</span>
              <input
                id="take-profit-input"
                type="number"
                min="0.01"
                step="any"
                value={tpInput}
                onFocus={() => setTpFocused(true)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setTpInput(raw);
                  const parsed = parseFloat(raw);
                  if (!isNaN(parsed) && parsed > 0) {
                    onUpdateParams({ takeProfit: parsed });
                  }
                }}
                onBlur={() => {
                  setTpFocused(false);
                  const parsed = parseFloat(tpInput);
                  const valid = !isNaN(parsed) && parsed > 0 ? parsed : (params.takeProfit > 0 ? params.takeProfit : 0.01);
                  onUpdateParams({ takeProfit: valid });
                  setTpInput(String(valid));
                }}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-5 pr-2 py-1 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="10.00"
              />
            </div>
          </div>

          {/* 4. Stop Loss (Row 2, Right - under Multiplier) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 focus-within:border-rose-500/60 transition-colors min-w-0">
            <label htmlFor="stop-loss-input" className="block text-[11px] sm:text-xs font-semibold text-rose-400 mb-1 truncate">
              Stop Loss
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">$</span>
              <input
                id="stop-loss-input"
                type="number"
                min="0.01"
                step="any"
                value={slInput}
                onFocus={() => setSlFocused(true)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setSlInput(raw);
                  const parsed = parseFloat(raw);
                  if (!isNaN(parsed) && parsed > 0) {
                    onUpdateParams({ stopLoss: parsed });
                  }
                }}
                onBlur={() => {
                  setSlFocused(false);
                  const parsed = parseFloat(slInput);
                  const valid = !isNaN(parsed) && parsed > 0 ? parsed : (params.stopLoss > 0 ? params.stopLoss : 0.01);
                  onUpdateParams({ stopLoss: valid });
                  setSlInput(String(valid));
                }}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-5 pr-2 py-1 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                placeholder="10.00"
              />
            </div>
          </div>

          {/* 5. Maximum Martingale (Row 3, Left - under Take Profit) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 focus-within:border-amber-500/60 transition-colors min-w-0">
            <label htmlFor="max-multiplier-input" className="block text-[11px] sm:text-xs font-semibold text-amber-400 mb-1 truncate">
              Maximum Martingale
            </label>
            <div className="relative">
              <input
                id="max-multiplier-input"
                type="number"
                min="1"
                max="50"
                step="1"
                value={params.maxMultiplier}
                onChange={(e) => onUpdateParams({ maxMultiplier: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                placeholder="5"
              />
            </div>
          </div>

          {/* 6. Auto Martingale (Row 3, Right - opposite Maximum Martingale) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between transition-colors min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] sm:text-xs font-semibold text-zinc-300 truncate">
                Auto Martingale
              </span>
              <span className={`text-[10px] font-mono font-bold ${params.autoMartingaleEnabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {params.autoMartingaleEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[10px] text-zinc-500 truncate">
                {params.autoMartingaleEnabled ? 'Auto ON' : 'Auto OFF'}
              </span>
              <button
                id="toggle-auto-martingale-btn"
                type="button"
                role="switch"
                aria-checked={Boolean(params.autoMartingaleEnabled)}
                onClick={() => onUpdateParams({ autoMartingaleEnabled: !params.autoMartingaleEnabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  params.autoMartingaleEnabled ? 'bg-emerald-500' : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    params.autoMartingaleEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* 7. Post Martingale (Pause) */}
          <div className="p-2 sm:p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between transition-colors min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] sm:text-xs font-semibold text-zinc-300 truncate" title="Post-Martingale: Pause after chosen consecutive losses">
                Post Martingale
              </span>
              <span className={`text-[10px] font-mono font-bold ${params.pauseTradeEnabled !== false ? 'text-purple-400' : 'text-zinc-500'}`}>
                {params.pauseTradeEnabled !== false ? 'ON' : 'OFF'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <button
                id="toggle-post-trade-btn"
                type="button"
                role="switch"
                aria-checked={params.pauseTradeEnabled !== false}
                onClick={() => onUpdateParams({ pauseTradeEnabled: params.pauseTradeEnabled === false ? true : false })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  params.pauseTradeEnabled !== false ? 'bg-purple-600' : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    params.pauseTradeEnabled !== false ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Dropdown for Pause Losses when Post Martingale is enabled */}
            {params.pauseTradeEnabled !== false && (
              <div className="mt-1.5 pt-1.5 border-t border-zinc-800/80 flex items-center justify-between gap-1">
                <label htmlFor="post-martingale-dropdown" className="text-[10px] text-zinc-400 truncate">
                  Pause After:
                </label>
                <select
                  id="post-martingale-dropdown"
                  value={params.pauseLossThreshold ?? 2}
                  onChange={(e) => onUpdateParams({ pauseLossThreshold: parseInt(e.target.value, 10) || 2 })}
                  className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20].map((num) => (
                    <option key={num} value={num}>
                      {num} {num === 1 ? 'Loss' : 'Losses'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 8. Virtual Hook (Row 4, Right - alongside Post Martingale) */}
          <VirtualHookSection
            params={params}
            onUpdateParams={onUpdateParams}
            isInVirtualHook={isInVirtualHook}
            virtualHookLossCount={virtualHookLossCount}
            realConsecutiveLosses={realConsecutiveLosses}
            currency={currency}
          />
        </div>

        {/* In-Mode and Inter-Mode Martingale Section (10 Modes) */}
        <InInterModeMartingaleSection
          params={params}
          onUpdateParams={onUpdateParams}
          currentMode={currentMode}
          inModeLossCount={inModeLossCount}
          modeFirstStake={modeFirstStake}
          modeAccumulatedLoss={modeAccumulatedLoss}
          currentCalculatedStake={currentCalculatedStake}
          currency={currency}
        />

        {/* Virtual Switch and Virtual Count (Side-by-side: Virtual Switch left, Virtual Count opposite) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
          <VirtualSwitchSection
            params={params}
            onUpdateParams={onUpdateParams}
            currentStage={currentVirtualSwitchStage}
            stageProfit={virtualSwitchStageProfit}
            isInVirtualSwitch={isInVirtualSwitch}
            realConsecutiveLosses={realConsecutiveLosses}
          />
          <VirtualCountSection
            params={params}
            onUpdateParams={onUpdateParams}
            isInVirtualCount={isInVirtualCount}
            virtualCountLosses={virtualCountLosses}
          />
        </div>

        {/* Multi-Market Trading & Scanner Section */}
        <MultiMarketSection
          multiMarketEnabled={multiMarketEnabled}
          onToggleMultiMarket={onToggleMultiMarket}
          selectedMarkets={selectedMarkets}
          onToggleMarket={onToggleMarket}
          onSelectAllMarkets={onSelectAllMarkets}
          onClearAllMarkets={onClearAllMarkets}
          marketScanStatus={marketScanStatus}
          currentSymbol={params.symbol}
          currentSymbolName={params.symbolName}
          activeTradeSymbol={activeTradeSymbol}
          activeTradeSymbols={activeTradeSymbols}
          onViewChart={onViewChart}
          isAutoTrading={isAutoTrading}
          recoveryLockedMarket={recoveryLockedMarket}
          onUnlockMarkets={onUnlockMarkets}
          individualMultiMarketEnabled={individualMultiMarketEnabled}
          onToggleIndividualMultiMarket={onToggleIndividualMultiMarket}
          maxConcurrentTrades={params.maxConcurrentTrades ?? 1}
          onUpdateMaxConcurrentTrades={(val: number) => onUpdateParams({ maxConcurrentTrades: val })}
          marketMartingaleStates={marketMartingaleStates}
          onResetAllMarketMartingales={onResetAllMarketMartingales}
          baseStake={params.stake}
        />

        {/* Martingale Step Status & Actions */}
        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-zinc-400">Mode:</span>
            {isInVirtualCount ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/50 animate-pulse">
                Virtual Count ({virtualCountLosses}/{params.virtualCountThreshold ?? 3} Losses)
              </span>
            ) : params.virtualCountEnabled ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Virtual Count (Trading Real)
              </span>
            ) : isInVirtualSwitch ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/50 animate-pulse">
                Virtual Switch (Box {currentVirtualSwitchStage})
              </span>
            ) : isInVirtualHook ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/50 animate-pulse">
                Virtual Hook ({virtualHookLossCount} Virtual Losses)
              </span>
            ) : params.virtualSwitchEnabled ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Virtual Switch (Box {currentVirtualSwitchStage})
              </span>
            ) : params.inInterModeEnabled ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                In/Inter-Mode ({currentMode > 0 ? `Mode ${currentMode}` : 'Default'})
              </span>
            ) : params.autoMartingaleEnabled ? (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Auto Martingale ({params.autoMartingalePayoutPercent ?? 83}% Recovery)
              </span>
            ) : (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                Multiplier ({params.multiplier}x Factor)
              </span>
            )}

            <span className="text-zinc-400 ml-1 sm:ml-2">Step:</span>
            <span className="font-mono font-bold text-zinc-300">
              {params.individualMultiMarketEnabled
                ? Math.max(currentMartingaleStep, ...Object.values(marketMartingaleStates).map((s) => s?.currentMartingaleStep || 0))
                : currentMartingaleStep}
            </span>

            {params.inInterModeEnabled && currentMode > 0 ? (
              <>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  In-Mode Loss: {inModeLossCount}/{params.consecutivesToSwitchMode ?? 3}
                </span>
                {modeFirstStake > 0 && (
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-200 border border-cyan-500/20">
                    1st Stake: ${modeFirstStake.toFixed(2)}
                  </span>
                )}
              </>
            ) : params.inInterModeEnabled && defaultModeLossCount > 0 ? (
              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                Default Loss: {defaultModeLossCount}/{params.consecutivesToSwitchMode ?? 3}
              </span>
            ) : null}

            {params.pauseTradeEnabled !== false && (isPausedAwaitingSignal || cycleLossCount > 0 || currentMartingaleStep > 0 || (accumulatedLoss || 0) > 0 || (params.inInterModeEnabled && (currentMode > 0 || defaultModeLossCount > 0)) || isInVirtualCount) && (
              <span
                className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                  isPausedAwaitingSignal
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 animate-pulse'
                    : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                }`}
              >
                {isPausedAwaitingSignal
                  ? `Phase ${Math.max(1, (currentPhase || 1) - 1)} Paused (${params.pauseLossThreshold ?? 2}/${params.pauseLossThreshold ?? 2}) — Awaiting Signal`
                  : `Phase ${currentPhase || 1} (${cycleLossCount}/${params.pauseLossThreshold ?? 2})`}
              </span>
            )}

            {params.inInterModeEnabled && (modeAccumulatedLoss > 0 || (accumulatedLoss || 0) > 0) ? (
              <>
                <span className="text-zinc-400 ml-1 sm:ml-2">Sequence Loss:</span>
                <span className="font-mono font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                  ${Math.max(modeAccumulatedLoss, accumulatedLoss || 0).toFixed(2)}
                </span>
              </>
            ) : params.autoMartingaleEnabled && (accumulatedLoss || 0) > 0 && (
              <>
                <span className="text-zinc-400 ml-1 sm:ml-2">Loss to Recover:</span>
                <span className="font-mono font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                  ${(accumulatedLoss || 0).toFixed(2)}
                </span>
              </>
            )}

            <span className="text-zinc-400 ml-1 sm:ml-2">Next Martingale:</span>
            <span className="font-mono font-bold text-white text-xs bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700">
              ${currentCalculatedStake.toFixed(2)}
            </span>
          </div>

          <button
            id="reset-martingale-btn"
            type="button"
            onClick={onResetMartingale}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 hover:border-rose-500/50 text-rose-300 hover:text-white text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
            title="Reset all Martingale steps and accumulated losses across all markets to start trading from the first stake"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>Reset</span>
          </button>
        </div>

        {/* Bot Status & Trigger Feedback Message */}
        {botStatusMessage && (
          <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-700/60 flex items-center gap-2 text-xs text-zinc-300">
            <Info className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span className="truncate">{botStatusMessage}</span>
          </div>
        )}

        {/* Execution Buttons: Auto Trading and Manual Buy */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Auto Trading Master Button */}
          <button
            id="toggle-autotrade-btn"
            disabled={isTradePending}
            onClick={onToggleAutoTrading}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer ${
              isAutoTrading
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30 ring-2 ring-rose-500'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isAutoTrading ? (
              <>
                <Square className="w-4 h-4 fill-white" />
                <span>STOP AUTO TRADER</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>START AUTO TRADER</span>
              </>
            )}
          </button>

          {/* Manual BUY RISE */}
          <button
            id="manual-buy-rise-btn"
            disabled={isTradePending || isAutoTrading}
            onClick={() => onManualTrade('CALL')}
            className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-[#00a79e] hover:bg-[#00bdae] text-white shadow-md shadow-[#00a79e]/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <TrendingUp className="w-4 h-4 stroke-[2.5]" />
            <span>BUY RISE (CALL) - ${currentCalculatedStake.toFixed(2)}</span>
          </button>

          {/* Manual BUY FALL */}
          <button
            id="manual-buy-fall-btn"
            disabled={isTradePending || isAutoTrading}
            onClick={() => onManualTrade('PUT')}
            className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-[#ff444f] hover:bg-[#ff555f] text-white shadow-md shadow-[#ff444f]/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <TrendingDown className="w-4 h-4 stroke-[2.5]" />
            <span>BUY FALL (PUT) - ${currentCalculatedStake.toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
