import React from 'react';
import { CorrectedLossItem } from '../types';
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert, Sparkles, X } from 'lucide-react';

interface CorrectedLossAlertBoxProps {
  items: CorrectedLossItem[];
  currency: string;
  nextCalculatedStake: number;
  currentMartingaleStep: number;
  onDismissItem?: (id: string) => void;
  onClearAll?: () => void;
}

export const CorrectedLossAlertBox: React.FC<CorrectedLossAlertBoxProps> = ({
  items,
  currency = 'USD',
  nextCalculatedStake,
  currentMartingaleStep,
  onDismissItem,
  onClearAll,
}) => {
  const pendingItems = items.filter((item) => item.status === 'pending_recovery');
  const recoveredItems = items.filter((item) => item.status === 'recovered').slice(0, 3);

  if (pendingItems.length === 0 && recoveredItems.length === 0) {
    return null;
  }

  const totalPendingLoss = pendingItems.reduce((acc, curr) => acc + curr.lossAmount, 0);

  return (
    <div
      id="corrected-loss-alert-box"
      className="rounded-2xl border border-rose-500/40 bg-gradient-to-r from-rose-950/40 via-zinc-900/90 to-amber-950/30 p-4 sm:p-5 shadow-xl shadow-rose-950/20 backdrop-blur-md transition-all duration-300 animate-in fade-in"
    >
      {/* Header bar with Counter Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <ShieldAlert className="w-5 h-5 animate-pulse" />
            {pendingItems.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white shadow">
                {pendingItems.length}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                Deriv Verified Settlement &amp; Loss Recovery Counter
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                {pendingItems.length} {pendingItems.length === 1 ? 'Corrected Loss' : 'Corrected Losses'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Trade settled locally as WIN was officially confirmed as LOSS by Deriv exit barrier. Balance deducted and Martingale armed for the NEXT signal (All volatilities remain free to scan).
            </p>
          </div>
        </div>

        {/* Counter Summary Box */}
        <div className="flex items-center gap-3">
          <div className="bg-black/60 border border-rose-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2 font-mono">
            <span className="text-[11px] text-zinc-400">Total Unrecovered Loss:</span>
            <span className="text-sm font-black text-rose-400">
              -${totalPendingLoss.toFixed(2)} {currency}
            </span>
          </div>
          {onClearAll && items.length > 0 && (
            <button
              onClick={onClearAll}
              title="Clear all alerts"
              className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Pending Corrected Losses List */}
      <div className="mt-3.5 space-y-2.5">
        {pendingItems.map((item) => (
          <div
            key={item.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950/70 border border-rose-500/30 text-xs font-mono"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-sans font-bold text-white text-sm">
                  {item.symbolName || item.symbol}
                </span>
                <span className="text-[11px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60">
                  Contract #{item.contractId}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Local: WON ➜ Deriv Exit: LOST (-${item.lossAmount.toFixed(2)})
                </span>
              </div>

              <div className="flex items-center gap-3 text-zinc-400 text-[11px] pt-0.5">
                <span>
                  Entry Barrier: <strong className="text-cyan-400">{item.entryBarrier || '---'}</strong>
                </span>
                <span>•</span>
                <span>
                  Exit Barrier: <strong className="text-amber-400">{item.exitBarrier || '---'}</strong>
                </span>
                <span>•</span>
                <span className="text-zinc-500">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>

            {/* Next Trade Martingale Action Indicator */}
            <div className="flex items-center gap-2.5 self-start sm:self-auto bg-rose-950/50 border border-rose-500/40 px-3 py-2 rounded-xl">
              <div className="text-right">
                <div className="text-[10px] text-rose-300 font-bold uppercase flex items-center gap-1 justify-end">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  All Volatilities Free &bull; Next Signal Armed
                </div>
                <div className="text-xs text-white font-bold">
                  Next Stake:{' '}
                  <span className="text-emerald-400">
                    ${Math.max(nextCalculatedStake, item.recoveryStake || 0).toFixed(2)} {currency}
                  </span>
                  <span className="text-[10px] text-zinc-400 ml-1">
                    (Recovers -${item.lossAmount.toFixed(2)} @ 83% payout)
                  </span>
                </div>
              </div>
              {onDismissItem && (
                <button
                  onClick={() => onDismissItem(item.id)}
                  className="p-1 rounded text-zinc-500 hover:text-white transition-colors"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Recently Recovered Corrected Losses */}
        {recoveredItems.map((rec) => (
          <div
            key={rec.id}
            className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-xs font-mono"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-zinc-300">
                Contract #{rec.contractId} on {rec.symbolName}: Loss (-${rec.lossAmount.toFixed(2)}){' '}
                <strong className="text-emerald-400">Successfully Recovered</strong>
                {rec.recoveredContractId && ` on Trade #${rec.recoveredContractId}`}!
              </span>
            </div>
            {onDismissItem && (
              <button
                onClick={() => onDismissItem(rec.id)}
                className="text-zinc-500 hover:text-white p-1 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
