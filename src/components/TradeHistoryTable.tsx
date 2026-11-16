import React, { useState, useMemo, useEffect } from 'react';
import { TradeRecord } from '../types';
import { getTradeProfit, isVirtualRecord } from '../utils/tradeUtils';
export { isVirtualRecord };
import {
  History,
  RefreshCw,
  Trash2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  CheckCircle,
  XCircle,
  TrendingUp,
  ShieldAlert,
  Calendar,
  Timer,
} from 'lucide-react';

interface TradeHistoryTableProps {
  trades: TradeRecord[];
  currency: string;
  onRefresh: () => void;
  onClearHistory: () => void;
  isLoading?: boolean;
  isVirtualSystemEnabled?: boolean;
  isAutoTrading?: boolean;
  autoTraderStartedAt?: number | null;
  autoTraderStoppedElapsedMs?: number | null;
}

const MAX_HISTORY_CAPACITY = 5000;

function formatElapsedDuration(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export const TradeHistoryTable: React.FC<TradeHistoryTableProps> = React.memo(({
  trades,
  currency = 'USD',
  onRefresh,
  onClearHistory,
  isLoading,
  isVirtualSystemEnabled = false,
  isAutoTrading = false,
  autoTraderStartedAt = null,
  autoTraderStoppedElapsedMs = null,
}) => {
  const [clearedNotice, setClearedNotice] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'won' | 'lost' | 'open'>('all');
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isAutoTrading || !autoTraderStartedAt) return;
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isAutoTrading, autoTraderStartedAt]);

  const elapsedMs = isAutoTrading && autoTraderStartedAt
    ? Math.max(0, nowMs - autoTraderStartedAt)
    : (autoTraderStoppedElapsedMs ?? 0);
  const formattedRuntime = formatElapsedDuration(elapsedMs);
  const hasRecordedRun = isAutoTrading || (autoTraderStoppedElapsedMs !== null && autoTraderStoppedElapsedMs > 0);

  const checkIsVirtual = (t: TradeRecord) => isVirtualRecord(t, isVirtualSystemEnabled);

  // Cap trades to 5,000 maximum capacity
  const boundedTrades = useMemo(() => {
    return trades.slice(0, MAX_HISTORY_CAPACITY);
  }, [trades]);

  // Summary statistics for the bounded history (REAL account trades only - virtual trades do NOT affect P&L or win/loss counts)
  const stats = useMemo(() => {
    let won = 0;
    let lost = 0;
    let open = 0;
    let totalPnl = 0;

    for (let i = 0; i < boundedTrades.length; i++) {
      const t = boundedTrades[i];
      if (t.status === 'open') {
        open++;
      }
      if (!isVirtualRecord(t, isVirtualSystemEnabled)) {
        if (t.status === 'won') {
          won++;
          totalPnl += getTradeProfit(t);
        } else if (t.status === 'lost') {
          lost++;
          totalPnl += getTradeProfit(t);
        }
      }
    }
    const settled = won + lost;
    const winRate = settled > 0 ? ((won / settled) * 100).toFixed(1) : '0.0';

    // Calculate the highest maximum consecutive losses recorded so far in history (REAL trades only, excluding virtual trades)
    const realSettledList: TradeRecord[] = [];
    for (let i = 0; i < boundedTrades.length; i++) {
      const t = boundedTrades[i];
      if (!isVirtualRecord(t, isVirtualSystemEnabled) && (t.status === 'won' || t.status === 'lost')) {
        realSettledList.push(t);
      }
    }

    // Sort real settled trades chronologically from earliest to latest
    realSettledList.sort((a, b) => {
      const timeA = a.sellTime || a.purchaseTime || 0;
      const timeB = b.sellTime || b.purchaseTime || 0;
      return timeA - timeB;
    });

    let currentStreak = 0;
    let maxConsecutiveLosses = 0;

    for (let i = 0; i < realSettledList.length; i++) {
      if (realSettledList[i].status === 'lost') {
        currentStreak++;
        if (currentStreak > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentStreak;
        }
      } else if (realSettledList[i].status === 'won') {
        currentStreak = 0;
      }
    }

    // Calculate trading span in days from trade history (from the first trade down to the current trade)
    let earliestTime = Infinity;
    let latestTime = 0;
    for (let i = 0; i < boundedTrades.length; i++) {
      const t = boundedTrades[i];
      let pTime = t.purchaseTime || 0;
      if (pTime > 0 && pTime < 1e11) pTime *= 1000;
      let sTime = t.sellTime || 0;
      if (sTime > 0 && sTime < 1e11) sTime *= 1000;

      const validTime = pTime > 0 ? pTime : sTime;
      const validEnd = sTime > 0 ? sTime : pTime;

      if (validTime > 0) {
        if (validTime < earliestTime) earliestTime = validTime;
        if (validTime > latestTime) latestTime = validTime;
      }
      if (validEnd > 0) {
        if (validEnd > latestTime) latestTime = validEnd;
      }
    }

    let daysCount = 0;
    if (earliestTime !== Infinity && latestTime >= earliestTime) {
      const spanMs = latestTime - earliestTime;
      daysCount = Math.floor(spanMs / (24 * 60 * 60 * 1000));
    }
    const daysText = daysCount === 1 ? '1 day' : `${daysCount} days`;

    return {
      won,
      lost,
      open,
      settled,
      winRate,
      totalPnl: Number(totalPnl.toFixed(2)),
      maxConsecutiveLosses,
      daysCount,
      daysText,
    };
  }, [boundedTrades]);

  // Filter trades based on search term & status
  const filteredTrades = useMemo(() => {
    return boundedTrades.filter((t) => {
      const isVirt = checkIsVirtual(t);
      if (statusFilter === 'won' && (isVirt || t.status !== 'won')) {
        return false;
      }
      if (statusFilter === 'lost' && (isVirt || t.status !== 'lost')) {
        return false;
      }
      if (statusFilter === 'open' && t.status !== 'open') {
        return false;
      }
      if (searchTerm.trim() !== '') {
        const query = searchTerm.toLowerCase();
        const idMatch = String(t.contractId || t.id).toLowerCase().includes(query);
        const symMatch = (t.symbolName || t.symbol || '').toLowerCase().includes(query);
        return idMatch || symMatch;
      }
      return true;
    });
  }, [boundedTrades, statusFilter, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedTrades = useMemo(() => {
    const startIndex = (safePage - 1) * pageSize;
    return filteredTrades.slice(startIndex, startIndex + pageSize);
  }, [filteredTrades, safePage, pageSize]);

  const handleClear = () => {
    if (trades.length === 0) return;
    onClearHistory();
    setClearedNotice(true);
    setCurrentPage(1);
    setTimeout(() => {
      setClearedNotice(false);
    }, 2500);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(Math.max(1, Math.min(newPage, totalPages)));
  };

  return (
    <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800/80 overflow-hidden backdrop-blur-sm shadow-xl">
      {/* Table Header Bar */}
      <div className="px-4 py-3 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 bg-zinc-950/60">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
            <History className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-white tracking-wide">Trade History</h2>

            {/* System Running Timer Badge */}
            <span
              id="trade-history-system-timer"
              className={`text-[11px] font-mono px-2 py-0.5 rounded-full border font-semibold flex items-center gap-1.5 shadow-sm transition-colors ${
                isAutoTrading
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : hasRecordedRun
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60'
              }`}
              title={
                isAutoTrading
                  ? 'System has been running since you clicked Start'
                  : hasRecordedRun
                  ? 'Last system run duration (resets and starts counting when you click Start)'
                  : 'System timer starts counting when you click Start'
              }
            >
              <Timer
                className={`w-3 h-3 ${
                  isAutoTrading
                    ? 'text-emerald-400 animate-pulse'
                    : hasRecordedRun
                    ? 'text-amber-400'
                    : 'text-zinc-500'
                }`}
              />
              <span
                className={`text-[10px] uppercase font-bold font-sans tracking-wide ${
                  isAutoTrading
                    ? 'text-emerald-400'
                    : hasRecordedRun
                    ? 'text-amber-400'
                    : 'text-zinc-400'
                }`}
              >
                Timer:
              </span>
              <span
                className={`font-bold px-1.5 py-0.2 rounded font-mono tabular-nums text-[11px] ${
                  isAutoTrading
                    ? 'text-white bg-emerald-500/25'
                    : hasRecordedRun
                    ? 'text-amber-100 bg-amber-500/20'
                    : 'text-zinc-300 bg-zinc-700/50'
                }`}
              >
                {formattedRuntime}
              </span>
            </span>

            {/* Days Badge - placed in front of max con */}
            <span
              id="trade-history-days-badge"
              className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/35 font-semibold flex items-center gap-1.5 shadow-sm"
              title="Total trading duration based on trade history timestamps (from first trade to current trade)"
            >
              <Calendar className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] uppercase font-bold text-blue-400 font-sans tracking-wide">Days:</span>
              <span className="font-bold text-white bg-blue-500/30 px-1.5 py-0.2 rounded font-mono text-[11px]">
                {stats.daysText}
              </span>
            </span>

            {/* Max Consecutive Losses Badge - placed in front of the number of trades */}
            <span
              id="trade-history-max-consecutive-badge"
              className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/35 font-semibold flex items-center gap-1.5 shadow-sm"
              title="Highest maximum consecutive losses recorded on real account trades (excluding virtual trades)"
            >
              <span className="text-[10px] uppercase font-bold text-rose-400 font-sans tracking-wide">Max Con:</span>
              <span className="font-bold text-white bg-rose-500/30 px-1.5 py-0.2 rounded font-mono text-[11px]">
                {stats.maxConsecutiveLosses}
              </span>
            </span>

            <span
              className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 font-semibold"
              title="Trade history holds up to 5,000 trades without resetting"
            >
              {boundedTrades.length.toLocaleString()} / {MAX_HISTORY_CAPACITY.toLocaleString()} trades
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Clear History Box / Button */}
          <button
            type="button"
            onClick={handleClear}
            disabled={trades.length === 0}
            title={trades.length === 0 ? 'No history to clear' : 'Clear all trade history'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
              clearedNotice
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                : trades.length === 0
                ? 'bg-zinc-900/40 text-zinc-600 border border-zinc-800/50 cursor-not-allowed'
                : 'bg-zinc-900 hover:bg-rose-950/40 text-zinc-300 hover:text-rose-300 border border-zinc-800 hover:border-rose-800/60 active:scale-95 shadow-sm'
            }`}
          >
            {clearedNotice ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>History Cleared</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Clear History</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            title="Refresh History from Deriv"
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Metrics & Filter Bar */}
      <div className="px-4 py-2.5 bg-zinc-950/40 border-b border-zinc-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Quick Stats Strip */}
        <div className="flex items-center gap-3 overflow-x-auto py-0.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800/80 text-zinc-400">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-zinc-300">Win Rate:</span>
            <span className="font-mono font-bold text-white">{stats.winRate}%</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800/80 text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5" />
            <span className="font-mono font-bold">{stats.won.toLocaleString()} Won</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800/80 text-rose-400">
            <XCircle className="w-3.5 h-3.5" />
            <span className="font-mono font-bold">{stats.lost.toLocaleString()} Lost</span>
          </div>

          {/* Max Consecutive Losses Stat in Metrics Strip */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800/80 text-rose-400"
            title="Highest maximum consecutive losses recorded on real account trades (excluding virtual trades)"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span className="font-semibold text-zinc-300">Max Con:</span>
            <span className="font-mono font-bold text-rose-300">{stats.maxConsecutiveLosses}</span>
          </div>

          {stats.open > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="font-mono font-semibold">{stats.open} Running</span>
            </div>
          )}

          <div className="text-zinc-500 font-mono">
            P&L:{' '}
            <span
              className={`font-bold ${
                stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {stats.totalPnl >= 0 ? `+$${stats.totalPnl.toFixed(2)}` : `-$${Math.abs(stats.totalPnl).toFixed(2)}`}
            </span>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Status Filter Tabs */}
          <div className="flex items-center p-0.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                statusFilter === 'all'
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({boundedTrades.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('won');
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                statusFilter === 'won'
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                  : 'text-zinc-400 hover:text-emerald-300'
              }`}
            >
              Won ({stats.won})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('lost');
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                statusFilter === 'lost'
                  ? 'bg-rose-500/20 text-rose-300 font-semibold'
                  : 'text-zinc-400 hover:text-rose-300'
              }`}
            >
              Lost ({stats.lost})
            </button>
            {stats.open > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('open');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'open'
                    ? 'bg-amber-500/20 text-amber-300 font-semibold'
                    : 'text-zinc-400 hover:text-amber-300'
                }`}
              >
                Running ({stats.open})
              </button>
            )}
          </div>

          {/* Quick Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search ID / market..."
              className="pl-8 pr-2.5 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 w-36 sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur text-zinc-400 font-semibold border-b border-zinc-800/80 shadow-sm">
            <tr>
              <th className="py-2.5 px-4">Time</th>
              <th className="py-2.5 px-3">Market</th>
              <th className="py-2.5 px-3">Entry Barrier</th>
              <th className="py-2.5 px-3">Exit Barrier</th>
              <th className="py-2.5 px-3 text-right">Stake ({currency})</th>
              <th className="py-2.5 px-4 text-right">Profit / Loss</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-mono">
            {paginatedTrades.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-zinc-500 font-sans">
                  {boundedTrades.length === 0
                    ? 'No trades recorded yet.'
                    : 'No trades match the current filter or search criteria.'}
                </td>
              </tr>
            ) : (
              paginatedTrades.map((trade) => {
                const isOpen = trade.status === 'open';
                const isWon = trade.status === 'won';
                const timeStr = new Date(trade.purchaseTime).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                const entryBarrierVal =
                  trade.entryBarrier !== undefined && trade.entryBarrier !== null && String(trade.entryBarrier) !== ''
                    ? String(trade.entryBarrier)
                    : trade.barrier || (trade.entrySpot !== undefined ? String(trade.entrySpot) : '---');

                const exitBarrierVal =
                  trade.exitBarrier !== undefined && trade.exitBarrier !== null && String(trade.exitBarrier) !== '' && String(trade.exitBarrier) !== 'Running...' && String(trade.exitBarrier) !== 'Running'
                    ? String(trade.exitBarrier)
                    : trade.exitSpot !== undefined
                    ? String(trade.exitSpot)
                    : isOpen
                    ? 'Running'
                    : entryBarrierVal;

                return (
                  <tr
                    key={trade.id || trade.contractId}
                    className={`transition-colors ${
                      isOpen ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-zinc-800/30'
                    }`}
                  >
                    {/* Time */}
                    <td className="py-2.5 px-4 text-zinc-300 whitespace-nowrap">{timeStr}</td>

                    {/* Market */}
                    <td className="py-2.5 px-3 text-white font-sans font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{trade.symbolName || trade.symbol}</span>
                        {checkIsVirtual(trade) && (
                          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                            Virtual
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Entry Barrier */}
                    <td className="py-2.5 px-3 text-cyan-400 whitespace-nowrap">
                      {entryBarrierVal}
                    </td>

                    {/* Exit Barrier */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-400 font-sans text-[11px] font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                          <span>Running</span>
                        </span>
                      ) : (
                        <span className={isWon ? 'text-emerald-400' : 'text-rose-400'}>
                          {exitBarrierVal}
                        </span>
                      )}
                    </td>

                    {/* Stake */}
                    <td className="py-2.5 px-3 text-right text-zinc-300 whitespace-nowrap">
                      ${trade.stake.toFixed(2)}
                    </td>

                    {/* Profit / Loss */}
                    <td className="py-2.5 px-4 text-right font-bold whitespace-nowrap">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-sans text-[11px] font-semibold animate-pulse">
                          Running
                        </span>
                      ) : (() => {
                        const tradePnl = getTradeProfit(trade);
                        return tradePnl >= 0 ? (
                          <span className="text-emerald-400 font-bold">
                            +${Math.abs(tradePnl).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-rose-400 font-bold">
                            -${Math.abs(tradePnl).toFixed(2)}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer Controls */}
      {filteredTrades.length > 0 && (
        <div className="px-4 py-2.5 border-t border-zinc-800/80 bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
          {/* Display range */}
          <div className="font-sans">
            Showing{' '}
            <span className="text-white font-mono font-semibold">
              {((safePage - 1) * pageSize + 1).toLocaleString()}
            </span>
            {' - '}
            <span className="text-white font-mono font-semibold">
              {Math.min(safePage * pageSize, filteredTrades.length).toLocaleString()}
            </span>{' '}
            of{' '}
            <span className="text-white font-mono font-semibold">
              {filteredTrades.length.toLocaleString()}
            </span>{' '}
            trades {boundedTrades.length >= MAX_HISTORY_CAPACITY && '(Max 5,000)'}
          </div>

          {/* Rows per page selector & navigation buttons */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-sans">
              <span className="text-zinc-500">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </select>
            </div>

            {/* Page navigation buttons */}
            <div className="flex items-center gap-1 font-mono">
              <button
                type="button"
                onClick={() => handlePageChange(1)}
                disabled={safePage === 1}
                title="First Page"
                className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 hover:text-white transition-colors"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(safePage - 1)}
                disabled={safePage === 1}
                title="Previous Page"
                className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <span className="px-2 text-zinc-300 font-sans text-xs">
                Page <span className="text-white font-mono font-semibold">{safePage}</span> of{' '}
                <span className="text-white font-mono font-semibold">{totalPages}</span>
              </span>

              <button
                type="button"
                onClick={() => handlePageChange(safePage + 1)}
                disabled={safePage === totalPages}
                title="Next Page"
                className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 hover:text-white transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(totalPages)}
                disabled={safePage === totalPages}
                title="Last Page"
                className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 hover:text-white transition-colors"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

