import React from 'react';
import { TradeRecord } from '../types';
import { TrendingUp, TrendingDown, Clock, ShieldCheck, Activity } from 'lucide-react';

import { isVirtualRecord } from '../utils/tradeUtils';

interface ActiveTradeBannerProps {
  activeTrade?: TradeRecord | null;
  activeTrades?: TradeRecord[];
  currentQuote?: number;
  marketQuotes?: Record<string, number>;
  secondsRemaining: number;
  isVirtualSystemEnabled?: boolean;
  defaultExpiryMinutes?: number;
}

const formatCountdown = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  if (s >= 60) {
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return `${mins}m ${String(rem).padStart(2, '0')}s`;
  }
  return `${s}s`;
};

const SingleTradeCard: React.FC<{
  trade: TradeRecord;
  currentPrice: number;
  secondsRemaining: number;
  isMultiCard?: boolean;
  isVirtualSystemEnabled?: boolean;
  defaultExpiryMinutes?: number;
}> = ({ trade, currentPrice, secondsRemaining, isMultiCard, isVirtualSystemEnabled = false, defaultExpiryMinutes = 1 }) => {
  const isCall = trade.contractType.includes('CALL') || trade.contractType.includes('RISE');
  const entryBarrier =
    trade.entryBarrier !== undefined && trade.entryBarrier !== null
      ? Number(trade.entryBarrier)
      : trade.entrySpot;

  const livePrice = currentPrice > 0 ? currentPrice : (entryBarrier ?? 0);
  const isWinningNow = entryBarrier !== undefined
    ? isCall
      ? livePrice > entryBarrier
      : livePrice < entryBarrier
    : false;

  const remaining = typeof trade.settleTimeRemaining === 'number'
    ? Math.max(0, trade.settleTimeRemaining)
    : Math.max(0, secondsRemaining);

  const expiryMin = Math.max(1, Math.round(trade.durationMinutes || defaultExpiryMinutes || 1));
  const totalSettleSec = expiryMin * 60 - 1;
  const progressPct = Math.max(0, Math.min(100, ((totalSettleSec - remaining) / Math.max(1, totalSettleSec)) * 100));

  return (
    <div
      className={`p-3.5 sm:p-4 rounded-2xl bg-zinc-950/90 border shadow-2xl relative overflow-hidden backdrop-blur-md transition-all ${
        isWinningNow ? 'border-emerald-500/40' : 'border-zinc-700/80'
      }`}
    >
      {/* 59s Progress Line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-zinc-800">
        <div
          className={`h-full transition-all duration-1000 ${
            isWinningNow ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 pt-1">
        {/* Left: Direction & Contract details */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <div
            className={`p-2 rounded-xl border flex items-center justify-center shrink-0 ${
              isCall
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
          >
            {isCall ? <TrendingUp className="w-5 h-5 stroke-[2.5]" /> : <TrendingDown className="w-5 h-5 stroke-[2.5]" />}
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-mono font-bold text-zinc-400">#{trade.contractId}</span>
              <span className="font-bold text-sm text-white">{trade.symbolName}</span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                  isCall ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {expiryMin}-Min {isCall ? 'RISE' : 'FALL'}
              </span>
              {isVirtualRecord(trade, isVirtualSystemEnabled) && (
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Virtual
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
              <span>Stake: <strong className="text-white font-mono">${trade.stake.toFixed(2)}</strong></span>
              <span>Potential Payout: <strong className="text-emerald-400 font-mono">${trade.payout.toFixed(2)}</strong></span>
            </div>
          </div>
        </div>

        {/* Center: Real-time Entry Barrier & Exit Barrier Tracker */}
        <div className="flex items-center gap-2 sm:gap-4 bg-zinc-900/80 px-3 sm:px-4 py-2 rounded-xl border border-zinc-800 font-mono text-xs">
          <div>
            <span className="text-[9px] text-zinc-500 block uppercase">Entry Barrier</span>
            <span className="text-xs sm:text-sm font-bold text-cyan-400">
              {entryBarrier !== undefined ? entryBarrier.toFixed(2) : 'Fetching...'}
            </span>
          </div>

          <div className="text-zinc-600">→</div>

          <div>
            <span className="text-[9px] text-zinc-500 block uppercase">Live Spot</span>
            <span
              className={`text-xs sm:text-sm font-bold ${
                isWinningNow ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {livePrice > 0 ? livePrice.toFixed(2) : '---'}
            </span>
          </div>

          <div className="text-zinc-600">→</div>

          <div>
            <span className="text-[9px] text-zinc-500 block uppercase">Exit Barrier</span>
            <span className="text-[11px] sm:text-xs text-amber-400 font-bold">
              {trade.exitBarrier ? String(trade.exitBarrier) : 'Locks @ :59s'}
            </span>
          </div>
        </div>

        {/* Right: Dynamic settlement countdown */}
        <div className="flex items-center gap-2.5 ml-auto">
          <div className="text-right font-mono">
            <span className="text-[9px] text-zinc-400 flex items-center justify-end gap-1">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>Settling</span>
            </span>
            <div className="text-sm sm:text-base font-black text-amber-400 flex items-baseline justify-end gap-1">
              <span>{formatCountdown(remaining)}</span>
              <span className="text-[9px] text-zinc-500 font-sans font-normal">/ {formatCountdown(totalSettleSec)}</span>
            </div>
          </div>

          <div
            className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold font-mono flex items-center gap-1 ${
              isWinningNow
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
            }`}
          >
            <Activity className="w-3 h-3 animate-pulse" />
            <span>{isWinningNow ? 'IN PROFIT' : 'BELOW'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ActiveTradeBanner: React.FC<ActiveTradeBannerProps> = ({
  activeTrade,
  activeTrades = [],
  currentQuote,
  marketQuotes = {},
  secondsRemaining,
  isVirtualSystemEnabled = false,
  defaultExpiryMinutes = 1,
}) => {
  // Aggregate active trades from either activeTrades array or activeTrade fallback
  const allActiveTrades: TradeRecord[] = [];
  if (Array.isArray(activeTrades) && activeTrades.length > 0) {
    allActiveTrades.push(...activeTrades.filter((t) => t.status === 'open'));
  }
  if (allActiveTrades.length === 0 && activeTrade && activeTrade.status === 'open') {
    allActiveTrades.push(activeTrade);
  }

  if (allActiveTrades.length === 0) return null;

  return (
    <div id="active-trade-banner" className="space-y-2">
      {allActiveTrades.length > 1 && (
        <div className="flex items-center justify-between px-1 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 font-bold text-indigo-400">
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            <span>Individual Multi-Market Active: {allActiveTrades.length} Concurrent Trades Running</span>
          </div>
        </div>
      )}
      {allActiveTrades.map((trade) => {
        const symbolPrice = marketQuotes[trade.symbol] ?? (trade.symbol ? undefined : currentQuote);
        const resolvedPrice = symbolPrice ?? currentQuote ?? trade.entrySpot ?? 0;
        return (
          <SingleTradeCard
            key={trade.id || trade.contractId}
            trade={trade}
            currentPrice={resolvedPrice}
            secondsRemaining={secondsRemaining}
            isMultiCard={allActiveTrades.length > 1}
            isVirtualSystemEnabled={isVirtualSystemEnabled}
            defaultExpiryMinutes={defaultExpiryMinutes}
          />
        );
      })}
    </div>
  );
};
