import React from 'react';
import { BalanceStats } from '../types';

interface BalanceCardsProps {
  stats: BalanceStats;
  currency: string;
  isVirtual?: boolean;
}

export const BalanceCards: React.FC<BalanceCardsProps> = ({ stats, currency = 'USD', isVirtual }) => {
  const isPositive = stats.netProfitLoss > 0;
  const isNegative = stats.netProfitLoss < 0;
  const isZero = stats.netProfitLoss === 0;

  const formattedStarting = stats.startingBalance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedCurrent = stats.currentBalance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedPnl = Math.abs(stats.netProfitLoss).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedGrossProfit = (stats.grossProfit ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedGrossLoss = (stats.grossLoss ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div
      id="balance-stats-bar"
      className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3"
    >
      {/* 1. Starting Balance */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5">
          <span className="text-[11px] sm:text-xs text-zinc-400 font-medium whitespace-nowrap">Starting:</span>
          <div className="flex items-baseline gap-1 font-mono min-w-0">
            <span className="text-xs sm:text-sm font-bold text-white whitespace-nowrap">${formattedStarting}</span>
            <span className="text-[9px] sm:text-[10px] text-zinc-500 uppercase">{currency}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 mt-1 pt-1 border-t border-zinc-800/60 text-[10px] font-mono text-zinc-500">
          <span className="truncate">Session Baseline</span>
          {isVirtual && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 shrink-0">
              Demo
            </span>
          )}
        </div>
      </div>

      {/* 2. Current Balance */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5">
          <span className="text-[11px] sm:text-xs text-zinc-400 font-medium whitespace-nowrap">Current:</span>
          <div className="flex items-baseline gap-1 font-mono min-w-0">
            <span className="text-xs sm:text-sm font-bold text-cyan-300 whitespace-nowrap">${formattedCurrent}</span>
            <span className="text-[9px] sm:text-[10px] text-cyan-500 uppercase">{currency}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 mt-1 pt-1 border-t border-zinc-800/60 text-[10px] font-mono text-zinc-500">
          <span className="truncate">Real-time Broker</span>
          <span className="text-cyan-400 font-medium shrink-0">Live</span>
        </div>
      </div>

      {/* 3. Net P&L */}
      <div
        className={`border rounded-xl p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between transition-colors min-w-0 ${
          isPositive
            ? 'bg-emerald-950/25 border-emerald-500/40 shadow-sm shadow-emerald-950/20'
            : isNegative
            ? 'bg-rose-950/25 border-rose-500/40 shadow-sm shadow-rose-950/20'
            : 'bg-zinc-900/80 border-zinc-800'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5">
          <span className="text-[11px] sm:text-xs text-zinc-400 font-medium whitespace-nowrap">Net P&amp;L:</span>
          <div className="flex items-baseline gap-1 font-mono min-w-0 flex-wrap">
            <span
              className={`text-xs sm:text-sm font-bold whitespace-nowrap ${
                isPositive
                  ? 'text-emerald-400'
                  : isNegative
                  ? 'text-rose-400'
                  : 'text-zinc-200'
              }`}
            >
              {isPositive ? `+$${formattedPnl}` : isNegative ? `-$${formattedPnl}` : `$0.00`}
            </span>
            <span
              className={`text-[9px] sm:text-[10px] font-medium whitespace-nowrap ${
                isPositive
                  ? 'text-emerald-500'
                  : isNegative
                  ? 'text-rose-500'
                  : 'text-zinc-500'
              }`}
            >
              ({isPositive ? '+' : isNegative ? '-' : ''}
              {Math.abs(stats.netProfitLossPercentage).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Breakdown details row */}
        <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 mt-1 pt-1 border-t border-zinc-800/60 text-[9px] sm:text-[10px] font-mono">
          <span className="text-emerald-400 font-medium flex items-center gap-0.5 whitespace-nowrap">
            <span className="text-zinc-500">Profit:</span>
            <span>+${formattedGrossProfit}</span>
          </span>
          <span className="text-zinc-600 hidden sm:inline">•</span>
          <span className="text-rose-400 font-medium flex items-center gap-0.5 whitespace-nowrap">
            <span className="text-zinc-500">Loss:</span>
            <span>-${formattedGrossLoss}</span>
          </span>
        </div>
      </div>

      {/* 4. Win Rate */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0.5">
          <span className="text-[11px] sm:text-xs text-zinc-400 font-medium whitespace-nowrap">Win Rate:</span>
          <div className="flex items-baseline gap-1 font-mono min-w-0 flex-wrap">
            <span className="text-xs sm:text-sm font-bold text-white whitespace-nowrap">
              {stats.winRate.toFixed(1)}%
            </span>
            <span className="text-[10px] sm:text-[11px] text-zinc-400 whitespace-nowrap">
              ({stats.wonTrades}W / {stats.lostTrades}L)
            </span>
          </div>
        </div>

        {/* Breakdown or subtext */}
        <div className="flex flex-wrap items-center justify-between gap-1 mt-1 pt-1 border-t border-zinc-800/60 text-[10px] font-mono text-zinc-500">
          <span className="whitespace-nowrap">{stats.totalTrades} Real {stats.totalTrades === 1 ? 'Trade' : 'Trades'}</span>
          <span className="text-zinc-400 whitespace-nowrap">
            {stats.totalTrades > 0 ? `${stats.wonTrades}/${stats.totalTrades} Won` : 'No Trades'}
          </span>
        </div>
      </div>
    </div>
  );
};
