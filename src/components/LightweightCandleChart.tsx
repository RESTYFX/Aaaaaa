import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  CandlestickData,
  LineStyle,
  createSeriesMarkers,
} from 'lightweight-charts';
import {
  Activity,
  Maximize2,
  Minimize2,
  RefreshCw,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Layers,
  Settings2,
  Check,
  ChevronDown,
  X,
  Sliders,
  Plus,
  Minus,
  RotateCcw,
  Info,
} from 'lucide-react';
import { MarketDefinition, VOLATILITY_MARKETS } from '../data/markets';
import { MarketSelector } from './MarketSelector';
import { CandleData, OhlcData, MarketTick } from '../types';
import {
  calculateSMC,
  DEFAULT_SMC_CONFIG,
  SmcIndicatorConfig,
  SmcAnalysisResult,
} from '../indicators/smcIndicator';
import { SmcChartOverlay } from './SmcChartOverlay';

interface LightweightCandleChartProps {
  symbol: string;
  symbolName: string;
  onSelectMarket: (market: MarketDefinition) => void;
  candles: CandleData[];
  latestTick?: MarketTick | null;
  entrySpot?: number;
  contractType?: string;
  onRefreshCandles?: () => void;
  isLoadingCandles?: boolean;
  onSmcUpdate?: (smcResult: SmcAnalysisResult) => void;
  smcConfig?: SmcIndicatorConfig;
  onSmcConfigChange?: (config: SmcIndicatorConfig) => void;
}

function detectPricePrecision(candles: CandlestickData<UTCTimestamp>[]): { precision: number; minMove: number } {
  let maxDecimals = 2;
  const sample = candles.slice(-30);
  for (const c of sample) {
    for (const val of [c.open, c.high, c.low, c.close]) {
      if (typeof val === 'number' && !isNaN(val)) {
        const str = val.toString();
        const dotIndex = str.indexOf('.');
        if (dotIndex !== -1) {
          const decimals = str.length - dotIndex - 1;
          if (decimals > maxDecimals) {
            maxDecimals = Math.min(decimals, 5);
          }
        }
      }
    }
  }
  const minMove = Number((1 / Math.pow(10, maxDecimals)).toFixed(maxDecimals));
  return { precision: maxDecimals, minMove };
}

export const LightweightCandleChart: React.FC<LightweightCandleChartProps> = ({
  symbol,
  symbolName,
  onSelectMarket,
  candles,
  latestTick,
  entrySpot,
  contractType,
  onRefreshCandles,
  isLoadingCandles,
  onSmcUpdate,
  smcConfig: propSmcConfig,
  onSmcConfigChange,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLineRef = useRef<any>(null);
  const markersPluginRef = useRef<any>(null);
  const lastLoadedSymbolRef = useRef<string>('');
  const lastCandleCountRef = useRef<number>(0);
  const lastFirstEpochRef = useRef<number>(0);
  const candlesRef = useRef<CandleData[]>(candles);
  candlesRef.current = candles;

  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('deriv_chart_is_expanded') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('deriv_chart_is_expanded', String(isExpanded));
    } catch {}
  }, [isExpanded]);
  const [activeOhlc, setActiveOhlc] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    time?: number;
  } | null>(null);
  const [secondsToNextCandle, setSecondsToNextCandle] = useState<number>(60);

  // SMC Indicator configuration state with localStorage persistence
  const [isSmcEnabled, setIsSmcEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('deriv_smc_indicator_enabled');
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load saved SMC enabled state:', e);
    }
    return true;
  });

  const [showSmcSettings, setShowSmcSettings] = useState<boolean>(false);

  const [internalSmcConfig, setInternalSmcConfig] = useState<SmcIndicatorConfig>(() => {
    try {
      const saved = localStorage.getItem('deriv_smc_indicator_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        const sp = Math.max(2, Math.min(100, Math.round(Number(parsed.swingPoint ?? parsed.swingLength ?? 10))));
        return {
          ...DEFAULT_SMC_CONFIG,
          ...parsed,
          showInternals: false,
          confluenceFilter: parsed.confluenceFilter ?? true,
          swingPoint: sp,
          swingLength: sp,
        };
      }
    } catch (e) {
      console.warn('Failed to load saved SMC indicator config:', e);
    }
    return DEFAULT_SMC_CONFIG;
  });

  // Active configuration (prefers prop if controlled by parent, else internal state)
  const activeSmcConfig = propSmcConfig || internalSmcConfig;

  // Handle configuration updates
  const handleUpdateSmcConfig = useCallback(
    (updater: SmcIndicatorConfig | ((prev: SmcIndicatorConfig) => SmcIndicatorConfig)) => {
      const nextConfig = typeof updater === 'function' ? updater(activeSmcConfig) : updater;
      const sp = Math.max(2, Math.min(100, Math.round(Number(nextConfig.swingPoint ?? nextConfig.swingLength ?? 10))));
      const normalized: SmcIndicatorConfig = {
        ...nextConfig,
        swingPoint: sp,
        swingLength: sp,
      };

      setInternalSmcConfig(normalized);
      try {
        localStorage.setItem('deriv_smc_indicator_config', JSON.stringify(normalized));
      } catch (e) {
        console.warn('Failed to persist SMC indicator config:', e);
      }
      onSmcConfigChange?.(normalized);
    },
    [activeSmcConfig, onSmcConfigChange]
  );

  const handleResetDefaults = useCallback(() => {
    handleUpdateSmcConfig(DEFAULT_SMC_CONFIG);
  }, [handleUpdateSmcConfig]);

  // Automatically save SMC enabled state
  useEffect(() => {
    try {
      localStorage.setItem('deriv_smc_indicator_enabled', JSON.stringify(isSmcEnabled));
    } catch (e) {
      console.warn('Failed to persist SMC enabled state:', e);
    }
  }, [isSmcEnabled]);

  // Chart dimensions & revision trigger for SVG overlay coordinate synchronization
  const [chartDimensions, setChartDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 340,
  });
  const [chartRevision, setChartRevision] = useState<number>(0);

  // Calculate LuxAlgo SMC Break of Structure (BOS) and Change of Character (CHoCH) based on user's selected swing point
  const smcResult = useMemo(() => {
    if (!isSmcEnabled) {
      return {
        structures: [],
        swingPoints: [],
        orderBlocks: [],
        currentTrend: 'NEUTRAL' as const,
      };
    }
    return calculateSMC(candles, activeSmcConfig);
  }, [candles, isSmcEnabled, activeSmcConfig]);

  // Report SMC result to parent if requested
  useEffect(() => {
    onSmcUpdate?.(smcResult);
  }, [smcResult, onSmcUpdate]);

  // Calculate 60-second countdown to next 1-minute candle
  useEffect(() => {
    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = 60 - (now % 60);
      setSecondsToNextCandle(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize TradingView Lightweight Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up any existing chart
    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
      seriesRef.current = null;
      priceLineRef.current = null;
      markersPluginRef.current = null;
    }

    const container = chartContainerRef.current;
    const width = container.clientWidth || 600;
    const height = isExpanded ? 520 : 340;
    setChartDimensions({ width, height });

    const chart = createChart(container, {
      width: width,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(251, 191, 36, 0.5)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#27272a',
        },
        horzLine: {
          color: 'rgba(251, 191, 36, 0.5)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#27272a',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: {
          top: 0.14,
          bottom: 0.14,
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 11,
        minBarSpacing: 4,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // Add 1-minute Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: true,
      borderColor: '#10b981',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      wickVisible: true,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    // Crosshair move handler to update OHLC header readout
    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.has(candleSeries)) {
        const data = param.seriesData.get(candleSeries) as any;
        if (data && typeof data.close === 'number' && typeof data.open === 'number') {
          setActiveOhlc({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            time: typeof param.time === 'number' ? param.time : undefined,
          });
          return;
        }
      }
      // When cursor leaves bars/chart, reset activeOhlc so header seamlessly displays the latest forming candle
      setActiveOhlc(null);
    });

    // Subscribe to chart logical range changes (pan / zoom) to trigger overlay recalculation
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      setChartRevision((r) => r + 1);
    });

    chartInstanceRef.current = chart;
    seriesRef.current = candleSeries;
    lastLoadedSymbolRef.current = '';
    lastCandleCountRef.current = 0;

    // ResizeObserver for fluid responsive width & height
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0] && chartInstanceRef.current) {
        const { width: newWidth } = entries[0].contentRect;
        if (newWidth > 0) {
          const newHeight = isExpanded ? 520 : 340;
          chartInstanceRef.current.applyOptions({
            width: newWidth,
            height: newHeight,
          });
          setChartDimensions({ width: newWidth, height: newHeight });
          setChartRevision((r) => r + 1);
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
        seriesRef.current = null;
        priceLineRef.current = null;
        markersPluginRef.current = null;
        lastLoadedSymbolRef.current = '';
        lastCandleCountRef.current = 0;
        lastFirstEpochRef.current = 0;
      }
    };
  }, [isExpanded]);

  // Load and update candles into series
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    // Format & deduplicate candles sorted by epoch ascending
    const sorted = [...candles].sort((a, b) => a.epoch - b.epoch);
    const uniqueMap = new Map<number, CandleData>();
    for (const c of sorted) {
      if (
        typeof c.epoch === 'number' &&
        !isNaN(c.epoch) &&
        typeof c.open === 'number' &&
        !isNaN(c.open) &&
        typeof c.high === 'number' &&
        !isNaN(c.high) &&
        typeof c.low === 'number' &&
        !isNaN(c.low) &&
        typeof c.close === 'number' &&
        !isNaN(c.close)
      ) {
        uniqueMap.set(c.epoch, c);
      }
    }

    const formattedData: CandlestickData<UTCTimestamp>[] = Array.from(uniqueMap.values()).map((c) => ({
      time: c.epoch as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    if (formattedData.length === 0) return;

    const firstEpoch = formattedData[0].time as number;
    const symbolChanged = lastLoadedSymbolRef.current !== symbol;
    const isFirstLoadForInstance = lastCandleCountRef.current === 0;
    const firstEpochChanged = firstEpoch !== lastFirstEpochRef.current;
    const countDiff = Math.abs(formattedData.length - lastCandleCountRef.current);

    // Dynamically adjust price format for the symbol's tick decimals
    const { precision, minMove } = detectPricePrecision(formattedData);
    try {
      seriesRef.current.applyOptions({
        priceFormat: {
          type: 'price',
          precision,
          minMove,
        },
      });
    } catch {}

    if (symbolChanged || isFirstLoadForInstance || firstEpochChanged || countDiff > 1) {
      // Full dataset replacement (symbol switch, first load, or full historical data sync from Deriv)
      seriesRef.current.setData(formattedData);
      lastLoadedSymbolRef.current = symbol;
      lastCandleCountRef.current = formattedData.length;
      lastFirstEpochRef.current = firstEpoch;
      if (symbolChanged || isFirstLoadForInstance) {
        if (chartInstanceRef.current) {
          chartInstanceRef.current.timeScale().fitContent();
        }
      }
    } else {
      // Incremental live update (same bar tick update or single new candle append)
      const last = formattedData[formattedData.length - 1];
      try {
        seriesRef.current.update(last);
      } catch {
        seriesRef.current.setData(formattedData);
      }
      lastCandleCountRef.current = formattedData.length;
      lastFirstEpochRef.current = firstEpoch;
    }

    setChartRevision((r) => r + 1);
  }, [candles, symbol]);

  // Sync Series Markers for BOS and CHoCH on the Candlestick series
  useEffect(() => {
    if (!seriesRef.current) return;

    if (!isSmcEnabled || smcResult.structures.length === 0) {
      if (markersPluginRef.current) {
        try {
          markersPluginRef.current.setMarkers([]);
        } catch {
          // ignore
        }
      }
      return;
    }

    // Set of valid candle epochs currently in chart
    const validTimes = new Set(candles.map((c) => c.epoch));

    // Filter structures according to config and sort chronologically
    const filtered = smcResult.structures
      .filter((s) => validTimes.has(s.breakTime) && ((s.isInternal && activeSmcConfig.showInternals) || (!s.isInternal && activeSmcConfig.showSwings)))
      .sort((a, b) => a.breakTime - b.breakTime);

    const markers: Array<{
      time: UTCTimestamp;
      position: 'aboveBar' | 'belowBar';
      color: string;
      shape: 'arrowUp' | 'arrowDown';
      text: string;
    }> = [];

    // Deduplicate markers by bar time to adhere to lightweight-charts requirements
    const seenTimes = new Set<number>();
    for (const s of filtered) {
      if (seenTimes.has(s.breakTime)) continue;
      seenTimes.add(s.breakTime);

      const isBull = s.direction === 'bullish';
      markers.push({
        time: s.breakTime as UTCTimestamp,
        position: isBull ? 'belowBar' : 'aboveBar',
        color: isBull ? '#10b981' : '#f43f5e',
        shape: isBull ? 'arrowUp' : 'arrowDown',
        text: `${s.type}`,
      });
    }

    try {
      if (!markersPluginRef.current) {
        markersPluginRef.current = createSeriesMarkers(seriesRef.current, markers);
      } else {
        markersPluginRef.current.setMarkers(markers);
      }
    } catch (err) {
      console.warn('SMC markers update warning:', err);
    }
  }, [smcResult, isSmcEnabled, activeSmcConfig, candles]);

  // Update entry spot price line when active trade is open
  useEffect(() => {
    if (!seriesRef.current) return;

    if (priceLineRef.current) {
      try {
        seriesRef.current.removePriceLine(priceLineRef.current);
      } catch {
        // ignore
      }
      priceLineRef.current = null;
    }

    if (entrySpot && entrySpot > 0) {
      priceLineRef.current = seriesRef.current.createPriceLine({
        price: entrySpot,
        color: '#38bdf8',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `ENTRY SPOT [${contractType || 'OPEN'}]`,
      });
    }
  }, [entrySpot, contractType]);

  // Handle fit content action
  const handleFitContent = useCallback(() => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.timeScale().fitContent();
      setChartRevision((r) => r + 1);
    }
  }, []);

  // Compute session metrics
  const latestPrice = latestTick?.quote ?? (candles.length > 0 ? candles[candles.length - 1].close : undefined);
  const firstCandle = candles.length > 0 ? candles[0] : null;
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const currentCandle = activeOhlc || lastCandle;

  // Format price helper for crisp OHLC reading matching symbol's precision
  const formatOhlcPrice = (val: number | undefined) => {
    if (val === undefined || val === null || isNaN(val)) return '—';
    const str = val.toString();
    const dot = str.indexOf('.');
    const decimals = dot !== -1 ? Math.min(Math.max(str.length - dot - 1, 2), 4) : 2;
    return val.toFixed(decimals);
  };

  const sessionChange =
    firstCandle && latestPrice
      ? Number((((latestPrice - firstCandle.open) / firstCandle.open) * 100).toFixed(2))
      : 0;

  const isUp = sessionChange >= 0;

  return (
    <div
      id="lightweight-candle-chart-container"
      className="w-full rounded-2xl bg-zinc-950 border border-zinc-800 shadow-xl overflow-hidden flex flex-col transition-all duration-200"
    >
      {/* Top Header Bar: Market Selector, Timeframe, OHLC Stats, and Controls */}
      <div className="p-3 sm:p-4 border-b border-zinc-800/80 bg-zinc-900/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left: Market Selector & Market Info */}
        <div className="flex flex-wrap items-center gap-2.5">
          <MarketSelector
            selectedSymbol={symbol}
            onSelectMarket={onSelectMarket}
            currentPrice={latestPrice}
          />

          {/* Timeframe pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-semibold">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>1m Candle</span>
          </div>

          {/* Countdown to next 1m candle */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900/80 border border-zinc-800/80 text-[11px] font-mono text-zinc-400">
            <span className="text-zinc-500">Next bar:</span>
            <span className={`font-bold ${secondsToNextCandle <= 5 ? 'text-amber-400 animate-pulse' : 'text-zinc-300'}`}>
              {secondsToNextCandle}s
            </span>
          </div>

          {/* Session Change */}
          <div
            className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold font-mono border ${
              isUp
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
          >
            {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            <span>{isUp ? `+${sessionChange}%` : `${sessionChange}%`}</span>
          </div>
        </div>

        {/* Right: Real-time 1m OHLC Readout & Action Controls */}
        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3">
          {/* OHLC Bar */}
          {currentCandle && (
            <div className="flex items-center gap-2 sm:gap-3 text-[11px] font-mono bg-zinc-900/60 px-3 py-1 rounded-lg border border-zinc-800/60">
              <span className="text-zinc-400">
                O: <span className="text-zinc-200">{formatOhlcPrice(currentCandle.open)}</span>
              </span>
              <span className="text-zinc-400">
                H: <span className="text-emerald-400">{formatOhlcPrice(currentCandle.high)}</span>
              </span>
              <span className="text-zinc-400">
                L: <span className="text-rose-400">{formatOhlcPrice(currentCandle.low)}</span>
              </span>
              <span className="text-zinc-400">
                C:{' '}
                <span
                  className={`font-bold ${
                    currentCandle.close >= currentCandle.open ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatOhlcPrice(currentCandle.close)}
                </span>
              </span>
              {activeOhlc && (
                <span className="text-[10px] text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  Cursor
                </span>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5">
            {/* SMC Indicator Toggle Button */}
            <button
              type="button"
              id="chart-smc-toggle-btn"
              title="Toggle Smart Money Concepts (BOS & CHoCH)"
              onClick={() => setIsSmcEnabled((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                isSmcEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>SMC</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
                  isSmcEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {isSmcEnabled ? `SP: ${activeSmcConfig.swingPoint}` : 'OFF'}
              </span>
            </button>

            {/* SMC Settings Dropdown Button */}
            {isSmcEnabled && (
              <button
                type="button"
                id="chart-smc-settings-btn"
                title="SMC Indicator Settings (Swing Points, BOS & CHoCH)"
                onClick={() => setShowSmcSettings((prev) => !prev)}
                className={`p-1.5 rounded-lg border text-xs transition-all cursor-pointer ${
                  showSmcSettings
                    ? 'bg-zinc-800 border-zinc-600 text-white'
                    : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>
            )}

            {onRefreshCandles && (
              <button
                type="button"
                id="chart-refresh-btn"
                title="Refresh 1m candles"
                onClick={onRefreshCandles}
                disabled={isLoadingCandles}
                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCandles ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            )}

            <button
              type="button"
              id="chart-fit-btn"
              title="Fit chart view"
              onClick={handleFitContent}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all text-xs font-medium cursor-pointer"
            >
              Fit
            </button>

            <button
              type="button"
              id="chart-expand-btn"
              title={isExpanded ? 'Compress chart' : 'Expand chart'}
              onClick={() => setIsExpanded((prev) => !prev)}
              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* SMC Live Signal Status Sub-Bar */}
      {isSmcEnabled && (
        <div className="px-3 sm:px-4 py-1.5 bg-zinc-950/90 border-b border-zinc-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Current Trend Bias */}
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono border flex items-center gap-1 ${
                smcResult.currentTrend === 'BULLISH'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : smcResult.currentTrend === 'BEARISH'
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}
            >
              {smcResult.currentTrend === 'BULLISH' && <TrendingUp className="w-3 h-3" />}
              {smcResult.currentTrend === 'BEARISH' && <TrendingDown className="w-3 h-3" />}
              <span>Bias: {smcResult.currentTrend}</span>
            </span>

            {/* Swing Point Badge with Quick Click to Settings */}
            <button
              type="button"
              onClick={() => setShowSmcSettings(true)}
              title="Click to configure Swing Point & labels"
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-900/90 text-amber-300 border border-amber-500/30 hover:border-amber-400 hover:bg-zinc-800 flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span className="text-zinc-400">Swing Point:</span>
              <strong className="text-amber-400 font-bold">{activeSmcConfig.swingPoint}</strong>
              <span className={`text-[9px] px-1 py-0.2 rounded font-sans ${activeSmcConfig.showSwingPoints ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-500'}`}>
                {activeSmcConfig.showSwingPoints ? 'Points ON' : 'Points OFF'}
              </span>
            </button>

            {/* Confluence Filter quick toggle button */}
            <button
              type="button"
              onClick={() => handleUpdateSmcConfig((c) => ({ ...c, confluenceFilter: !c.confluenceFilter }))}
              title={
                activeSmcConfig.confluenceFilter
                  ? 'Confluence Filter is ACTIVE: Filtering non-significant internal break structures. Click to turn OFF.'
                  : 'Confluence Filter is OFF: Showing all internal break structures. Click to filter non-significant internal breaks.'
              }
              className={`px-2 py-0.5 rounded text-[11px] font-mono border flex items-center gap-1.5 cursor-pointer transition-all ${
                activeSmcConfig.confluenceFilter
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30'
                  : 'bg-zinc-900/80 text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeSmcConfig.confluenceFilter ? 'bg-amber-400 animate-pulse' : 'bg-zinc-500'
                }`}
              ></span>
              <span className="hidden sm:inline">Confluence Filter:</span>
              <span className="sm:hidden">Filter:</span>
              <strong className={activeSmcConfig.confluenceFilter ? 'text-amber-400 font-bold' : 'text-zinc-500'}>
                {activeSmcConfig.confluenceFilter ? 'ON' : 'OFF'}
              </strong>
            </button>

            {/* Latest Structure Break */}
            {smcResult.latestEvent ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-300 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800">
                <span className="text-zinc-500">Latest Signal:</span>
                <span
                  className={
                    smcResult.latestEvent.direction === 'bullish' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                  }
                >
                  {smcResult.latestEvent.type} ({smcResult.latestEvent.direction}) @{' '}
                  {smcResult.latestEvent.level.toFixed(2)}
                </span>
              </span>
            ) : (
              <span className="text-[11px] text-zinc-500 font-mono hidden md:inline">Scanning 1-min swing structure...</span>
            )}
          </div>

          {/* Counts of BOS and CHoCH */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
            <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
              Structures: <strong className="text-zinc-200">{smcResult.structures.length}</strong>
            </span>
            <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 hidden md:inline">
              Swing Points: <strong className="text-amber-400">{smcResult.swingPoints.length}</strong>
            </span>
            <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 hidden lg:inline">
              Order Blocks: <strong className="text-cyan-400">{smcResult.orderBlocks.length}</strong>
            </span>
          </div>
        </div>
      )}

      {/* SMC Settings Popover Drawer */}
      {showSmcSettings && isSmcEnabled && (
        <div className="p-3 sm:p-5 bg-zinc-900/98 border-b border-zinc-700/80 text-xs backdrop-blur-md transition-all shadow-2xl">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Sliders className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-bold text-white text-sm">Smart Money Concepts (SMC) Settings</h4>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Active Swing Point: {activeSmcConfig.swingPoint} bars
                  </span>
                  <span className="text-[10px] text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check className="w-3 h-3" /> Auto-saved
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Configure swing points lookback, labels, and Break of Structure (BOS) / Change of Character (CHoCH) sensitivity
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                title="Reset to default settings"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white transition-all text-[11px] font-medium cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSmcSettings(false)}
                className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer transition-all"
                title="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Primary Swing Point Input & Period Control */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3">
            {/* 1. Swing Point Number Input & Quick Presets */}
            <div className="lg:col-span-7 bg-zinc-950/85 border border-amber-500/40 rounded-xl p-3.5 relative overflow-hidden shadow-inner">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <label htmlFor="smc-swing-point-input" className="font-bold text-amber-300 text-xs sm:text-sm">
                    Swing Point (Pivot Period / Lookback)
                  </label>
                </div>
                <span className="text-[10px] font-mono text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700">
                  Value: <strong className="text-amber-400 text-xs">{activeSmcConfig.swingPoint}</strong> bars
                </span>
              </div>

              <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
                User-selected swing point: controls how many candles left & right are required to confirm swing highs and lows. 
                <strong className="text-zinc-200"> Break of Structure (BOS)</strong> and <strong className="text-zinc-200">Change of Character (CHoCH)</strong> breakouts dynamically track and trigger based on this selected swing point.
              </p>

              {/* Number input with - / + steppers */}
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                  <button
                    type="button"
                    aria-label="Decrease swing point"
                    onClick={() => handleUpdateSmcConfig((c) => ({ ...c, swingPoint: Math.max(2, (c.swingPoint || 10) - 1) }))}
                    disabled={activeSmcConfig.swingPoint <= 2}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-40 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    id="smc-swing-point-input"
                    type="number"
                    min={2}
                    max={100}
                    step={1}
                    value={activeSmcConfig.swingPoint}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        handleUpdateSmcConfig((c) => ({ ...c, swingPoint: Math.max(2, Math.min(100, val)) }));
                      }
                    }}
                    className="w-16 bg-transparent text-center font-mono font-bold text-amber-300 text-sm focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Increase swing point"
                    onClick={() => handleUpdateSmcConfig((c) => ({ ...c, swingPoint: Math.min(100, (c.swingPoint || 10) + 1) }))}
                    disabled={activeSmcConfig.swingPoint >= 100}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Quick Preset Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider mr-1">Presets:</span>
                  {[
                    { label: '5 (Scalp)', val: 5 },
                    { label: '10 (Default)', val: 10 },
                    { label: '15', val: 15 },
                    { label: '20 (Major)', val: 20 },
                    { label: '30', val: 30 },
                    { label: '50 (Macro)', val: 50 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => handleUpdateSmcConfig((c) => ({ ...c, swingPoint: p.val }))}
                      className={`px-2 py-1 rounded font-mono text-[10px] transition-all cursor-pointer ${
                        activeSmcConfig.swingPoint === p.val
                          ? 'bg-amber-500/25 text-amber-300 border border-amber-500/60 font-bold shadow-sm'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status explanation pill */}
              <div className="flex items-center gap-2 text-[10px] text-zinc-400 bg-zinc-900/70 px-2.5 py-1.5 rounded border border-zinc-800">
                <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  BOS/CHoCH breakouts actively evaluate against <strong className="text-zinc-200">{activeSmcConfig.swingPoint}-bar</strong> pivot levels. Lower values = faster reactions; higher values = robust macro structure breaks.
                </span>
              </div>
            </div>

            {/* 2. Show Swing Points Toggle Card */}
            <div className="lg:col-span-5 bg-zinc-950/85 border border-zinc-800 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-zinc-200 text-xs sm:text-sm flex items-center gap-1.5">
                    <span>Show Swing Points</span>
                    <span className="text-[10px] font-normal text-zinc-500">(HH, LH, HL, LL)</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeSmcConfig.showSwingPoints}
                      onChange={(e) => handleUpdateSmcConfig((c) => ({ ...c, showSwingPoints: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                  </label>
                </div>
                <p className="text-[11px] text-zinc-400 mb-3 leading-relaxed">
                  Plots Higher High (HH), Lower High (LH), Higher Low (HL), and Lower Low (LL) markers directly on the chart candles at confirmed swing points based on your selected lookback.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/80">
                <span className="text-[10px] text-zinc-500">Labels Preview:</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">HH</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">LH</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">HL</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">LL</span>
                <span className="ml-auto text-[10px] font-mono text-zinc-400">
                  {activeSmcConfig.showSwingPoints ? 'Visible on chart' : 'Hidden'}
                </span>
              </div>
            </div>
          </div>

          {/* Secondary SMC Indicator Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {/* 1. Swing BOS / CHoCH Structure */}
            <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-all">
              <input
                type="checkbox"
                checked={activeSmcConfig.showSwings}
                onChange={(e) => handleUpdateSmcConfig((c) => ({ ...c, showSwings: e.target.checked }))}
                className="accent-emerald-500 rounded mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">Swing BOS / CHoCH</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-zinc-800 text-zinc-400">Solid</span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Macro breakouts based on user's selected {activeSmcConfig.swingPoint}-bar swing point
                </div>
              </div>
            </label>

            {/* 2. Confirmed Swing Points Only (HH/LH/HL/LL) */}
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800">
              <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold mt-0.5">
                ✓
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">HH / HL Breakout Rule</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">Active</span>
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  Structures strictly require breaking a confirmed HH, LH, HL, or LL. Normal retracements do not trigger false breaks.
                </div>
              </div>
            </div>

            {/* 3. Confluence Filter (Candlestick Displacement for Internal Structures) */}
            <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer hover:border-amber-500/50 transition-all">
              <input
                id="smc-confluence-filter-checkbox"
                type="checkbox"
                checked={Boolean(activeSmcConfig.confluenceFilter)}
                onChange={(e) => handleUpdateSmcConfig((c) => ({ ...c, confluenceFilter: e.target.checked }))}
                className="accent-amber-500 rounded mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">Confluence Filter</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40 font-bold">Displacement</span>
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  Filter non-significant internal structures using candlestick displacement
                </div>
              </div>
            </label>

            {/* 4. Order Blocks */}
            <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-all">
              <input
                type="checkbox"
                checked={activeSmcConfig.showOrderBlocks}
                onChange={(e) => handleUpdateSmcConfig((c) => ({ ...c, showOrderBlocks: e.target.checked }))}
                className="accent-cyan-500 rounded mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">Order Blocks (OB)</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-800/40">Zones</span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Institutional demand & supply blocks formed during structure breaks
                </div>
              </div>
            </label>

            {/* 5. Strong / Weak High/Low */}
            <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-all">
              <input
                type="checkbox"
                checked={activeSmcConfig.showHighLowSwings}
                onChange={(e) => handleUpdateSmcConfig((c) => ({ ...c, showHighLowSwings: e.target.checked }))}
                className="accent-purple-500 rounded mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">Strong / Weak H/L</span>
                  <span className="text-[9px] font-mono px-1 rounded bg-purple-950/50 text-purple-300 border border-purple-800/40">Targets</span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Identifies protected key levels & take profit breakout targets
                </div>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Chart Canvas Area */}
      <div className="relative w-full bg-zinc-950 flex-1 overflow-hidden">
        {/* Loading overlay indicator */}
        {isLoadingCandles && candles.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/70 backdrop-blur-xs">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg text-xs text-amber-400 font-medium">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Streaming 1-minute {symbolName} candles from Deriv...</span>
            </div>
          </div>
        )}

        {/* Lightweight Chart Render Node */}
        <div
          ref={chartContainerRef}
          className="w-full"
          style={{ height: isExpanded ? 520 : 340 }}
        />

        {/* LuxAlgo SMC Vector SVG Overlay for Break of Structure (BOS) & Change of Character (CHoCH) */}
        {isSmcEnabled && chartInstanceRef.current && seriesRef.current && chartDimensions.width > 0 && (
          <SmcChartOverlay
            key={`smc-overlay-${chartRevision}`}
            chart={chartInstanceRef.current}
            series={seriesRef.current}
            structures={smcResult.structures}
            swingPoints={smcResult.swingPoints}
            orderBlocks={smcResult.orderBlocks}
            activeSwingHigh={smcResult.activeSwingHigh}
            activeSwingLow={smcResult.activeSwingLow}
            config={activeSmcConfig}
            width={chartDimensions.width}
            height={chartDimensions.height}
          />
        )}

        {/* Bottom Status Overlay */}
        <div className="absolute bottom-2 left-3 right-3 pointer-events-none flex items-center justify-between text-[10px] font-mono text-zinc-500 z-10">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 bg-zinc-900/90 px-2 py-0.5 rounded border border-zinc-800/80 text-zinc-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Live 1m Candlestick Feed
            </span>

            {isSmcEnabled && (
              <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30">
                SMC Indicator Active
              </span>
            )}

            {entrySpot && (
              <span className="bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded border border-sky-500/30">
                Active Entry: ${entrySpot.toFixed(2)}
              </span>
            )}
          </div>
          <span className="hidden sm:inline bg-zinc-900/90 px-2 py-0.5 rounded border border-zinc-800/80 text-zinc-400">
            Scroll to zoom • Drag to pan
          </span>
        </div>
      </div>
    </div>
  );
};

