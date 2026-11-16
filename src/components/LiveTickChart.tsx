import React, { useEffect, useRef, useState } from 'react';
import { MarketTick } from '../types';
import { Activity, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';

interface LiveTickChartProps {
  ticks: MarketTick[];
  symbol: string;
  symbolName: string;
  contractType?: string;
  entrySpot?: number;
}

export const LiveTickChart: React.FC<LiveTickChartProps> = ({
  ticks,
  symbol,
  symbolName,
  contractType,
  entrySpot,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 260 });

  const latestTick = ticks.length > 0 ? ticks[ticks.length - 1] : null;
  const prevTick = ticks.length > 1 ? ticks[ticks.length - 2] : null;

  const isTickUp = latestTick && prevTick ? latestTick.quote >= prevTick.quote : true;
  const quoteFormatted = latestTick ? latestTick.quote.toFixed(2) : '---';
  const lastDigit = latestTick ? String(latestTick.quote.toFixed(2)).slice(-1) : '-';

  // ResizeObserver for canvas dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Draw chart on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || ticks.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Draw horizontal grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridRows = 4;
    for (let i = 1; i <= gridRows; i++) {
      const y = (height / (gridRows + 1)) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const quotes = ticks.map((t) => t.quote);
    const minQuote = Math.min(...quotes);
    const maxQuote = Math.max(...quotes);
    const range = maxQuote - minQuote || 0.01;
    const paddingY = 30;

    const getY = (val: number) => {
      const normalized = (val - minQuote) / range;
      return height - paddingY - normalized * (height - paddingY * 2);
    };

    const getX = (idx: number) => {
      if (ticks.length <= 1) return width / 2;
      return (idx / (ticks.length - 1)) * (width - 60) + 10;
    };

    // Draw entry spot line if present
    if (entrySpot && entrySpot >= minQuote && entrySpot <= maxQuote) {
      const entryY = getY(entrySpot);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, entryY);
      ctx.lineTo(width - 50, entryY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.fillText(`ENTRY: ${entrySpot.toFixed(2)}`, 10, entryY - 6);
    }

    // Draw gradient area under line
    const areaGradient = ctx.createLinearGradient(0, 0, 0, height);
    if (isTickUp) {
      areaGradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
      areaGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    } else {
      areaGradient.addColorStop(0, 'rgba(244, 63, 94, 0.25)');
      areaGradient.addColorStop(1, 'rgba(244, 63, 94, 0.0)');
    }

    ctx.beginPath();
    ctx.moveTo(getX(0), height);
    for (let i = 0; i < ticks.length; i++) {
      ctx.lineTo(getX(i), getY(ticks[i].quote));
    }
    ctx.lineTo(getX(ticks.length - 1), height);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    // Draw main price line
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = isTickUp ? '#10b981' : '#f43f5e';
    for (let i = 0; i < ticks.length; i++) {
      const x = getX(i);
      const y = getY(ticks[i].quote);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw latest pulse point
    const lastX = getX(ticks.length - 1);
    const lastY = getY(ticks[ticks.length - 1].quote);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.fillStyle = isTickUp ? '#10b981' : '#f43f5e';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lastX, lastY, 12, 0, Math.PI * 2);
    ctx.strokeStyle = isTickUp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw right side latest price tag
    ctx.fillStyle = isTickUp ? '#10b981' : '#f43f5e';
    ctx.fillRect(width - 55, lastY - 11, 55, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ticks[ticks.length - 1].quote.toFixed(2), width - 27, lastY + 3);
    ctx.textAlign = 'start';
  }, [ticks, dimensions, isTickUp, entrySpot]);

  return (
    <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800/90 overflow-hidden flex flex-col">
      {/* Top Header of the Chart */}
      <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/40">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm sm:text-base">{symbolName}</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 font-mono">
              {symbol}
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
            <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
            Live Tick Feed
          </span>
        </div>

        {/* Current price badge */}
        <div className="flex items-center gap-3">
          {/* Last digit badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60">
            <span className="text-[10px] uppercase font-semibold text-zinc-400">Last Digit:</span>
            <span
              className={`font-mono text-sm font-black ${
                Number(lastDigit) % 2 === 0 ? 'text-cyan-400' : 'text-amber-400'
              }`}
            >
              {lastDigit}
            </span>
            <span className="text-[9px] px-1 rounded bg-zinc-900 text-zinc-400">
              {Number(lastDigit) % 2 === 0 ? 'EVEN' : 'ODD'}
            </span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border font-mono font-bold text-sm ${
              isTickUp
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}
          >
            {isTickUp ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
            <span>{quoteFormatted}</span>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div ref={containerRef} className="w-full h-56 sm:h-64 relative p-2 bg-zinc-950/20">
        {ticks.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-2">
            <Activity className="w-6 h-6 animate-pulse text-zinc-600" />
            <span className="text-xs">Streaming real-time ticks from Deriv WebSocket...</span>
          </div>
        ) : (
          <canvas ref={canvasRef} className="w-full h-full block" />
        )}
      </div>
    </div>
  );
};
