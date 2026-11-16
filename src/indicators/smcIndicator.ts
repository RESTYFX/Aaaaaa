import { CandleData } from '../types';

export interface StructureEvent {
  id: string;
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  level: number;
  startTime: number;
  breakTime: number;
  startIndex: number;
  breakIndex: number;
  isInternal: boolean;
}

export interface SwingPoint {
  id: string;
  type: 'HH' | 'LH' | 'HL' | 'LL';
  price: number;
  time: number;
  index: number;
  isHigh: boolean;
}

export interface OrderBlockZone {
  id: string;
  bias: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  time: number;
  mitigated: boolean;
}

export interface SmcIndicatorConfig {
  showInternals: boolean;
  showSwings: boolean;
  showSwingPoints: boolean;
  showHighLowSwings: boolean;
  showOrderBlocks: boolean;
  confluenceFilter: boolean; // Filter non-significant internal structures using candlestick displacement
  internalLength: number; // default 5 (as in LuxAlgo)
  swingLength: number;    // default 10 or 20 (as in LuxAlgo)
  swingPoint: number;     // user-configurable swing point period (default 10)
}

export const DEFAULT_SMC_CONFIG: SmcIndicatorConfig = {
  showInternals: false, // Internal minor retracements disabled - structures must break confirmed HH/LH/HL/LL
  showSwings: true,
  showSwingPoints: true,
  showHighLowSwings: true,
  showOrderBlocks: true,
  confluenceFilter: true, // Confluence Filter enabled by default to filter non-significant internal break structures
  internalLength: 5,
  swingLength: 10,
  swingPoint: 10,
};

/**
 * Evaluates whether an internal structure breakout candle demonstrates
 * decisive candlestick displacement as defined in LuxAlgo SMC's Confluence Filter.
 * 
 * In Smart Money Concepts, an internal structure breakout is considered INSIGNIFICANT
 * and filtered out if:
 * - The candle closes opposite to the breakout direction (e.g., wick-only break or indecision).
 * - The body is weak or dominated by wicks (body < 52% of total candle range).
 * - The candle has a prominent rejection wick in the breakout direction (> 35% of range).
 * - The candle body lacks momentum expansion (body < rolling 14-period average body and < 65% ATR).
 * - The candle close barely touches or fails to clear the broken level with displacement.
 * 
 * When Confluence Filter is enabled, all insignificant internal structures are
 * completely removed and deleted from the chart.
 */
export function hasCandleDisplacement(
  candles: CandleData[],
  breakIndex: number,
  direction: 'bullish' | 'bearish',
  brokenLevel: number
): boolean {
  if (breakIndex < 0 || breakIndex >= candles.length) return false;
  const bar = candles[breakIndex];
  const range = bar.high - bar.low;
  if (range <= 0) return false;

  const body = Math.abs(bar.close - bar.open);

  // 1. Directional alignment: breakout candle MUST close in the direction of the break
  if (direction === 'bullish' && bar.close <= bar.open) return false;
  if (direction === 'bearish' && bar.close >= bar.open) return false;

  // 2. Body dominance: The real body must comprise at least 52% of the candle's total high-to-low span
  // (filtering out indecisive spinning tops, high-wick candles, and dojis)
  if (body / range < 0.52) return false;

  // 3. No large rejection wick in breakout direction
  // For bullish break: upper wick cannot exceed 35% of the candle span
  // For bearish break: lower wick cannot exceed 35% of the candle span
  if (direction === 'bullish' && (bar.high - bar.close) > range * 0.35) return false;
  if (direction === 'bearish' && (bar.close - bar.low) > range * 0.35) return false;

  // 4. Measure against rolling 14-period average body and ATR
  const lookbackStart = Math.max(0, breakIndex - 14);
  let totalTr = 0;
  let totalBody = 0;
  let count = 0;
  for (let k = lookbackStart; k <= breakIndex; k++) {
    const c = candles[k];
    const prevClose = k > 0 ? candles[k - 1].close : c.open;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    totalTr += tr;
    totalBody += Math.abs(c.close - c.open);
    count++;
  }
  const atr = count > 0 ? totalTr / count : range;
  const avgBody = count > 0 ? totalBody / count : body;

  // 5. Significant momentum threshold:
  // Displacement requires real impulse: body must be >= 85% of average body OR >= 65% of ATR
  if (body < avgBody * 0.85 && body < atr * 0.65) {
    return false;
  }
  // Total span must not be miniature noise
  if (range < atr * 0.40) {
    return false;
  }

  // 6. Decisive clearance beyond broken level (must close past level, not a microscopic fraction)
  const minClearance = Math.max(range * 0.06, atr * 0.05);
  if (direction === 'bullish' && (bar.close - brokenLevel) < minClearance) return false;
  if (direction === 'bearish' && (brokenLevel - bar.close) < minClearance) return false;

  return true;
}

export interface SmcAnalysisResult {
  structures: StructureEvent[];
  swingPoints: SwingPoint[];
  orderBlocks: OrderBlockZone[];
  currentTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  activeSwingHigh?: { price: number; time: number; strong: boolean };
  activeSwingLow?: { price: number; time: number; strong: boolean };
  latestEvent?: StructureEvent;
}

interface PivotTracker {
  currentLevel: number;
  lastLevel: number;
  crossed: boolean;
  barTime: number;
  barIndex: number;
}

/**
 * Computes Break of Structure (BOS) and Change of Character (CHoCH)
 * based on LuxAlgo's Smart Money Concepts indicator.
 */
export function calculateSMC(
  candles: CandleData[],
  config: SmcIndicatorConfig = DEFAULT_SMC_CONFIG
): SmcAnalysisResult {
  if (!candles || candles.length < 10) {
    return {
      structures: [],
      swingPoints: [],
      orderBlocks: [],
      currentTrend: 'NEUTRAL',
    };
  }

  // Ensure candles are sorted ascending by epoch
  const sorted = [...candles].sort((a, b) => a.epoch - b.epoch);
  const n = sorted.length;

  const structures: StructureEvent[] = [];
  const swingPoints: SwingPoint[] = [];
  const orderBlocks: OrderBlockZone[] = [];

  // Effective swing point and internal length from user configuration
  const rawSwingPoint = Number(config.swingPoint ?? config.swingLength ?? 10);
  const effectiveSwingPoint = isNaN(rawSwingPoint) || rawSwingPoint < 2 ? 10 : Math.min(100, Math.round(rawSwingPoint));

  const rawInternal = Number(config.internalLength ?? 5);
  const effectiveInternalLength = isNaN(rawInternal) || rawInternal < 2 ? 5 : Math.min(50, Math.round(rawInternal));

  // Strict TradingView SMC rule:
  // A Break of Structure (BOS) or Change of Character (CHoCH) MUST break an actual confirmed
  // Swing Point (Higher High / Lower High or Higher Low / Lower Low).
  // No breaks can occur in between during normal market retracements.
  const runs: Array<{ length: number; isInternal: boolean }> = [
    { length: effectiveSwingPoint, isInternal: false },
  ];

  let finalSwingTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let activeHighTracker: PivotTracker | null = null;
  let activeLowTracker: PivotTracker | null = null;

  for (const run of runs) {
    // Lookback size for pivot detection (allow up to half chart history so large swing points work)
    const size = Math.max(2, Math.min(run.length, Math.floor((n - 1) / 2)));
    const isInternal = run.isInternal;

    let leg: number = -1; // -1 = uninitialized, 0 = BEARISH_LEG, 1 = BULLISH_LEG

    let pivotHigh: PivotTracker = {
      currentLevel: NaN,
      lastLevel: NaN,
      crossed: true,
      barTime: 0,
      barIndex: -1,
    };

    let pivotLow: PivotTracker = {
      currentLevel: NaN,
      lastLevel: NaN,
      crossed: true,
      barTime: 0,
      barIndex: -1,
    };

    let trendBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

    // Loop through candles to identify legs, pivots and structure breakouts
    // Matching TradingView Pine Script:
    // newLegHigh = high[size] > ta.highest(size)
    // newLegLow  = low[size] < ta.lowest(size)
    for (let i = size; i < n; i++) {
      const candidateIdx = i - size;
      const candidate = sorted[candidateIdx];

      // At bar i:
      // candidate is high[size] (the bar at i - size).
      // ta.highest(size) evaluates the subsequent `size` bars (bars candidateIdx + 1 to i).
      // ta.lowest(size)  evaluates the subsequent `size` bars (bars candidateIdx + 1 to i).
      let maxSubsequentHigh = -Infinity;
      let minSubsequentLow = Infinity;
      for (let j = candidateIdx + 1; j <= i; j++) {
        if (sorted[j].high > maxSubsequentHigh) maxSubsequentHigh = sorted[j].high;
        if (sorted[j].low < minSubsequentLow) minSubsequentLow = sorted[j].low;
      }

      const newLegHigh = candidate.high > maxSubsequentHigh;
      const newLegLow = candidate.low < minSubsequentLow;

      // Leg state transition matching TradingView Pine Script:
      // if newLegHigh
      //     leg := BEARISH_LEG (0)
      // else if newLegLow
      //     leg := BULLISH_LEG (1)
      let newLeg = leg;
      if (newLegHigh) {
        newLeg = 0; // BEARISH_LEG
      } else if (newLegLow) {
        newLeg = 1; // BULLISH_LEG
      }

      // Detect start of new leg / pivot confirmation:
      // startOfBearishLeg: leg switches to 0 -> confirmed Swing High at candidateIdx
      // startOfBullishLeg: leg switches to 1 -> confirmed Swing Low at candidateIdx
      if (newLeg !== leg) {
        if (newLeg === 0) {
          // Confirmed Swing High
          const lastHighPrice = pivotHigh.currentLevel;
          const swingType: 'HH' | 'LH' = !isNaN(lastHighPrice)
            ? (candidate.high >= lastHighPrice ? 'HH' : 'LH')
            : 'HH'; // Baseline

          pivotHigh = {
            currentLevel: candidate.high,
            lastLevel: lastHighPrice,
            crossed: false,
            barTime: candidate.epoch,
            barIndex: candidateIdx,
          };

          if (!isInternal && config.showSwingPoints) {
            swingPoints.push({
              id: `sp-high-${candidate.epoch}`,
              type: swingType,
              price: candidate.high,
              time: candidate.epoch,
              index: candidateIdx,
              isHigh: true,
            });
          }
        } else if (newLeg === 1) {
          // Confirmed Swing Low
          const lastLowPrice = pivotLow.currentLevel;
          const swingType: 'LL' | 'HL' = !isNaN(lastLowPrice)
            ? (candidate.low <= lastLowPrice ? 'LL' : 'HL')
            : 'LL'; // Baseline

          pivotLow = {
            currentLevel: candidate.low,
            lastLevel: lastLowPrice,
            crossed: false,
            barTime: candidate.epoch,
            barIndex: candidateIdx,
          };

          if (!isInternal && config.showSwingPoints) {
            swingPoints.push({
              id: `sp-low-${candidate.epoch}`,
              type: swingType,
              price: candidate.low,
              time: candidate.epoch,
              index: candidateIdx,
              isHigh: false,
            });
          }
        }
        leg = newLeg;
      }

      const currentBar = sorted[i];

      // Check Bullish Breakout (close crosses above pivotHigh.currentLevel)
      if (
        !pivotHigh.crossed &&
        !isNaN(pivotHigh.currentLevel) &&
        currentBar.close > pivotHigh.currentLevel
      ) {
        // Mark pivot as crossed immediately so that this broken level is never re-tested or delayed
        pivotHigh.crossed = true;

        // Confluence Filter check: If enabled and structure is internal,
        // it must have significant candlestick displacement.
        // Insignificant internal breakouts are completely eliminated and filtered out.
        const isDisplaced = !isInternal || !config.confluenceFilter || hasCandleDisplacement(sorted, i, 'bullish', pivotHigh.currentLevel);

        if (isDisplaced) {
          const tag: 'BOS' | 'CHoCH' = trendBias === 'BEARISH' ? 'CHoCH' : 'BOS';
          trendBias = 'BULLISH';

          structures.push({
            id: `struct-bull-${isInternal ? 'int' : 'sw'}-${pivotHigh.barTime}-${currentBar.epoch}`,
            type: tag,
            direction: 'bullish',
            level: pivotHigh.currentLevel,
            startTime: pivotHigh.barTime,
            breakTime: currentBar.epoch,
            startIndex: pivotHigh.barIndex,
            breakIndex: i,
            isInternal,
          });

          // Capture Bullish Order Block (lowest candle between pivot and breakout)
          if (config.showOrderBlocks && pivotHigh.barIndex >= 0) {
            let minLow = Infinity;
            let minCandle = sorted[pivotHigh.barIndex];
            for (let k = pivotHigh.barIndex; k <= i; k++) {
              if (sorted[k].low < minLow) {
                minLow = sorted[k].low;
                minCandle = sorted[k];
              }
            }
            orderBlocks.push({
              id: `ob-bull-${isInternal ? 'int' : 'sw'}-${minCandle.epoch}-${currentBar.epoch}`,
              bias: 'bullish',
              top: minCandle.high,
              bottom: minCandle.low,
              time: minCandle.epoch,
              mitigated: false,
            });
          }
        }
      }

      // Check Bearish Breakout (close crosses below pivotLow.currentLevel)
      if (
        !pivotLow.crossed &&
        !isNaN(pivotLow.currentLevel) &&
        currentBar.close < pivotLow.currentLevel
      ) {
        // Mark pivot as crossed immediately so that this broken level is never re-tested or delayed
        pivotLow.crossed = true;

        // Confluence Filter check: If enabled and structure is internal,
        // it must have significant candlestick displacement.
        // Insignificant internal breakdowns are completely eliminated and filtered out.
        const isDisplaced = !isInternal || !config.confluenceFilter || hasCandleDisplacement(sorted, i, 'bearish', pivotLow.currentLevel);

        if (isDisplaced) {
          const tag: 'BOS' | 'CHoCH' = trendBias === 'BULLISH' ? 'CHoCH' : 'BOS';
          trendBias = 'BEARISH';

          structures.push({
            id: `struct-bear-${isInternal ? 'int' : 'sw'}-${pivotLow.barTime}-${currentBar.epoch}`,
            type: tag,
            direction: 'bearish',
            level: pivotLow.currentLevel,
            startTime: pivotLow.barTime,
            breakTime: currentBar.epoch,
            startIndex: pivotLow.barIndex,
            breakIndex: i,
            isInternal,
          });

          // Capture Bearish Order Block (highest candle between pivot and breakout)
          if (config.showOrderBlocks && pivotLow.barIndex >= 0) {
            let maxHigh = -Infinity;
            let maxCandle = sorted[pivotLow.barIndex];
            for (let k = pivotLow.barIndex; k <= i; k++) {
              if (sorted[k].high > maxHigh) {
                maxHigh = sorted[k].high;
                maxCandle = sorted[k];
              }
            }
            orderBlocks.push({
              id: `ob-bear-${isInternal ? 'int' : 'sw'}-${maxCandle.epoch}-${currentBar.epoch}`,
              bias: 'bearish',
              top: maxCandle.high,
              bottom: maxCandle.low,
              time: maxCandle.epoch,
              mitigated: false,
            });
          }
        }
      }
    }

    if (!isInternal) {
      finalSwingTrend = trendBias;
      activeHighTracker = !pivotHigh.crossed ? pivotHigh : null;
      activeLowTracker = !pivotLow.crossed ? pivotLow : null;
    }
  }

  // Deduplicate order blocks by time and bias so that overlapping internal and swing detection don't create duplicate zones
  const dedupedOrderBlocksMap = new Map<string, OrderBlockZone>();
  for (const ob of orderBlocks) {
    dedupedOrderBlocksMap.set(`${ob.bias}-${ob.time}`, ob);
  }
  const dedupedOrderBlocks = Array.from(dedupedOrderBlocksMap.values());

  // Filter Order blocks: check mitigation against subsequent candles
  const validOrderBlocks = dedupedOrderBlocks.slice(-12).map((ob) => {
    let mitigated = false;
    for (let i = 0; i < n; i++) {
      if (sorted[i].epoch > ob.time) {
        if (ob.bias === 'bearish' && sorted[i].high > ob.top) {
          mitigated = true;
          break;
        } else if (ob.bias === 'bullish' && sorted[i].low < ob.bottom) {
          mitigated = true;
          break;
        }
      }
    }
    return { ...ob, mitigated };
  }).filter((ob) => !ob.mitigated);

  // Deduplicate structures by unique ID
  const uniqueStructMap = new Map<string, StructureEvent>();
  for (const s of structures) {
    uniqueStructMap.set(s.id, s);
  }
  const uniqueStructures = Array.from(uniqueStructMap.values()).sort((a, b) => a.breakTime - b.breakTime);

  // Strict TradingView rule: Only confirmed swing point structure breakouts (breaks of confirmed HH, LH, HL, LL) are valid.
  // Completely eliminate any internal blip breaks that do not break a confirmed swing point.
  const finalStructures = uniqueStructures.filter((s) => !s.isInternal);

  // Deduplicate swing points
  const uniqueSpMap = new Map<string, SwingPoint>();
  for (const sp of swingPoints) {
    uniqueSpMap.set(sp.id, sp);
  }
  const uniqueSwingPoints = Array.from(uniqueSpMap.values());

  const latestEvent = finalStructures.length > 0 ? finalStructures[finalStructures.length - 1] : undefined;

  return {
    structures: finalStructures,
    swingPoints: uniqueSwingPoints.slice(-60),
    orderBlocks: validOrderBlocks.slice(-6),
    currentTrend: finalSwingTrend,
    activeSwingHigh: activeHighTracker
      ? {
          price: activeHighTracker.currentLevel,
          time: activeHighTracker.barTime,
          strong: finalSwingTrend === 'BEARISH',
        }
      : undefined,
    activeSwingLow: activeLowTracker
      ? {
          price: activeLowTracker.currentLevel,
          time: activeLowTracker.barTime,
          strong: finalSwingTrend === 'BULLISH',
        }
      : undefined,
    latestEvent,
  };
}
