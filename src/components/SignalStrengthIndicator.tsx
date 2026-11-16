import React, { useState } from 'react';
import { NetworkSignalState, SignalLevel } from '../types';
import { Wifi, WifiOff, Activity, AlertTriangle, RefreshCw, Gauge, Zap } from 'lucide-react';
import { derivWs } from '../services/derivWs';
import { networkEngine } from '../services/networkEngine';

interface SignalStrengthIndicatorProps {
  signal: NetworkSignalState;
  onSimulateGlitch?: () => void;
  onReconnect?: () => void;
  compact?: boolean;
  countdownSeconds?: number;
  isGlitch?: boolean;
}

export const SignalStrengthIndicator: React.FC<SignalStrengthIndicatorProps> = ({
  signal,
  onSimulateGlitch,
  onReconnect,
  compact = false,
  countdownSeconds,
  isGlitch = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const isDisconnected = isGlitch || signal.bars === 0 || !signal.isOnline;

  const getBarColor = (barIndex: number) => {
    if (isDisconnected) {
      return 'bg-rose-500/25 border-rose-500/30';
    }
    if (barIndex <= signal.bars) {
      if (signal.bars === 4) return 'bg-emerald-400 border-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
      if (signal.bars === 3) return 'bg-lime-400 border-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.5)]';
      if (signal.bars === 2) return 'bg-amber-400 border-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]';
      return 'bg-orange-500 border-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)] animate-pulse';
    }
    return 'bg-zinc-800 border-zinc-700/50';
  };

  const getStatusBadge = () => {
    if (isDisconnected) {
      return {
        text: 'DISCONNECTED',
        speed: '0.0 Mbps',
        badgeClass: 'bg-rose-500/25 text-rose-300 border-rose-500/60 animate-pulse font-extrabold',
        rippleColor: 'bg-rose-500',
        dotColor: 'bg-rose-500',
        icon: <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />,
      };
    }
    if (signal.bars === 4) {
      return {
        text: `Excellent (${signal.latencyMs}ms)`,
        speed: signal.speedText || '8.5 Mbps',
        badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        rippleColor: 'bg-emerald-400',
        dotColor: 'bg-emerald-400',
        icon: <Wifi className="w-3.5 h-3.5 text-emerald-400" />,
      };
    }
    if (signal.bars === 3) {
      return {
        text: `Good (${signal.latencyMs}ms)`,
        speed: signal.speedText || '4.2 Mbps',
        badgeClass: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
        rippleColor: 'bg-lime-400',
        dotColor: 'bg-lime-400',
        icon: <Wifi className="w-3.5 h-3.5 text-lime-400" />,
      };
    }
    if (signal.bars === 2) {
      return {
        text: `Fair (${signal.latencyMs}ms)`,
        speed: signal.speedText || '1.8 Mbps',
        badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        rippleColor: 'bg-amber-400',
        dotColor: 'bg-amber-400',
        icon: <Activity className="w-3.5 h-3.5 text-amber-400" />,
      };
    }
    // 1 bar = Poor Signal
    return {
      text: `POOR SIGNAL (${signal.latencyMs}ms)`,
      speed: signal.speedText || '400 kbps',
      badgeClass: 'bg-orange-500/20 text-orange-200 border-orange-500/50 animate-pulse font-bold',
      rippleColor: 'bg-orange-500',
      dotColor: 'bg-orange-500',
      icon: <Activity className="w-3.5 h-3.5 text-orange-400 animate-pulse" />,
    };
  };

  const status = getStatusBadge();

  const handleTestOverride = (override: SignalLevel | null) => {
    derivWs.setSignalOverride(override);
    networkEngine.setSimulationOverride(override);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          if (isDisconnected && onReconnect) {
            onReconnect();
          } else {
            setShowDetails(!showDetails);
          }
        }}
        title={
          isDisconnected
            ? 'DISCONNECTED: Click to apply back-end refresh immediately.'
            : 'Live network speed monitor & signal calculation. Click for details & signal tests.'
        }
        className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 rounded-lg border text-xs font-mono transition-all cursor-pointer select-none whitespace-nowrap ${
          signal.bars === 0 || !signal.isOnline
            ? 'bg-rose-950/80 border-rose-500 text-rose-200 shadow-lg shadow-rose-950/60 animate-pulse'
            : signal.bars === 1
            ? 'bg-amber-950/70 border-amber-500/70 text-amber-200 shadow-md shadow-amber-950/40'
            : 'bg-zinc-900/90 border-zinc-800 hover:border-zinc-700 text-zinc-300'
        }`}
      >
        {/* 4-Bar Signal Strength Meter */}
        <div className="flex items-end gap-0.5 h-3.5 w-4 pb-0.5 shrink-0" aria-label={`Signal strength: ${signal.bars} of 4 bars`}>
          <div className={`w-0.5 h-1.5 rounded-xs transition-colors duration-300 ${getBarColor(1)}`} />
          <div className={`w-0.5 h-2 rounded-xs transition-colors duration-300 ${getBarColor(2)}`} />
          <div className={`w-0.5 h-2.5 rounded-xs transition-colors duration-300 ${getBarColor(3)}`} />
          <div className={`w-0.5 h-3.5 rounded-xs transition-colors duration-300 ${getBarColor(4)}`} />
        </div>

        {/* Live Active "Beeping" Radar Pulse Indicator */}
        <div className="relative flex h-2 w-2 items-center justify-center shrink-0" title="Continuous live network speed calculation pulse">
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 transition-all duration-700 ${
              signal.bars === 0
                ? 'animate-ping bg-rose-500'
                : signal.bars === 1
                ? 'animate-ping bg-orange-400'
                : 'animate-ping bg-emerald-400'
            }`}
          />
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${status.dotColor}`} />
        </div>

        {/* Speed & Signal Text */}
        {!compact ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`text-[10px] sm:text-[11px] font-bold tracking-tight ${
                signal.bars === 0
                  ? 'text-rose-300 font-extrabold'
                  : signal.bars === 1
                  ? 'text-orange-300 font-bold'
                  : 'text-zinc-200'
              }`}
            >
              {status.text}
            </span>
            {signal.bars > 0 && (
              <span className="hidden min-[380px]:inline text-[10px] text-zinc-400 border-l border-zinc-700/80 pl-1.5 font-mono">
                {status.speed}
              </span>
            )}
          </div>
        ) : (
          <span className={`text-[11px] font-semibold whitespace-nowrap ${signal.bars === 0 ? 'text-rose-300' : 'text-zinc-400'}`}>
            {signal.bars === 0 ? 'NO SIGNAL' : `${signal.latencyMs}ms`}
          </span>
        )}
      </button>

      {/* Popover Card */}
      {showDetails && (
        <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-12 sm:top-full mt-2 sm:w-80 p-3.5 bg-zinc-900 border border-zinc-700/90 rounded-xl shadow-2xl shadow-black/90 z-50 animate-fade-in text-xs space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-1.5 font-bold text-zinc-100">
              {status.icon}
              <span>Live Network Speed &amp; Signal</span>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${status.badgeClass}`}>
              {signal.bars === 0 ? 'NO SIGNAL' : `${signal.bars}/4 BARS`}
            </span>
          </div>

          <div className="space-y-2 text-zinc-300 font-mono text-[11px] bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80">
            <div className="flex justify-between items-center py-0.5">
              <span className="text-zinc-400 flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5 text-blue-400" />
                Network Speed:
              </span>
              <span className="text-zinc-100 font-bold text-xs">
                {signal.speedText || '8.5 Mbps'}
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5">
              <span className="text-zinc-400 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Latency (RTT):
              </span>
              <span className="text-zinc-200 font-bold">
                {signal.latencyMs > 0 ? `${signal.latencyMs} ms` : 'Unreachable'}
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5">
              <span className="text-zinc-400">Jitter Stability:</span>
              <span className="text-zinc-300">
                &plusmn;{signal.jitterMs || 4} ms
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5">
              <span className="text-zinc-400">Signal Rating:</span>
              <span
                className={`font-bold capitalize ${
                  signal.level === 'excellent'
                    ? 'text-emerald-400'
                    : signal.level === 'good'
                    ? 'text-lime-400'
                    : signal.level === 'fair'
                    ? 'text-amber-400'
                    : signal.level === 'poor'
                    ? 'text-orange-400'
                    : 'text-rose-400'
                }`}
              >
                {signal.level === 'none' ? 'No Signal (0 Bars)' : signal.level}
              </span>
            </div>

            <div className="flex justify-between items-center py-0.5 text-[10px]">
              <span className="text-zinc-500">Speed Calculation:</span>
              <span className="text-emerald-400/90 font-medium flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                Active (Beeping Every 1.5s)
              </span>
            </div>
          </div>

          {/* Test Controls */}
          <div className="pt-2 border-t border-zinc-800 space-y-1.5">
            <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
              Simulate Network Conditions
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  handleTestOverride('poor');
                }}
                className="py-1.5 px-2 rounded-lg bg-orange-950/60 hover:bg-orange-900/80 border border-orange-700/60 text-orange-200 text-[10px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                title="Test how poor signal (1 bar) displays"
              >
                <AlertTriangle className="w-3 h-3 text-orange-400" />
                <span>Test Poor Signal</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowDetails(false);
                  handleTestOverride('none');
                  if (onSimulateGlitch) {
                    onSimulateGlitch();
                  }
                }}
                className="py-1.5 px-2 rounded-lg bg-rose-950/70 hover:bg-rose-900/90 border border-rose-600/70 text-rose-200 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                title="Immediately test network glitch & auto-refresh in a blink"
              >
                <WifiOff className="w-3 h-3 text-rose-400" />
                <span>Test Network Glitch</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                handleTestOverride(null);
              }}
              className="w-full py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3 text-emerald-400" />
              <span>Resume Live Auto Speed Check</span>
            </button>

            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="w-full py-1 text-center text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
