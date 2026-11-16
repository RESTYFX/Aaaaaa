import React, { useMemo } from 'react';
import { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import {
  StructureEvent,
  SwingPoint,
  OrderBlockZone,
  SmcIndicatorConfig,
} from '../indicators/smcIndicator';

export interface SmcChartOverlayProps {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  structures: StructureEvent[];
  swingPoints: SwingPoint[];
  orderBlocks: OrderBlockZone[];
  activeSwingHigh?: { price: number; time: number; strong: boolean };
  activeSwingLow?: { price: number; time: number; strong: boolean };
  config: SmcIndicatorConfig;
  width: number;
  height: number;
}

export const SmcChartOverlay: React.FC<SmcChartOverlayProps> = ({
  chart,
  series,
  structures,
  swingPoints,
  orderBlocks,
  activeSwingHigh,
  activeSwingLow,
  config,
  width,
  height,
}) => {
  // Compute pixel coordinates for all visible SMC elements
  const computedElements = useMemo(() => {
    if (!chart || !series || width <= 0 || height <= 0) {
      return {
        structLines: [],
        spLabels: [],
        obZones: [],
        swingLevels: [],
      };
    }

    const timeScale = chart.timeScale();
    const rightMargin = 55; // reserve margin for right price scale
    const chartAreaWidth = Math.max(0, width - rightMargin);

    // 1. Structure Breakout Lines (BOS & CHoCH)
    const structLines: Array<{
      id: string;
      x1: number;
      x2: number;
      y: number;
      label: string;
      direction: 'bullish' | 'bearish';
      isInternal: boolean;
      color: string;
    }> = [];

    const visibleStructures = structures.filter(
      (s) =>
        (s.isInternal && config.showInternals) ||
        (!s.isInternal && config.showSwings !== false)
    );

    for (const s of visibleStructures) {
      const y = series.priceToCoordinate(s.level);
      if (y === null || isNaN(y) || y < 0 || y > height) continue;

      const rawX1 = timeScale.timeToCoordinate(s.startTime as UTCTimestamp);
      const rawX2 = timeScale.timeToCoordinate(s.breakTime as UTCTimestamp);

      if (rawX2 === null) continue; // breakout bar not yet on or past screen

      const x2 = Math.min(chartAreaWidth, Math.max(0, rawX2));
      const x1 = rawX1 === null ? Math.max(0, x2 - 80) : Math.min(chartAreaWidth, Math.max(0, rawX1));

      if (x2 <= x1 + 2) continue; // too small to draw

      const isBull = s.direction === 'bullish';
      const color = isBull ? '#10b981' : '#f43f5e';

      structLines.push({
        id: s.id,
        x1,
        x2,
        y,
        label: s.type,
        direction: s.direction,
        isInternal: s.isInternal,
        color,
      });
    }

    // 2. Swing Points (HH, LH, HL, LL)
    const spLabels: Array<{
      id: string;
      x: number;
      y: number;
      label: string;
      isHigh: boolean;
      color: string;
      bg: string;
    }> = [];

    if (config.showSwingPoints && swingPoints.length > 0) {
      for (const sp of swingPoints) {
        const rawX = timeScale.timeToCoordinate(sp.time as UTCTimestamp);
        if (rawX === null || rawX < 10 || rawX > chartAreaWidth - 10) continue;

        const rawY = series.priceToCoordinate(sp.price);
        if (rawY === null || isNaN(rawY) || rawY < 5 || rawY > height - 15) continue;

        const isHigh = sp.isHigh;
        spLabels.push({
          id: sp.id,
          x: rawX,
          y: isHigh ? Math.max(12, rawY - 14) : Math.min(height - 12, rawY + 16),
          label: sp.type,
          isHigh,
          color: isHigh ? '#fbbf24' : '#38bdf8',
          bg: isHigh ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.25)',
        });
      }
    }

    // 3. Order Blocks (OB zones)
    const obZones: Array<{
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      bias: 'bullish' | 'bearish';
      label: string;
      fill: string;
      stroke: string;
    }> = [];

    if (config.showOrderBlocks && orderBlocks.length > 0) {
      for (const ob of orderBlocks) {
        const yTop = series.priceToCoordinate(ob.top);
        const yBot = series.priceToCoordinate(ob.bottom);
        if (yTop === null || yBot === null || isNaN(yTop) || isNaN(yBot)) continue;

        const top = Math.max(0, Math.min(yTop, yBot));
        const bot = Math.min(height, Math.max(yTop, yBot));
        const blockH = Math.max(4, bot - top);

        const rawX = timeScale.timeToCoordinate(ob.time as UTCTimestamp);
        const startX = rawX === null ? 0 : Math.min(chartAreaWidth - 20, Math.max(0, rawX));
        const blockW = Math.max(20, chartAreaWidth - startX);

        const isBull = ob.bias === 'bullish';
        obZones.push({
          id: ob.id,
          x: startX,
          y: top,
          w: blockW,
          h: blockH,
          bias: ob.bias,
          label: isBull ? '+OB' : '-OB',
          fill: isBull ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
          stroke: isBull ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)',
        });
      }
    }

    // 4. Macro Active Swing High/Low levels
    const swingLevels: Array<{
      id: string;
      y: number;
      label: string;
      color: string;
    }> = [];

    if (config.showHighLowSwings) {
      if (activeSwingHigh) {
        const y = series.priceToCoordinate(activeSwingHigh.price);
        if (y !== null && !isNaN(y) && y >= 0 && y <= height) {
          swingLevels.push({
            id: 'active-swing-high',
            y,
            label: activeSwingHigh.strong ? 'Strong High' : 'Weak High',
            color: '#f43f5e',
          });
        }
      }
      if (activeSwingLow) {
        const y = series.priceToCoordinate(activeSwingLow.price);
        if (y !== null && !isNaN(y) && y >= 0 && y <= height) {
          swingLevels.push({
            id: 'active-swing-low',
            y,
            label: activeSwingLow.strong ? 'Strong Low' : 'Weak Low',
            color: '#10b981',
          });
        }
      }
    }

    return { structLines, spLabels, obZones, swingLevels };
  }, [
    chart,
    series,
    structures,
    swingPoints,
    orderBlocks,
    activeSwingHigh,
    activeSwingLow,
    config,
    width,
    height,
  ]);

  if (width <= 0 || height <= 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-1 overflow-hidden"
      width={width}
      height={height}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <defs>
        {/* Subtle drop shadow for labels */}
        <filter id="smc-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.7" />
        </filter>
      </defs>

      {/* 1. Order Block Shaded Rectangles */}
      {computedElements.obZones.map((ob) => (
        <g key={ob.id}>
          <rect
            x={ob.x}
            y={ob.y}
            width={ob.w}
            height={ob.h}
            fill={ob.fill}
            stroke={ob.stroke}
            strokeWidth={1}
            strokeDasharray="4 2"
            rx={2}
          />
          <text
            x={ob.x + ob.w - 6}
            y={ob.y + Math.max(10, Math.min(ob.h - 3, 11))}
            textAnchor="end"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
            fill={ob.bias === 'bullish' ? '#10b981' : '#f43f5e'}
            opacity={0.85}
          >
            {ob.label}
          </text>
        </g>
      ))}

      {/* 2. Active High / Low Levels */}
      {computedElements.swingLevels.map((lvl) => (
        <g key={lvl.id}>
          <line
            x1={0}
            y1={lvl.y}
            x2={Math.max(0, width - 55)}
            y2={lvl.y}
            stroke={lvl.color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <text
            x={8}
            y={lvl.y - 4}
            fontSize="9"
            fontFamily="monospace"
            fontWeight="bold"
            fill={lvl.color}
            opacity={0.8}
          >
            {lvl.label}
          </text>
        </g>
      ))}

      {/* 3. Structure Breakout Lines (BOS & CHoCH) */}
      {computedElements.structLines.map((line) => {
        const midX = (line.x1 + line.x2) / 2;
        const pillWidth = line.label.length * 6.5 + 10;
        return (
          <g key={line.id}>
            {/* Breakout horizontal line */}
            <line
              x1={line.x1}
              y1={line.y}
              x2={line.x2}
              y2={line.y}
              stroke={line.color}
              strokeWidth={line.isInternal ? 1 : 1.5}
              strokeDasharray={line.isInternal ? '4 3' : undefined}
              opacity={0.9}
            />

            {/* Terminal tick marker at breakout point */}
            <circle cx={line.x2} cy={line.y} r={2} fill={line.color} />

            {/* Label box centered on the line */}
            <g transform={`translate(${midX}, ${line.y})`}>
              <rect
                x={-pillWidth / 2}
                y={-7}
                width={pillWidth}
                height={14}
                rx={3}
                fill="#18181b"
                stroke={line.color}
                strokeWidth={0.8}
                filter="url(#smc-shadow)"
              />
              <text
                x={0}
                y={3}
                textAnchor="middle"
                fontSize="8.5"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                fontWeight="700"
                fill={line.color}
              >
                {line.label}
              </text>
            </g>
          </g>
        );
      })}

      {/* 4. Swing Point Badges (HH, LH, HL, LL) */}
      {computedElements.spLabels.map((sp) => {
        const pillW = 20;
        const pillH = 13;
        return (
          <g key={sp.id} transform={`translate(${sp.x}, ${sp.y})`}>
            <rect
              x={-pillW / 2}
              y={-pillH / 2}
              width={pillW}
              height={pillH}
              rx={3}
              fill="#18181b"
              stroke={sp.color}
              strokeWidth={0.8}
              filter="url(#smc-shadow)"
            />
            <text
              x={0}
              y={3.5}
              textAnchor="middle"
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              fill={sp.color}
            >
              {sp.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
