/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { BalanceCards } from './components/BalanceCards';
import { LightweightCandleChart } from './components/LightweightCandleChart';
import { MarketSelector } from './components/MarketSelector';
import { TradingSection } from './components/TradingSection';
import { TradeHistoryTable } from './components/TradeHistoryTable';
import { LoginModal, isPlausibleDerivToken } from './components/LoginModal';
import { ActiveTradeBanner } from './components/ActiveTradeBanner';
import { NetworkGlitchBanner } from './components/NetworkGlitchBanner';
import { CorrectedLossAlertBox } from './components/CorrectedLossAlertBox';
import {
  ConnectionState,
  DerivAccount,
  DerivUserStatus,
  BalanceStats,
  TradeParameters,
  TradingStrategy,
  TradeRecord,
  MarketTick,
  CandleData,
  MultiMarketScanItem,
  NetworkSignalState,
  CorrectedLossItem,
  DEFAULT_IN_INTER_MODES,
  MarketMartingaleState,
} from './types';
import { TRADING_STRATEGIES, POPULAR_SYMBOLS } from './data/strategies';
import { VOLATILITY_MARKETS, MarketDefinition } from './data/markets';
import { derivWs } from './services/derivWs';
import { networkEngine } from './services/networkEngine';
import { AlertCircle, CheckCircle2, TrendingUp, KeyRound, Sparkles, RefreshCw } from 'lucide-react';
import { SmcAnalysisResult, calculateSMC, DEFAULT_SMC_CONFIG, SmcIndicatorConfig } from './indicators/smcIndicator';
import { autoRecoveryStorage } from './services/autoRecoveryStorage';
import { inBuiltSearcher } from './services/inBuiltReconnectionSearcher';

import { getTradeProfit, playEscalationChime, isVirtualRecord } from './utils/tradeUtils';
export { getTradeProfit, isVirtualRecord };

/**
 * Calculates the total consecutive unrecovered losses in the current loss cycle
 * for REAL ACCOUNT TRADES ONLY.
 * Virtual trades are strictly ignored so simulated losses never inflate real loss recovery.
 */
export function calculateConsecutiveCycleLoss(
  records: TradeRecord[],
  targetContractId?: number | string
): { totalLoss: number; consecutiveCount: number; lostStakes: number[] } {
  if (!records || records.length === 0) {
    return { totalLoss: 0, consecutiveCount: 0, lostStakes: [] };
  }

  let startIndex = 0;
  if (targetContractId !== undefined) {
    const foundIdx = records.findIndex((t) => Number(t.contractId) === Number(targetContractId));
    if (foundIdx >= 0) {
      startIndex = foundIdx;
    }
  }

  let totalLoss = 0;
  let consecutiveCount = 0;
  const lostStakes: number[] = [];

  for (let i = startIndex; i < records.length; i++) {
    const t = records[i];
    // Skip virtual trades completely: virtual trades never affect real loss recovery or martingale calculations!
    if (isVirtualRecord(t)) {
      continue;
    }
    // If we reach a won real trade, the previous sequence was complete! Stop counting.
    if (t.status === 'won') {
      break;
    }
    if (t.status === 'lost') {
      const stakeAmt = Number(t.stake || 0);
      totalLoss = Number((totalLoss + stakeAmt).toFixed(2));
      consecutiveCount++;
      lostStakes.push(stakeAmt);
    }
  }

  return { totalLoss, consecutiveCount, lostStakes };
}

/**
 * Counts ALL consecutive losses (both Virtual and Real) from the target trade backwards
 * until a WON trade is reached. Used for Post-Martingale enforcement across all modes.
 */
export function calculateConsecutiveLossesAll(
  records: TradeRecord[],
  targetContractId?: number | string
): number {
  if (!records || records.length === 0) return 0;

  let startIndex = 0;
  if (targetContractId !== undefined) {
    const foundIdx = records.findIndex((t) => Number(t.contractId) === Number(targetContractId));
    if (foundIdx >= 0) {
      startIndex = foundIdx;
    }
  }

  let consecutiveCount = 0;
  for (let i = startIndex; i < records.length; i++) {
    const t = records[i];
    if (t.status === 'won') {
      break;
    }
    if (t.status === 'lost') {
      consecutiveCount++;
    }
  }

  return consecutiveCount;
}

function roundInInterStake(val: number): number {
  return Math.max(0.35, Math.floor((val + 1e-9) * 100) / 100);
}

export default function App() {
  // Check if session restoration is active
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(() => {
    const s = autoRecoveryStorage.loadActiveSession();
    return Boolean(s && s.token);
  });

  // Connection & Auth states
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const connectionStateRef = useRef<ConnectionState>('disconnected');
  connectionStateRef.current = connectionState;
  const reconnectSessionTimerRef = useRef<any>(null);
  const [connectionError, setConnectionError] = useState<string | undefined>();
  const [account, setAccount] = useState<DerivAccount | null>(() => {
    const s = autoRecoveryStorage.loadActiveSession();
    if (s && s.token && s.accountId) {
      return {
        loginid: s.accountId,
        currency: s.currency || 'USD',
        balance: s.balance || 0,
        isVirtual: s.isVirtual ?? false,
        fullname: s.isVirtual ? `Deriv Demo (${s.accountId})` : `Deriv Real (${s.accountId})`,
        email: 'tradevoult@gmail.com',
        token: s.token,
        appId: s.appId || '33IM5dIMuFaBupAhk042L',
      };
    }
    return null;
  });
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [appId, setAppId] = useState('33IM5dIMuFaBupAhk042L');

  // Network Signal Strength & Glitch Auto-Recovery states
  const [networkSignal, setNetworkSignal] = useState<NetworkSignalState>(() => networkEngine.getState());
  const [isNetworkGlitch, setIsNetworkGlitch] = useState<boolean>(false);
  const [networkGlitchMessage, setNetworkGlitchMessage] = useState<string>('');
  const [networkGlitchCountdown, setNetworkGlitchCountdown] = useState<number>(10);
  const [networkRestoredNotification, setNetworkRestoredNotification] = useState<string | null>(null);
  const [virtualSwitchEscalationNotice, setVirtualSwitchEscalationNotice] = useState<string | null>(null);
  const isNetworkGlitchRef = useRef<boolean>(false);
  const isGlitchAutoRefreshingRef = useRef<boolean>(false);
  const glitchHardReloadTimeoutRef = useRef<any>(null);
  const lastCandleDataTimeRef = useRef<number>(Date.now());

  // Load persisted Martingale & Loss recovery state
  const persistedMartingale = autoRecoveryStorage.loadMartingaleState();

  // Balance & Session P&L states
  const [startingBalance, setStartingBalance] = useState<number>(() => {
    const s = autoRecoveryStorage.loadActiveSession();
    if (s?.accountId) {
      const accBal = autoRecoveryStorage.loadAccountStartingBalance(s.accountId);
      if (accBal > 0) return accBal;
    }
    return autoRecoveryStorage.loadStartingBalance() || persistedMartingale?.startingBalance || 0;
  });
  const [currentBalance, setCurrentBalance] = useState<number>(() => {
    const s = autoRecoveryStorage.loadActiveSession();
    return s && typeof s.balance === 'number' && !isNaN(s.balance) ? s.balance : 0;
  });
  const [currency, setCurrency] = useState<string>(() => {
    const s = autoRecoveryStorage.loadActiveSession();
    return s?.currency || 'USD';
  });

  // Deriv Verified Corrected Losses tracking & alert state
  const [correctedLossItems, setCorrectedLossItems] = useState<CorrectedLossItem[]>(() => {
    const records = autoRecoveryStorage.loadTradeRecords();
    const { consecutiveCount } = calculateConsecutiveCycleLoss(records);
    if (consecutiveCount === 0) {
      // The most recent real trade was a WIN: cycle is complete, no losses to recover!
      autoRecoveryStorage.clearCorrectedLossItems();
      return [];
    }

    const rawItems = autoRecoveryStorage.loadCorrectedLossItems();
    const payoutRate = 0.83; // Deriv Rise/Fall 83% payout
    return rawItems.map((item) => {
      if (item.status === 'pending_recovery') {
        const { totalLoss } = calculateConsecutiveCycleLoss(records, item.contractId);
        const aggregatedLoss = Math.max(item.lossAmount, totalLoss);
        const accurateRecovery = Math.ceil((aggregatedLoss / payoutRate) * 100) / 100;
        return {
          ...item,
          lossAmount: aggregatedLoss,
          recoveryStake: accurateRecovery,
        };
      }
      return item;
    });
  });

  // Market & Trading state
  const [ticks, setTicks] = useState<MarketTick[]>([]);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(false);
  const [selectedStrategy, setSelectedStrategy] = useState<TradingStrategy>(() => {
    const savedStratId = autoRecoveryStorage.loadStrategyId();
    if (savedStratId) {
      const found = TRADING_STRATEGIES.find((s) => s.id === savedStratId);
      if (found) return found;
    }
    return TRADING_STRATEGIES[0];
  });
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>(() => {
    const s = autoRecoveryStorage.loadActiveSession();
    if (s?.accountId) {
      const accTrades = autoRecoveryStorage.loadAccountTradeRecords(s.accountId);
      if (accTrades.length > 0) return accTrades;
    }
    return autoRecoveryStorage.loadTradeRecords();
  });
  const [isTradePending, setIsTradePending] = useState<boolean>(false);
  const [botStatusMessage, setBotStatusMessage] = useState<string>('Bot idle. Ready for manual or auto execution.');
  const [activeTradeCountdown, setActiveTradeCountdown] = useState<number>(() => {
    const now = Date.now();
    const single = autoRecoveryStorage.loadActiveTrade();
    if (single && single.status === 'open' && single.purchaseTime && (now - single.purchaseTime) < 65000) {
      const elapsed = Math.floor((now - single.purchaseTime) / 1000);
      return Math.max(0, 59 - elapsed);
    }
    const list = autoRecoveryStorage.loadActiveTrades();
    if (Array.isArray(list)) {
      const running = list.find((t) => t.status === 'open' && t.purchaseTime && (now - t.purchaseTime) < 65000);
      if (running) {
        const elapsed = Math.floor((now - running.purchaseTime) / 1000);
        return Math.max(0, 59 - elapsed);
      }
    }
    const records = autoRecoveryStorage.loadTradeRecords();
    if (Array.isArray(records)) {
      const running = records.find((t) => t.status === 'open' && t.purchaseTime && (now - t.purchaseTime) < 65000);
      if (running) {
        const elapsed = Math.floor((now - running.purchaseTime) / 1000);
        return Math.max(0, 59 - elapsed);
      }
    }
    return 59;
  });

  // Trading parameters requested by user:
  // Default strategy: Rise and Fall with 1-Minute expiry time and 59-second settlement
  const [params, setParams] = useState<TradeParameters>(() => {
    const saved = autoRecoveryStorage.loadTradingParams();
    if (saved) {
      return {
        ...saved,
        takeProfit: typeof saved.takeProfit === 'number' && !isNaN(saved.takeProfit) ? saved.takeProfit : 10.0,
        stopLoss: typeof saved.stopLoss === 'number' && !isNaN(saved.stopLoss) ? saved.stopLoss : 10.0,
        settleAtSecond: 59,
        pauseTradeEnabled: saved.pauseTradeEnabled !== false,
        pauseLossThreshold: saved.pauseLossThreshold ?? 2,
        autoMartingaleEnabled: saved.autoMartingaleEnabled ?? true,
        autoMartingalePayoutPercent: saved.autoMartingalePayoutPercent ?? 83,
        maxMultiplier: saved.maxMultiplier ?? 5,
        maxMartingaleAction: saved.maxMartingaleAction ?? 'stop',
        inInterModeEnabled: saved.inInterModeEnabled ?? false,
        consecutivesToSwitchMode: saved.consecutivesToSwitchMode ?? 3,
        modesConfig: Array.isArray(saved.modesConfig) && saved.modesConfig.length === 10
          ? saved.modesConfig
          : DEFAULT_IN_INTER_MODES,
        virtualHookEnabled: saved.virtualHookEnabled ?? false,
        virtualHookLossThreshold: saved.virtualHookLossThreshold ?? 1,
        virtualHookVirtualStake: saved.virtualHookVirtualStake ?? (saved.stake || 0.35),
        virtualSwitchEnabled: saved.virtualSwitchEnabled ?? false,
        virtualSwitchBoxes: Array.isArray(saved.virtualSwitchBoxes) && saved.virtualSwitchBoxes.length > 0
          ? saved.virtualSwitchBoxes
          : [1, 2, 3],
        virtualSwitchTakeProfit: saved.virtualSwitchTakeProfit ?? 0.5,
        virtualCountEnabled: saved.virtualCountEnabled ?? false,
        virtualCountThreshold: saved.virtualCountThreshold ?? 3,
        individualMultiMarketEnabled: saved.individualMultiMarketEnabled ?? false,
        maxConcurrentTrades: saved.maxConcurrentTrades ? Math.max(1, Number(saved.maxConcurrentTrades)) : 1,
      };
    }
    return {
      stake: 1.0,
      multiplier: 2.0,
      takeProfit: 10.0,
      stopLoss: 10.0,
      maxMultiplier: 5,
      maxMartingaleAction: 'stop',
      symbol: 'R_100',
      symbolName: 'Volatility 100 Index',
      contractType: 'CALL',
      duration: 1,
      durationUnit: 'm',
      settleAtSecond: 59,
      pauseTradeEnabled: true,
      pauseLossThreshold: 2,
      autoMartingaleEnabled: true,
      autoMartingalePayoutPercent: 83,
      inInterModeEnabled: false,
      consecutivesToSwitchMode: 3,
      modesConfig: DEFAULT_IN_INTER_MODES,
      virtualHookEnabled: false,
      virtualHookLossThreshold: 1,
      virtualHookVirtualStake: 0.35,
      virtualSwitchEnabled: false,
      virtualSwitchBoxes: [1, 2, 3],
      virtualSwitchTakeProfit: 0.5,
      virtualCountEnabled: false,
      virtualCountThreshold: 3,
      individualMultiMarketEnabled: false,
      maxConcurrentTrades: 1,
    };
  });

  // Martingale & Pause Trade State
  const [currentMartingaleStep, setCurrentMartingaleStep] = useState<number>(() => {
    const records = autoRecoveryStorage.loadTradeRecords();
    const { consecutiveCount } = calculateConsecutiveCycleLoss(records);
    if (consecutiveCount === 0) return 0;
    return persistedMartingale?.currentMartingaleStep ?? 0;
  });
  const [accumulatedLoss, setAccumulatedLoss] = useState<number>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (
      savedParams?.inInterModeEnabled &&
      (persistedMartingale?.currentMode ?? 0) >= 1 &&
      (persistedMartingale?.modeAccumulatedLoss ?? 0) > 0.01
    ) {
      return persistedMartingale!.modeAccumulatedLoss!;
    }
    const records = autoRecoveryStorage.loadTradeRecords();
    const { consecutiveCount, totalLoss } = calculateConsecutiveCycleLoss(records);
    if (consecutiveCount === 0) return 0;

    const rawItems = autoRecoveryStorage.loadCorrectedLossItems();
    const pendingLosses = rawItems.filter((item) => item.status === 'pending_recovery');
    const totalPending = pendingLosses.reduce((acc, curr) => {
      const { totalLoss: itemCycleLoss } = calculateConsecutiveCycleLoss(records, curr.contractId);
      return acc + Math.max(curr.lossAmount, itemCycleLoss);
    }, 0);
    const savedLoss = persistedMartingale?.accumulatedLoss ?? 0;
    return Math.max(savedLoss, totalLoss, totalPending);
  });
  const [isAutoTrading, setIsAutoTrading] = useState<boolean>(() => {
    const glitchState = autoRecoveryStorage.getGlitchReloadState();
    if (glitchState && glitchState.isPending) {
      return glitchState.shouldResumeAutoTrading;
    }
    return autoRecoveryStorage.loadAutoTradingState();
  });
  const [autoTraderStartedAt, setAutoTraderStartedAt] = useState<number | null>(() => {
    const saved = autoRecoveryStorage.loadAutoTraderTimer();
    if (saved.startedAt) return saved.startedAt;
    const glitchState = autoRecoveryStorage.getGlitchReloadState();
    const initialRunning =
      (glitchState && glitchState.isPending && glitchState.shouldResumeAutoTrading) ||
      autoRecoveryStorage.loadAutoTradingState();
    if (initialRunning) {
      const nowMs = Date.now();
      autoRecoveryStorage.saveAutoTraderTimer(nowMs, null);
      return nowMs;
    }
    return null;
  });
  const [autoTraderStoppedElapsedMs, setAutoTraderStoppedElapsedMs] = useState<number | null>(() => {
    const saved = autoRecoveryStorage.loadAutoTraderTimer();
    return saved.stoppedElapsedMs ?? null;
  });
  const [cycleLossCount, setCycleLossCount] = useState<number>(() => {
    return persistedMartingale?.cycleLossCount ?? 0;
  });
  const [isPausedAwaitingSignal, setIsPausedAwaitingSignal] = useState<boolean>(() => {
    return persistedMartingale?.isPausedAwaitingSignal ?? false;
  });
  const [currentPhase, setCurrentPhase] = useState<number>(() => {
    return persistedMartingale?.currentPhase ?? 1;
  });

  // In-Mode & Inter-Mode Martingale state (10 Escalating Modes)
  const [currentMode, setCurrentMode] = useState<number>(() => {
    return persistedMartingale?.currentMode ?? 0;
  });
  const [defaultModeLossCount, setDefaultModeLossCount] = useState<number>(() => {
    return persistedMartingale?.defaultModeLossCount ?? 0;
  });
  const [inModeLossCount, setInModeLossCount] = useState<number>(() => {
    return persistedMartingale?.inModeLossCount ?? 0;
  });
  const [modeFirstStake, setModeFirstStake] = useState<number>(() => {
    return persistedMartingale?.modeFirstStake ?? 0;
  });
  const [modeAccumulatedLoss, setModeAccumulatedLoss] = useState<number>(() => {
    return persistedMartingale?.modeAccumulatedLoss ?? 0;
  });

  // Virtual Hook State (Absorbs drawdowns in simulated trades until a win occurs)
  const [isInVirtualHook, setIsInVirtualHook] = useState<boolean>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualHookEnabled) return false;
    const active = autoRecoveryStorage.loadActiveTrade();
    if (active && typeof active.id === 'string' && active.id.startsWith('VIRTUAL-')) {
      return true;
    }
    return persistedMartingale?.isInVirtualHook ?? false;
  });
  const [virtualHookLossCount, setVirtualHookLossCount] = useState<number>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualHookEnabled) return 0;
    return persistedMartingale?.virtualHookLossCount ?? 0;
  });
  const [realConsecutiveLosses, setRealConsecutiveLosses] = useState<number>(() => {
    return persistedMartingale?.realConsecutiveLosses ?? 0;
  });

  // Virtual Switch State (Escalates between checked boxes 1-5 upon achieving defined stage Take Profit)
  const [isInVirtualSwitch, setIsInVirtualSwitch] = useState<boolean>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualSwitchEnabled) return false;
    const active = autoRecoveryStorage.loadActiveTrade();
    if (active && typeof active.id === 'string' && active.id.startsWith('VIRTUAL-')) {
      return true;
    }
    return persistedMartingale?.isInVirtualSwitch ?? false;
  });
  const [currentVirtualSwitchStage, setCurrentVirtualSwitchStage] = useState<number>(() => {
    const saved = persistedMartingale?.currentVirtualSwitchStage;
    if (typeof saved === 'number' && saved >= 1 && saved <= 5) return saved;
    const initialBoxes = params?.virtualSwitchBoxes;
    if (Array.isArray(initialBoxes) && initialBoxes.length > 0) return initialBoxes[0];
    return 1;
  });
  const [virtualSwitchStageProfit, setVirtualSwitchStageProfit] = useState<number>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualSwitchEnabled) return 0;
    return persistedMartingale?.virtualSwitchStageProfit ?? 0;
  });
  const [virtualSwitchLossCount, setVirtualSwitchLossCount] = useState<number>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualSwitchEnabled) return 0;
    return persistedMartingale?.virtualSwitchLossCount ?? 0;
  });

  const isInVirtualSwitchRef = useRef<boolean>(isInVirtualSwitch);
  isInVirtualSwitchRef.current = isInVirtualSwitch;

  const currentVirtualSwitchStageRef = useRef<number>(currentVirtualSwitchStage);
  currentVirtualSwitchStageRef.current = currentVirtualSwitchStage;

  const virtualSwitchStageProfitRef = useRef<number>(virtualSwitchStageProfit);
  virtualSwitchStageProfitRef.current = virtualSwitchStageProfit;

  const virtualSwitchLossCountRef = useRef<number>(virtualSwitchLossCount);
  virtualSwitchLossCountRef.current = virtualSwitchLossCount;

  // Virtual Count State (Executes N consecutive losses virtually before switching to real account until profit)
  const [isInVirtualCount, setIsInVirtualCount] = useState<boolean>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualCountEnabled) return false;
    const active = autoRecoveryStorage.loadActiveTrade();
    if (active && active.status === 'open') {
      if (active.isVirtualTrade === true || (typeof active.id === 'string' && active.id.startsWith('VIRTUAL-'))) {
        return true;
      }
      return false;
    }
    if (typeof persistedMartingale?.isInVirtualCount === 'boolean') {
      return persistedMartingale.isInVirtualCount;
    }
    return true;
  });
  const [virtualCountLosses, setVirtualCountLosses] = useState<number>(() => {
    const savedParams = autoRecoveryStorage.loadTradingParams();
    if (!savedParams?.virtualCountEnabled) return 0;
    return persistedMartingale?.virtualCountLosses ?? 0;
  });

  const isInVirtualCountRef = useRef<boolean>(isInVirtualCount);
  isInVirtualCountRef.current = isInVirtualCount;

  const virtualCountLossesRef = useRef<number>(virtualCountLosses);
  virtualCountLossesRef.current = virtualCountLosses;

  // Refs for tracking mutable state in WS callbacks without re-triggering effects
  const isAutoTradingRef = useRef(isAutoTrading);
  isAutoTradingRef.current = isAutoTrading;

  const autoTraderStartedAtRef = useRef<number | null>(autoTraderStartedAt);
  autoTraderStartedAtRef.current = autoTraderStartedAt;

  const currentMartingaleStepRef = useRef(currentMartingaleStep);
  currentMartingaleStepRef.current = currentMartingaleStep;

  const accumulatedLossRef = useRef<number>(accumulatedLoss);
  accumulatedLossRef.current = accumulatedLoss;

  const currentPhaseRef = useRef<number>(1);
  currentPhaseRef.current = currentPhase;

  const cycleLossCountRef = useRef<number>(0);
  cycleLossCountRef.current = cycleLossCount;

  const isPausedAwaitingSignalRef = useRef<boolean>(false);
  isPausedAwaitingSignalRef.current = isPausedAwaitingSignal;

  const currentModeRef = useRef<number>(0);
  currentModeRef.current = currentMode;

  const defaultModeLossCountRef = useRef<number>(0);
  defaultModeLossCountRef.current = defaultModeLossCount;

  const inModeLossCountRef = useRef<number>(0);
  inModeLossCountRef.current = inModeLossCount;

  const modeFirstStakeRef = useRef<number>(0);
  modeFirstStakeRef.current = modeFirstStake;

  const modeAccumulatedLossRef = useRef<number>(0);
  modeAccumulatedLossRef.current = modeAccumulatedLoss;

  const isInVirtualHookRef = useRef<boolean>(isInVirtualHook);
  isInVirtualHookRef.current = isInVirtualHook;

  const virtualHookLossCountRef = useRef<number>(virtualHookLossCount);
  virtualHookLossCountRef.current = virtualHookLossCount;

  const realConsecutiveLossesRef = useRef<number>(realConsecutiveLosses);
  realConsecutiveLossesRef.current = realConsecutiveLosses;

  const correctedLossItemsRef = useRef<CorrectedLossItem[]>(correctedLossItems);
  correctedLossItemsRef.current = correctedLossItems;

  const lastTradeDirectionRef = useRef<'CALL' | 'PUT'>('CALL');

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const startingBalanceRef = useRef(startingBalance);
  startingBalanceRef.current = startingBalance;

  const currentBalanceRef = useRef(currentBalance);
  currentBalanceRef.current = currentBalance;

  const accountRef = useRef<DerivAccount | null>(account);
  accountRef.current = account;

  const selectedStrategyRef = useRef(selectedStrategy);
  selectedStrategyRef.current = selectedStrategy;

  const ticksRef = useRef<MarketTick[]>([]);
  ticksRef.current = ticks;

  const tradeRecordsRef = useRef<TradeRecord[]>([]);
  tradeRecordsRef.current = tradeRecords;

  const candlesRef = useRef<CandleData[]>([]);
  candlesRef.current = candles;

  // Strict Virtual Features Synchronization:
  // Whenever any virtual feature is not enabled, ensure its tracking state is immediately deactivated and reset
  useEffect(() => {
    if (!params.virtualHookEnabled) {
      setIsInVirtualHook(false);
      isInVirtualHookRef.current = false;
      setVirtualHookLossCount(0);
      virtualHookLossCountRef.current = 0;
    }
    if (!params.virtualSwitchEnabled) {
      setIsInVirtualSwitch(false);
      isInVirtualSwitchRef.current = false;
      setVirtualSwitchLossCount(0);
      virtualSwitchLossCountRef.current = 0;
    }
    if (!params.virtualCountEnabled) {
      setIsInVirtualCount(false);
      isInVirtualCountRef.current = false;
      setVirtualCountLosses(0);
      virtualCountLossesRef.current = 0;
    }
  }, [params.virtualHookEnabled, params.virtualSwitchEnabled, params.virtualCountEnabled]);

  const latestSmcResultRef = useRef<SmcAnalysisResult | null>(null);

  // SMC Indicator Configuration (synchronized with chart settings and user-selected swing point)
  const [smcConfig, setSmcConfig] = useState<SmcIndicatorConfig>(() => {
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
    } catch {}
    return DEFAULT_SMC_CONFIG;
  });

  const smcConfigRef = useRef<SmcIndicatorConfig>(smcConfig);
  smcConfigRef.current = smcConfig;

  const handleUpdateSmcConfig = useCallback((newConfig: SmcIndicatorConfig) => {
    setSmcConfig(newConfig);
    smcConfigRef.current = newConfig;
    try {
      localStorage.setItem('deriv_smc_indicator_config', JSON.stringify(newConfig));
    } catch {}
    // Immediately re-evaluate multi-market SMC analysis using the updated swing point
    Object.keys(marketCandlesRef.current).forEach((sym) => {
      const cList = marketCandlesRef.current[sym];
      if (cList && cList.length >= 10) {
        marketSmcRef.current[sym] = calculateSMC(cList, newConfig);
      }
    });
  }, []);

  // Active trade tracking, execution locking, and SMC execution refs
  const activeTradeRef = useRef<TradeRecord | null>(
    (() => {
      const now = Date.now();
      const isRunning = (t?: TradeRecord | null) =>
        Boolean(t && t.status === 'open' && t.contractId && (now - (t.purchaseTime || 0)) < 65000);
      const single = autoRecoveryStorage.loadActiveTrade();
      if (isRunning(single)) return single;
      const list = autoRecoveryStorage.loadActiveTrades();
      if (Array.isArray(list)) {
        const found = list.find(isRunning);
        if (found) return found;
      }
      const records = autoRecoveryStorage.loadTradeRecords();
      if (Array.isArray(records)) {
        const found = records.find(isRunning);
        if (found) return found;
      }
      return null;
    })()
  );
  const isTradePendingRef = useRef<boolean>(false);
  const isExecutingTradeRef = useRef<boolean>(false);
  const lastExecutedCandleMinuteRef = useRef<number>(0);
  const lastExecutedCandleEpochRef = useRef<number>(
    (() => {
      const now = Date.now();
      const checkTrade = (t?: TradeRecord | null) => {
        if (t && t.purchaseTime && (now - t.purchaseTime) < 65000 && t.status === 'open') {
          const curSec = Math.floor(now / 1000);
          return curSec - (curSec % 60);
        }
        return 0;
      };
      return checkTrade(autoRecoveryStorage.loadActiveTrade()) || 0;
    })()
  );
  const continuousCandleEpochTradedRef = useRef<Record<string, number>>({});
  const tradedStructureIdsRef = useRef<Set<string>>(new Set());
  const handledContractIdsRef = useRef<Set<number>>(new Set());
  const settledContractOutcomesRef = useRef<Map<number, 'won' | 'lost'>>(new Map());
  const preWinPhaseStateRef = useRef<
    Map<
      number,
      {
        cycleLossCount: number;
        currentPhase: number;
        isPausedAwaitingSignal: boolean;
        isInVirtualCount: boolean;
        virtualCountLosses: number;
        defaultModeLossCount: number;
        inModeLossCount: number;
        currentMode: number;
        modeFirstStake: number;
        modeAccumulatedLoss: number;
      }
    >
  >(new Map());
  const autoTraderStartTimeRef = useRef<number>(0);
  const autoTraderStartBalanceRef = useRef<number>(0);
  const autoTraderStartPnlOffsetRef = useRef<number>(autoRecoveryStorage.loadAutoTraderPnlBaseline());
  const autoTraderStartCandleEpochRef = useRef<number>(0);
  const pendingStructureBreakRef = useRef<{
    id: string;
    type: 'BOS' | 'CHoCH';
    direction: 'bullish' | 'bearish';
    level: number;
    candleEpoch: number;
    detectedTime: number;
    symbol?: string;
    symbolName?: string;
  } | null>(null);
  const minNextSignalCandleEpochRef = useRef<number>(0);

  // Pre-populate settledContractOutcomesRef and handledContractIdsRef from loaded tradeRecords
  useEffect(() => {
    tradeRecords.forEach((t) => {
      const cId = Number(t.contractId);
      if (!isNaN(cId) && cId > 0) {
        if (t.status === 'won' || t.status === 'lost') {
          settledContractOutcomesRef.current.set(cId, t.status);
          handledContractIdsRef.current.add(cId);
        }
      }
    });
  }, [tradeRecords]);

  // Multi-Market Trading & Scanner State & Persistence
  const [multiMarketEnabled, setMultiMarketEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('deriv_multi_market_enabled') === 'true';
    } catch {
      return false;
    }
  });

  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('deriv_multi_market_symbols');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
  });

  const [marketScanStatus, setMarketScanStatus] = useState<Record<string, MultiMarketScanItem>>({});

  const multiMarketEnabledRef = useRef<boolean>(multiMarketEnabled);
  multiMarketEnabledRef.current = multiMarketEnabled;

  const selectedMarketsRef = useRef<string[]>(selectedMarkets);
  selectedMarketsRef.current = selectedMarkets;

  const marketCandlesRef = useRef<Record<string, CandleData[]>>({});
  const marketTicksRef = useRef<Record<string, MarketTick>>({});
  const marketSmcRef = useRef<Record<string, SmcAnalysisResult>>({});
  const marketPendingBreaksRef = useRef<
    Record<
      string,
      {
        id: string;
        type: 'BOS' | 'CHoCH';
        direction: 'bullish' | 'bearish';
        level: number;
        candleEpoch: number;
        detectedTime: number;
        symbol: string;
        symbolName: string;
      } | null
    >
  >({});

  // Recovery Mode Market Lock:
  // When trading multiple markets, if a trade is executed on a volatility and loses,
  // the bot locks strictly onto that volatility for its Martingale recovery sequence until a win
  // or until the post-loss pause target is reached.
  const [recoveryLockedMarket, setRecoveryLockedMarket] = useState<{ symbol: string; symbolName: string } | null>(() => {
    return persistedMartingale?.recoveryLockedMarket || null;
  });
  const recoveryLockedMarketRef = useRef<{ symbol: string; symbolName: string } | null>(null);
  recoveryLockedMarketRef.current = recoveryLockedMarket;

  // Track symbol that just triggered pause trade so the system prioritizes other pairs on subsequent signals
  const pausedFromMarketRef = useRef<string | null>(null);

  // Individual Multi-Market Trading: Independent Martingale per market & Concurrent Trades
  const [individualMultiMarketEnabled, setIndividualMultiMarketEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('deriv_individual_multi_market_enabled');
      if (stored !== null) return stored === 'true';
    } catch {}
    return params.individualMultiMarketEnabled ?? false;
  });
  const individualMultiMarketEnabledRef = useRef<boolean>(individualMultiMarketEnabled);
  individualMultiMarketEnabledRef.current = individualMultiMarketEnabled;

  const [marketMartingaleStates, setMarketMartingaleStates] = useState<Record<string, MarketMartingaleState>>(() => {
    return autoRecoveryStorage.loadMarketMartingaleStates();
  });
  const marketMartingaleStatesRef = useRef<Record<string, MarketMartingaleState>>(marketMartingaleStates);
  marketMartingaleStatesRef.current = marketMartingaleStates;

  // Track per-market last executed candle epoch to prevent duplicate trade on same candle for same market,
  // while allowing concurrent trades across different markets
  const marketLastExecutedCandleEpochRef = useRef<Record<string, number>>(
    (() => {
      const epochs: Record<string, number> = {};
      const now = Date.now();
      const curSec = Math.floor(now / 1000);
      const curCandle = curSec - (curSec % 60);

      const checkTrade = (t?: TradeRecord | null) => {
        if (t && t.symbol && t.purchaseTime && (now - t.purchaseTime) < 65000 && t.status === 'open') {
          epochs[t.symbol] = curCandle;
        }
      };

      const saved = autoRecoveryStorage.loadActiveTrades();
      (saved || []).forEach(checkTrade);
      checkTrade(autoRecoveryStorage.loadActiveTrade());
      (autoRecoveryStorage.loadTradeRecords() || []).forEach(checkTrade);
      return epochs;
    })()
  );
  const marketMinNextSignalCandleEpochRef = useRef<Record<string, number>>({});
  const executingMarketsRef = useRef<Set<string>>(new Set());
  const pending59sReentryMarketsRef = useRef<Set<string>>(new Set());

  // Concurrent active trades map & state:
  // Reconstitute all running trades from active trades storage, single trade storage, and trade history
  const [activeTrades, setActiveTrades] = useState<TradeRecord[]>(() => {
    const list: TradeRecord[] = [];
    const now = Date.now();
    const isRunning = (t?: TradeRecord | null) =>
      Boolean(t && t.status === 'open' && t.contractId && (now - (t.purchaseTime || 0)) < 65000);

    const savedList = autoRecoveryStorage.loadActiveTrades();
    if (Array.isArray(savedList)) {
      savedList.forEach((t) => {
        if (isRunning(t) && !list.some((x) => x.contractId === t.contractId)) list.push(t);
      });
    }
    const single = autoRecoveryStorage.loadActiveTrade();
    if (single && isRunning(single) && !list.some((x) => x.contractId === single.contractId)) {
      list.push(single);
    }
    const records = autoRecoveryStorage.loadTradeRecords();
    if (Array.isArray(records)) {
      records.forEach((t) => {
        if (isRunning(t) && !list.some((x) => x.contractId === t.contractId)) list.push(t);
      });
    }
    return list;
  });

  const activeTradesRef = useRef<Map<string, TradeRecord>>(
    new Map(
      (() => {
        const list: [string, TradeRecord][] = [];
        const now = Date.now();
        const isRunning = (t?: TradeRecord | null) =>
          Boolean(t && t.status === 'open' && t.contractId && t.symbol && (now - (t.purchaseTime || 0)) < 65000);

        const savedList = autoRecoveryStorage.loadActiveTrades();
        if (Array.isArray(savedList)) {
          savedList.forEach((t) => {
            if (isRunning(t) && !list.some(([sym]) => sym === t.symbol)) list.push([t.symbol!, t]);
          });
        }
        const single = autoRecoveryStorage.loadActiveTrade();
        if (single && isRunning(single) && !list.some(([sym]) => sym === single.symbol)) {
          list.push([single.symbol!, single]);
        }
        const records = autoRecoveryStorage.loadTradeRecords();
        if (Array.isArray(records)) {
          records.forEach((t) => {
            if (isRunning(t) && !list.some(([sym]) => sym === t.symbol)) list.push([t.symbol!, t]);
          });
        }
        return list;
      })()
    )
  );

  // Keep activeTradeRef and activeTrades synchronized, and automatically persist running trades
  useEffect(() => {
    activeTradesRef.current.clear();
    activeTrades.forEach((t) => {
      if (t.symbol) {
        activeTradesRef.current.set(t.symbol, t);
      }
    });
    activeTradeRef.current = activeTrades.length > 0 ? activeTrades[0] : null;
    autoRecoveryStorage.saveActiveTrades(activeTrades);
  }, [activeTrades]);

  const handleToggleIndividualMultiMarket = useCallback((enabled: boolean) => {
    setIndividualMultiMarketEnabled(enabled);
    individualMultiMarketEnabledRef.current = enabled;
    try {
      localStorage.setItem('deriv_individual_multi_market_enabled', String(enabled));
    } catch {}
    setParams((prev) => {
      const updated = { ...prev, individualMultiMarketEnabled: enabled };
      autoRecoveryStorage.saveTradingParams(updated);
      return updated;
    });
  }, []);

  const handleResetAllMarketMartingales = useCallback(() => {
    setMarketMartingaleStates({});
    marketMartingaleStatesRef.current = {};
    marketMinNextSignalCandleEpochRef.current = {};
    marketLastExecutedCandleEpochRef.current = {};
    autoRecoveryStorage.clearMarketMartingaleStates();
    setBotStatusMessage('All Individual Market Martingales reset to base stake ($' + paramsRef.current.stake.toFixed(2) + ').');
  }, []);

  // Credit from a previous trade that was locally settled as loss, but confirmed as WIN by Deriv while next trade was running
  const correctedWinCreditRef = useRef<number>(0);

  const executeTradeRef = useRef<
    (
      contractTypeToTrade?: 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD',
      overrideStake?: number,
      associatedStructureId?: string,
      overrideSymbol?: string,
      overrideSymbolName?: string
    ) => Promise<void>
  >(async () => {});
  const evaluateAndTriggerAutoStrategyRef = useRef<() => void>(() => {});
  const checkAndExecuteSmcBreakRef = useRef<(smc?: SmcAnalysisResult | null) => void>(() => {});
  const continuousDirectionRef = useRef<Record<string, 'CALL' | 'PUT'>>({});
  const checkAndExecuteContinuousTradeRef = useRef<(smc?: SmcAnalysisResult | null) => void>(() => {});
  const handleConnectRef = useRef<
    (tokenToUse: string, requestedAppId: string, preferredAccountId?: string, preferVirtual?: boolean) => Promise<void>
  >(async () => {});

  // Active session authentication in memory
  const sessionAuthRef = useRef<{ token: string } | null>(null);

  // Auto-sync trading parameters, strategy, trade history & Martingale state
  useEffect(() => {
    autoRecoveryStorage.saveTradingParams(params);
  }, [params]);

  useEffect(() => {
    autoRecoveryStorage.saveStrategyId(selectedStrategy.id);
  }, [selectedStrategy]);

  useEffect(() => {
    autoRecoveryStorage.saveTradeRecords(tradeRecords);
    const activeAccId = accountRef.current?.loginid || account?.loginid;
    if (activeAccId) {
      autoRecoveryStorage.saveAccountTradeRecords(activeAccId, tradeRecords);
    }
  }, [tradeRecords, account?.loginid]);

  // Keep active session (selected Real/Demo accountId, isVirtual, balance, currency) synchronized across reloads
  useEffect(() => {
    if (connectionState === 'authorized' && account?.loginid && sessionAuthRef.current?.token) {
      autoRecoveryStorage.saveActiveSession({
        token: sessionAuthRef.current.token,
        appId: account.appId || appId,
        accountId: account.loginid,
        isVirtual: Boolean(account.isVirtual),
        balance: currentBalance,
        currency: currency || account.currency || 'USD',
        fullname: account.fullname,
      });
    }
  }, [connectionState, account?.loginid, account?.isVirtual, account?.appId, account?.currency, account?.fullname, currentBalance, currency, appId]);

  useEffect(() => {
    autoRecoveryStorage.saveMartingaleState({
      currentMartingaleStep,
      cycleLossCount,
      isPausedAwaitingSignal,
      recoveryLockedMarket,
      startingBalance,
      accumulatedLoss,
      currentPhase,
      currentMode,
      defaultModeLossCount,
      inModeLossCount,
      modeFirstStake,
      modeAccumulatedLoss,
      isInVirtualHook,
      virtualHookLossCount,
      isInVirtualSwitch,
      currentVirtualSwitchStage,
      virtualSwitchStageProfit,
      virtualSwitchLossCount,
      realConsecutiveLosses,
      isInVirtualCount,
      virtualCountLosses,
    });
  }, [
    currentMartingaleStep,
    cycleLossCount,
    isPausedAwaitingSignal,
    recoveryLockedMarket,
    startingBalance,
    accumulatedLoss,
    currentPhase,
    currentMode,
    defaultModeLossCount,
    inModeLossCount,
    modeFirstStake,
    modeAccumulatedLoss,
    isInVirtualHook,
    virtualHookLossCount,
    isInVirtualSwitch,
    currentVirtualSwitchStage,
    virtualSwitchStageProfit,
    virtualSwitchLossCount,
    realConsecutiveLosses,
    isInVirtualCount,
    virtualCountLosses,
  ]);

  useEffect(() => {
    autoRecoveryStorage.saveAutoTradingState(isAutoTrading);
    if (isAutoTrading) {
      if (autoTraderStartedAtRef.current === null) {
        const nowMs = Date.now();
        autoTraderStartedAtRef.current = nowMs;
        setAutoTraderStartedAt(nowMs);
        setAutoTraderStoppedElapsedMs(null);
        autoRecoveryStorage.saveAutoTraderTimer(nowMs, null);
      }
    } else if (autoTraderStartedAtRef.current !== null) {
      const elapsed = Math.max(0, Date.now() - autoTraderStartedAtRef.current);
      autoTraderStartedAtRef.current = null;
      setAutoTraderStartedAt(null);
      setAutoTraderStoppedElapsedMs(elapsed);
      autoRecoveryStorage.saveAutoTraderTimer(null, elapsed);
    }
  }, [isAutoTrading]);

  // Calculate current stake according to loss recovery (covering all unrecovered and corrected losses) or standard Martingale
  const calculateCurrentStake = useCallback((stepOverride?: number, lossOverride?: number, symbolOverride?: string): number => {
    const p = paramsRef.current;
    const base = p.stake;
    const step = typeof stepOverride === 'number' ? stepOverride : currentMartingaleStepRef.current;

    // When inside Virtual Hook, Virtual Switch, or Virtual Count mode, use default flat virtual stake (no martingale for virtual trades!)
    const isHookActive = Boolean(p.virtualHookEnabled) && isInVirtualHookRef.current;
    const isSwitchActive = Boolean(p.virtualSwitchEnabled) && isInVirtualSwitchRef.current;
    const isCountActive = Boolean(p.virtualCountEnabled) && isInVirtualCountRef.current;

    if (isHookActive || isSwitchActive || isCountActive) {
      return p.stake ?? 0.35;
    }

    // Payout rate on Deriv (standard Rise/Fall is 83%, or user-configured autoMartingalePayoutPercent)
    const payoutPercent = p.autoMartingalePayoutPercent || 83;
    const payoutRate = payoutPercent / 100;

    // Check recent trade history cycle loss for real trades:
    const records = tradeRecordsRef.current.length > 0 ? tradeRecordsRef.current : autoRecoveryStorage.loadTradeRecords();
    const { totalLoss: currentCycleLoss, consecutiveCount } = calculateConsecutiveCycleLoss(records);

    const isInActiveInterModeRecovery =
      Boolean(p.inInterModeEnabled) &&
      currentModeRef.current >= 1 &&
      modeAccumulatedLossRef.current > 0.01;

    // If stepOverride and lossOverride are not explicitly passed:
    // When consecutiveCount === 0 (or most recent real trade was a WIN), there is NO Martingale to apply
    // UNLESS we are actively recovering sequence loss inside In/Inter-Mode Mode 1..10!
    if (typeof stepOverride !== 'number' && typeof lossOverride !== 'number') {
      if (!isInActiveInterModeRecovery && (consecutiveCount === 0 || currentCycleLoss <= 0)) {
        currentMartingaleStepRef.current = 0;
        accumulatedLossRef.current = 0;
        defaultModeLossCountRef.current = 0;
        return Number(base.toFixed(2));
      }
    }

    // Check pending settlement corrected loss items ONLY if there is an active unrecovered cycle loss
    const pendingLossList = (
      (consecutiveCount > 0 && currentCycleLoss > 0)
        ? (
            (correctedLossItemsRef.current && correctedLossItemsRef.current.length > 0)
              ? correctedLossItemsRef.current
              : (autoRecoveryStorage.loadCorrectedLossItems() || [])
          ).filter((item) => item.status === 'pending_recovery')
        : []
    );

    let pendingCorrectedRecoveryStake = 0;
    let totalPendingCorrectedLoss = 0;
    if (pendingLossList.length > 0) {
      totalPendingCorrectedLoss = pendingLossList.reduce((acc, curr) => {
        const { totalLoss } = calculateConsecutiveCycleLoss(records, curr.contractId);
        return acc + Math.max(curr.lossAmount || 0, totalLoss);
      }, 0);

      const maxItemStake = pendingLossList.reduce((max, item) => Math.max(max, item.recoveryStake || 0), 0);
      const calculatedRecoveryStake = Math.ceil((totalPendingCorrectedLoss / payoutRate) * 100) / 100;
      pendingCorrectedRecoveryStake = Math.max(maxItemStake, calculatedRecoveryStake);
    }

    // INDIVIDUAL MULTI-MARKET MARTINGALE:
    // When enabled, calculate the stake specifically based on this market's independent sequence
    if (individualMultiMarketEnabledRef.current && symbolOverride) {
      const mState = marketMartingaleStatesRef.current[symbolOverride];
      const mStep = typeof stepOverride === 'number' ? stepOverride : (mState?.currentMartingaleStep ?? 0);
      const mLoss = typeof lossOverride === 'number' ? lossOverride : (mState?.accumulatedLoss ?? 0);

      // If no loss or steps for this market, return base stake immediately
      if (mLoss <= 0 && mStep <= 0) {
        return Number(base.toFixed(2));
      }

      let indivStake = base;
      if (mLoss > 0) {
        const requiredRecoveryStake = Math.ceil((mLoss / payoutRate) * 100) / 100;
        if (!p.autoMartingaleEnabled && mStep > 0) {
          const factor = Math.max(1.05, p.multiplier);
          const rawMultiplier = Math.pow(factor, mStep);
          const multiplierStake = Number((base * rawMultiplier).toFixed(2));
          indivStake = Math.max(multiplierStake, requiredRecoveryStake);
        } else {
          indivStake = Math.max(Number(base.toFixed(2)), requiredRecoveryStake);
        }
      } else if (mStep > 0) {
        const factor = Math.max(1.05, p.multiplier);
        const rawMultiplier = Math.pow(factor, mStep);
        indivStake = Number((base * rawMultiplier).toFixed(2));
      } else {
        indivStake = Number(base.toFixed(2));
      }

      if (pendingCorrectedRecoveryStake > 0 && consecutiveCount > 0) {
        return Math.max(indivStake, pendingCorrectedRecoveryStake);
      }

      return indivStake;
    }

    // Check In-Mode and Inter-Mode Martingale:
    if (p.inInterModeEnabled) {
      const mode = currentModeRef.current;
      if (mode >= 1 && mode <= 10) {
        if (modeAccumulatedLossRef.current <= 0.01 && consecutiveCount === 0) {
          return Number(base.toFixed(2));
        }

        const modes = Array.isArray(p.modesConfig) && p.modesConfig.length === 10
          ? p.modesConfig
          : DEFAULT_IN_INTER_MODES;
        const modeConfig = modes[mode - 1];
        const inMultiplier = modeConfig.inModeMartingale || 1.4;

        // Mode 1st trade stake chains from previous mode's 1st stake * current mode's interModeMartingale
        let chainedFirstStake = base;
        for (let m = 0; m < mode; m++) {
          chainedFirstStake = roundInInterStake(
            chainedFirstStake * (modes[m]?.interModeMartingale || 1.5)
          );
        }
        const initialModeStake = modeFirstStakeRef.current > 0
          ? modeFirstStakeRef.current
          : chainedFirstStake;

        const inLoss = inModeLossCountRef.current;
        if (inLoss <= 0) {
          return Math.max(0.35, initialModeStake);
        }

        // Apply In-Mode Martingale sequentially on losses within this mode
        let inModeStake = initialModeStake;
        for (let i = 0; i < inLoss; i++) {
          inModeStake = roundInInterStake(inModeStake * inMultiplier);
        }
        return inModeStake;
      }
    }

    // Total loss that must be recovered on the next win
    const lossToRecover = typeof lossOverride === 'number'
      ? lossOverride
      : (consecutiveCount > 0 ? Math.max(accumulatedLossRef.current, currentCycleLoss, totalPendingCorrectedLoss) : 0);

    // When there is an unrecovered loss verified from loss sequence:
    // Calculate the exact stake that guarantees full loss recovery on a win:
    // Profit = stake * payoutRate. To recover loss: stake * payoutRate >= lossToRecover
    if (lossToRecover > 0 || (pendingCorrectedRecoveryStake > 0 && consecutiveCount > 0)) {
      const calculatedRecoveryStake = lossToRecover > 0 ? Math.ceil((lossToRecover / payoutRate) * 100) / 100 : 0;
      const requiredRecoveryStake = Math.max(pendingCorrectedRecoveryStake, calculatedRecoveryStake);

      // In multiplier mode without a pending corrected loss, check if standard multiplier stake is higher:
      if (!p.autoMartingaleEnabled && pendingLossList.length === 0 && step > 0) {
        const factor = Math.max(1.05, p.multiplier);
        const rawMultiplier = Math.pow(factor, step);
        const multiplierStake = Number((base * rawMultiplier).toFixed(2));
        return Math.max(multiplierStake, requiredRecoveryStake);
      }

      return Math.max(Number(base.toFixed(2)), requiredRecoveryStake);
    }

    if (step === 0 || consecutiveCount === 0) return Number(base.toFixed(2));

    const factor = Math.max(1.05, p.multiplier);
    const rawMultiplier = Math.pow(factor, step);
    return Math.max(0.35, Number((base * rawMultiplier).toFixed(2)));
  }, []);

  // Helper to reliably detect virtual trades (Virtual Hook, Virtual Switch, Virtual Count)
  // Simulated virtual contracts have IDs starting with 'VIRTUAL-' or isVirtualTrade: true
  // Strictly returns false if no virtual feature is enabled, ensuring straight trading on account
  const isTradeRecordVirtual = useCallback((t: TradeRecord): boolean => {
    if (!t) return false;
    const p = paramsRef.current;
    const isVirtualSystemActive = Boolean(p.virtualHookEnabled || p.virtualSwitchEnabled || p.virtualCountEnabled);
    if (!isVirtualSystemActive) return false;
    if (t.isVirtualTrade === true) return true;
    if (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) return true;
    if (String(t.contractId).startsWith('VIRTUAL-')) return true;
    return false;
  }, []);

  // Derived balance statistics
  // Calculate total stake currently committed to active, open REAL contracts (virtual trades do not affect real balance)
  const activeOpenStake = tradeRecords
    .filter((t) => t.status === 'open' && !isTradeRecordVirtual(t))
    .reduce((sum, t) => sum + (typeof t.stake === 'number' ? t.stake : 0), 0);

  // Settled real trades (real account trades only: virtual trades do not affect real PnL, broker balance, or win/loss counts)
  const settledRealTrades = tradeRecords.filter(
    (t) => (t.status === 'won' || t.status === 'lost') && !isTradeRecordVirtual(t)
  );
  const wonTrades = settledRealTrades.filter((t) => t.status === 'won').length;
  const lostTrades = settledRealTrades.filter((t) => t.status === 'lost').length;
  const totalTrades = wonTrades + lostTrades;
  const winRate = totalTrades > 0 ? (wonTrades / totalTrades) * 100 : 0;

  // Real Account Gross Profit & Gross Loss details
  const grossProfit = Number(
    settledRealTrades
      .filter((t) => t.status === 'won')
      .reduce((sum, t) => sum + Math.max(0, getTradeProfit(t)), 0)
      .toFixed(2)
  );

  const grossLoss = Number(
    settledRealTrades
      .filter((t) => t.status === 'lost')
      .reduce((sum, t) => sum + Math.abs(getTradeProfit(t)), 0)
      .toFixed(2)
  );

  // Cumulative Net Profit / Loss directly from all settled REAL contracts in trade history:
  const tradesCumulativeProfit = Number((grossProfit - grossLoss).toFixed(2));
  const netProfitLoss = settledRealTrades.length > 0 ? tradesCumulativeProfit : 0;

  // Virtual Trades statistics for detailed tracking
  const settledVirtualTrades = tradeRecords.filter(
    (t) => (t.status === 'won' || t.status === 'lost') && isTradeRecordVirtual(t)
  );
  const virtualWonTrades = settledVirtualTrades.filter((t) => t.status === 'won').length;
  const virtualLostTrades = settledVirtualTrades.filter((t) => t.status === 'lost').length;
  const virtualTotalTrades = virtualWonTrades + virtualLostTrades;
  const virtualWinRate = virtualTotalTrades > 0 ? (virtualWonTrades / virtualTotalTrades) * 100 : 0;
  const virtualGrossProfit = Number(
    settledVirtualTrades
      .filter((t) => t.status === 'won')
      .reduce((sum, t) => sum + Math.max(0, getTradeProfit(t)), 0)
      .toFixed(2)
  );
  const virtualGrossLoss = Number(
    settledVirtualTrades
      .filter((t) => t.status === 'lost')
      .reduce((sum, t) => sum + Math.abs(getTradeProfit(t)), 0)
      .toFixed(2)
  );
  const virtualNetProfitLoss = Number((virtualGrossProfit - virtualGrossLoss).toFixed(2));

  // Settled current balance:
  // When a real contract is opened, broker balances deduct the active stake while the trade is running.
  // We offset activeOpenStake so that open trades do NOT artificially lower the current balance or trigger premature negative PnL.
  // Virtual hook trades never alter broker balance.
  const settledCurrentBalance = currentBalance > 0
    ? Number((currentBalance + activeOpenStake).toFixed(2))
    : 0;

  // Stable Starting Balance:
  // Anchored to startingBalance established at login or session reset.
  const resolvedStartingBalance = startingBalance > 0
    ? startingBalance
    : (settledCurrentBalance > 0
      ? (settledRealTrades.length > 0 ? Math.max(0, Number((settledCurrentBalance - netProfitLoss).toFixed(2))) : settledCurrentBalance)
      : 0);

  const netProfitLossPercentage = resolvedStartingBalance > 0 && netProfitLoss !== 0
    ? Number(((netProfitLoss / resolvedStartingBalance) * 100).toFixed(2))
    : 0;

  const balanceStats: BalanceStats = {
    startingBalance: resolvedStartingBalance,
    currentBalance: settledCurrentBalance > 0 ? settledCurrentBalance : currentBalance,
    netProfitLoss,
    netProfitLossPercentage,
    grossProfit,
    grossLoss,
    totalTrades,
    wonTrades,
    lostTrades,
    winRate: Number(winRate.toFixed(1)),
    virtualStats: {
      totalTrades: virtualTotalTrades,
      wonTrades: virtualWonTrades,
      lostTrades: virtualLostTrades,
      winRate: Number(virtualWinRate.toFixed(1)),
      grossProfit: virtualGrossProfit,
      grossLoss: virtualGrossLoss,
      netProfitLoss: virtualNetProfitLoss,
    },
  };

  // Direct client-side broker trade execution (executes trades reliably directly against Deriv API & WebSocket gateways)
  const executeBrokerTradeDirectly = useCallback(
    async (tradeParams: {
      token: string;
      accountId: string;
      appId: string;
      symbol: string;
      contractType: string;
      stake: number;
      currency?: string;
      duration?: number;
      durationUnit?: string;
    }): Promise<{ proposal: any; buy: any }> => {
      const {
        token,
        accountId,
        appId: reqAppId,
        symbol,
        contractType,
        stake,
        currency = 'USD',
        duration = 1,
        durationUnit = 'm',
      } = tradeParams;

      let lastBrokerError = '';

      // 1. If active derivWs socket is already connected and open, try instant proposal & buy
      try {
        const directWsRes = await derivWs.requestProposalAndBuy({
          symbol,
          contractType,
          amount: stake,
          currency,
          duration,
          durationUnit,
          timeoutMs: 4500,
        });
        if (directWsRes?.buy?.buy?.contract_id) {
          return directWsRes;
        }
      } catch (wsErr: any) {
        lastBrokerError = wsErr?.message || '';
        console.warn('[Direct derivWs Order Notice]:', wsErr?.message);
      }

      // 2. If PAT token and account ID present, try fresh direct Deriv Options OTP session
      if (token.startsWith('pat_') && accountId) {
        const candidates = [reqAppId, '33IM5dIMuFaBupAhk042L', '1089'].filter(Boolean) as string[];
        let otpWsUrl: string | null = null;

        for (const patApp of candidates) {
          try {
            const otpRes = await fetch(
              `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Deriv-App-ID': patApp,
                  'Content-Type': 'application/json',
                },
              }
            );
            if (otpRes.ok) {
              const otpJson = await otpRes.json();
              const url = otpJson?.data?.url || otpJson?.url;
              if (url) {
                otpWsUrl = url;
                break;
              }
            } else {
              const errTxt = await otpRes.text();
              try {
                const j = JSON.parse(errTxt);
                if (j?.message || j?.error) lastBrokerError = j.message || j.error;
              } catch {}
            }
          } catch (e: any) {
            lastBrokerError = e?.message || '';
          }
        }

        if (otpWsUrl) {
          try {
            const otpTradeResult = await new Promise<{ proposal: any; buy: any }>((resolve, reject) => {
              const socket = new WebSocket(otpWsUrl!);
              let proposalData: any = null;
              const timer = setTimeout(() => {
                try { socket.close(); } catch {}
                reject(new Error('Deriv Options OTP order timed out after 7s'));
              }, 7000);

              socket.onopen = () => {
                socket.send(
                  JSON.stringify({
                    proposal: 1,
                    underlying_symbol: symbol,
                    contract_type: contractType,
                    currency,
                    amount: stake,
                    basis: 'stake',
                    duration,
                    duration_unit: durationUnit,
                    req_id: 881,
                  })
                );
              };

              socket.onmessage = (event) => {
                try {
                  const msg = JSON.parse(event.data);
                  if (msg.req_id === 881) {
                    if (msg.error) {
                      clearTimeout(timer);
                      try { socket.close(); } catch {}
                      reject(new Error(msg.error.message || 'Deriv proposal rejected'));
                      return;
                    }
                    if (msg.proposal?.id) {
                      proposalData = msg;
                      socket.send(
                        JSON.stringify({
                          buy: msg.proposal.id,
                          price: Math.max(stake, Number(msg.proposal.ask_price || 0)),
                          req_id: 882,
                        })
                      );
                    }
                  } else if (msg.req_id === 882) {
                    clearTimeout(timer);
                    try { socket.close(); } catch {}
                    if (msg.error) {
                      reject(new Error(msg.error.message || 'Deriv purchase rejected'));
                    } else if (msg.buy?.contract_id) {
                      resolve({ proposal: proposalData, buy: msg });
                    } else {
                      reject(new Error('Contract ID missing in buy confirmation'));
                    }
                  }
                } catch {
                  // ignore
                }
              };

              socket.onerror = () => {
                clearTimeout(timer);
                reject(new Error('Options OTP socket connection error'));
              };
            });

            if (otpTradeResult?.buy?.buy?.contract_id) {
              return otpTradeResult;
            }
          } catch (otpSockErr: any) {
            lastBrokerError = otpSockErr?.message || lastBrokerError;
            console.warn('[Direct Broker OTP Error]:', otpSockErr?.message);
          }
        }
      }

      // 3. Fallback: Direct standard Deriv WebSocket gateway execution
      const endpoints = [
        `wss://ws.derivws.com/websockets/v3?app_id=1089&l=EN&brand=deriv`,
        `wss://ws.binaryws.com/websockets/v3?app_id=1089&l=EN&brand=deriv`,
      ];

      for (const wsEndpoint of endpoints) {
        try {
          const directResult = await new Promise<{ proposal: any; buy: any }>((resolve, reject) => {
            const socket = new WebSocket(wsEndpoint);
            let proposalData: any = null;
            const timer = setTimeout(() => {
              try { socket.close(); } catch {}
              reject(new Error('Deriv WebSocket order timed out after 6s'));
            }, 6000);

            socket.onopen = () => {
              socket.send(JSON.stringify({ authorize: token, req_id: 991 }));
            };

            socket.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data);
                if (msg.req_id === 991) {
                  if (msg.error) {
                    clearTimeout(timer);
                    try { socket.close(); } catch {}
                    reject(new Error(msg.error.message || 'Broker authorization failed'));
                    return;
                  }
                  // Authorized, send proposal
                  socket.send(
                    JSON.stringify({
                      proposal: 1,
                      symbol: symbol,
                      contract_type: contractType,
                      currency,
                      amount: stake,
                      basis: 'stake',
                      duration,
                      duration_unit: durationUnit,
                      req_id: 992,
                    })
                  );
                } else if (msg.req_id === 992) {
                  if (msg.error) {
                    clearTimeout(timer);
                    try { socket.close(); } catch {}
                    reject(new Error(msg.error.message || 'Deriv proposal rejected'));
                    return;
                  }
                  if (msg.proposal?.id) {
                    proposalData = msg;
                    socket.send(
                      JSON.stringify({
                        buy: msg.proposal.id,
                        price: Math.max(stake, Number(msg.proposal.ask_price || 0)),
                        req_id: 993,
                      })
                    );
                  }
                } else if (msg.req_id === 993) {
                  clearTimeout(timer);
                  try { socket.close(); } catch {}
                  if (msg.error) {
                    reject(new Error(msg.error.message || 'Deriv purchase rejected'));
                  } else if (msg.buy?.contract_id) {
                    resolve({ proposal: proposalData, buy: msg });
                  } else {
                    reject(new Error('Contract ID missing in buy confirmation'));
                  }
                }
              } catch {
                // ignore
              }
            };

            socket.onerror = () => {
              clearTimeout(timer);
              reject(new Error('Broker WebSocket connection error'));
            };
          });

          if (directResult?.buy?.buy?.contract_id) {
            return directResult;
          }
        } catch (wsAttemptErr: any) {
          lastBrokerError = wsAttemptErr?.message || lastBrokerError;
          console.warn('[Direct Broker WS Error]:', wsAttemptErr?.message);
        }
      }

      throw new Error(lastBrokerError || 'Trade order could not be placed. Please check broker connection or token permissions.');
    },
    []
  );

  const computeRealCumulativePnl = useCallback((records: TradeRecord[]): number => {
    const completedReal = records.filter(
      (t) => (t.status === 'won' || t.status === 'lost') && !isVirtualRecord(t)
    );
    return Number(
      completedReal
        .reduce((sum, t) => sum + getTradeProfit(t), 0)
        .toFixed(2)
    );
  }, []);

  const checkTakeProfitAndStopLoss = useCallback((recordsSnapshot: TradeRecord[]): boolean => {
    const p = paramsRef.current;
    const cumulativeRealPnl = computeRealCumulativePnl(recordsSnapshot);
    const sessionPnl = Number((cumulativeRealPnl - (autoTraderStartPnlOffsetRef.current || 0)).toFixed(2));
    const userTp = Number(p.takeProfit);
    const userSl = Number(p.stopLoss);

    if (!isNaN(userTp) && userTp > 0 && sessionPnl >= userTp) {
      setIsAutoTrading(false);
      isAutoTradingRef.current = false;
      autoRecoveryStorage.saveAutoTradingState(false);
      setBotStatusMessage(
        `TARGET ACHIEVED: Take profit target of +$${userTp.toFixed(2)} reached (Session P&L: +$${sessionPnl.toFixed(2)})! Bot stopped.`
      );
      return true;
    }

    if (!isNaN(userSl) && userSl > 0 && sessionPnl <= -userSl) {
      setIsAutoTrading(false);
      isAutoTradingRef.current = false;
      autoRecoveryStorage.saveAutoTradingState(false);
      setBotStatusMessage(
        `RISK GUARD: Stop loss threshold of -$${userSl.toFixed(2)} reached (Session P&L: -$${Math.abs(sessionPnl).toFixed(2)})! Capital preserved. Bot stopped.`
      );
      return true;
    }

    return false;
  }, [computeRealCumulativePnl]);

  // Compute exact Unix second when a running trade must settle:
  // Under SMC Break of Structure / CHoCH, contracts settle when the candle timer reaches 59s (:59),
  // preventing multi-second drift caused by API execution latency:
  // - Entry right after candle close (secInCandle <= 25): settles at THIS candle's :59s (candleEpoch + 59)
  // - Immediate loss re-entry at :59s (secInCandle >= 55): settles at NEXT candle's :59s (candleEpoch + 119)
  const getTradeTargetSettleSec = useCallback((t: TradeRecord): number => {
    const pMs = t.purchaseTime && t.purchaseTime > 0 ? t.purchaseTime : Date.now();
    const pSec = Math.floor(pMs / 1000);
    if (selectedStrategyRef.current.id === 'smc_structure_confluence') {
      const secInCandle = pSec % 60;
      const candleEpoch = pSec - secInCandle;
      if (secInCandle >= 55) return candleEpoch + 119;
      if (secInCandle <= 25) return candleEpoch + 59;
    }
    return pSec + 59;
  }, []);

  // Execute trade logic (Direct Deriv WebSocket flow with /api/trade and client-side fallback)
  const executeTrade = useCallback(
    async (
      contractTypeToTrade?: 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD',
      overrideStake?: number,
      associatedStructureId?: string,
      overrideSymbol?: string,
      overrideSymbolName?: string
    ) => {
      if (isAutoTradingRef.current && checkTakeProfitAndStopLoss(tradeRecordsRef.current)) {
        return;
      }
      const isIndiv = individualMultiMarketEnabledRef.current;
      const targetSymbol = overrideSymbol || paramsRef.current.symbol;

      // STRICT POST-MARTINGALE LOCK GUARD:
      // If the system is currently locked to a market during an active, incomplete Post-Martingale cycle,
      // all other markets are strictly blocked from executing any trade until the cycle completes or wins!
      if (recoveryLockedMarketRef.current && !isPausedAwaitingSignalRef.current) {
        const lockedSym = recoveryLockedMarketRef.current.symbol;
        if (targetSymbol !== lockedSym) {
          console.warn(
            `[Post-Martingale Lock Enforced]: Trade attempt on ${targetSymbol} blocked. Bot is strictly locked to ${lockedSym} until post-martingale completes.`
          );
          return;
        }
      }

      // Mandatory Concurrency & Pre-Settlement Guarantee:
      // Every trade MUST be settled before any new trade is executed on that market (or globally).
      // There must never be any vacancies of running trades accumulating in history.
      const isContinuous = selectedStrategyRef.current.id === 'continuous_trade';
      const nowSecGuard = Math.floor(Date.now() / 1000);

      // 1. Check if targetSymbol has an existing open trade:
      const existingOpenForTarget =
        activeTradesRef.current.get(targetSymbol) ||
        tradeRecordsRef.current.find((t) => t.symbol === targetSymbol && t.status === 'open');

      if (existingOpenForTarget && existingOpenForTarget.status === 'open') {
        if (nowSecGuard >= getTradeTargetSettleSec(existingOpenForTarget)) {
          // Reached candle :59s settlement target: settle before next trade is placed!
          settleOpenTrade(existingOpenForTarget);
        } else {
          // Trade is still actively running: strictly block duplicate execution!
          return;
        }
      }

      if (executingMarketsRef.current.has(targetSymbol)) {
        return;
      }

      if (isIndiv) {
        // Enforce user-configured "Trade at a time" limit
        const maxConcurrent = Math.max(1, paramsRef.current.maxConcurrentTrades || 1);
        const currentActiveCount = activeTradesRef.current.size + executingMarketsRef.current.size;
        if (!isContinuous && currentActiveCount >= maxConcurrent) {
          return;
        }

        // Martingale cycle reservation: if another market has an active, unpaused immediate Next-Candle Martingale cycle,
        // do not allow a base trade to preempt that slot.
        // BUT if targetSymbol itself is in Martingale recovery (currentMartingaleStep > 0), it is a recovery trade and MUST NOT be blocked!
        const pauseLimit = Math.max(1, paramsRef.current.pauseLossThreshold ?? 2);
        const targetMState = marketMartingaleStatesRef.current[targetSymbol];
        const isTargetRecovering = Boolean(targetMState && (targetMState.currentMartingaleStep > 0 || (targetMState.cycleLossCount || 0) > 0));

        const activeNextCandleMartingaleSyms = new Set(
          Object.values(marketMartingaleStatesRef.current)
            .filter((m) => m && (m.currentMartingaleStep > 0 || (m.cycleLossCount || 0) > 0) && !m.isPausedAwaitingSignal && (m.cycleLossCount || 0) < pauseLimit)
            .map((m) => m.symbol)
        );
        const unfulfilledMartingales = Array.from(activeNextCandleMartingaleSyms).filter(
          (s) => !activeTradesRef.current.has(s) && !executingMarketsRef.current.has(s)
        ).length;
        if (!isContinuous && !activeNextCandleMartingaleSyms.has(targetSymbol) && !isTargetRecovering && (currentActiveCount + unfulfilledMartingales) >= maxConcurrent) {
          return;
        }
      } else {
        // In single-market mode or global multi-market: check if ANY trade is running across the system
        const anyOpenTrade =
          activeTradeRef.current ||
          Array.from(activeTradesRef.current.values()).find((t) => t.status === 'open') ||
          tradeRecordsRef.current.find((t) => t.status === 'open');

        if (anyOpenTrade && anyOpenTrade.status === 'open') {
          if (nowSecGuard >= getTradeTargetSettleSec(anyOpenTrade)) {
            settleOpenTrade(anyOpenTrade);
          } else {
            return;
          }
        }

        if (isExecutingTradeRef.current || isTradePendingRef.current) {
          return;
        }
      }

      if (isIndiv) {
        // If this market was paused awaiting signal (or reached pause loss threshold), unpause and reset cycle loss count upon taking this signal!
        const pauseLimit = Math.max(1, paramsRef.current.pauseLossThreshold ?? 2);
        const targetMState = marketMartingaleStatesRef.current[targetSymbol];
        if (targetMState?.isPausedAwaitingSignal || (targetMState && (targetMState.currentMartingaleStep > 0 || (targetMState.cycleLossCount || 0) > 0) && (targetMState.cycleLossCount || 0) >= pauseLimit)) {
          const updated: MarketMartingaleState = {
            ...targetMState,
            isPausedAwaitingSignal: false,
            cycleLossCount: 0,
            updatedAt: Date.now(),
          };
          marketMartingaleStatesRef.current[targetSymbol] = updated;
          setMarketMartingaleStates((prev) => {
            const next = { ...prev, [targetSymbol]: updated };
            autoRecoveryStorage.saveMarketMartingaleStates(next);
            return next;
          });
        }
        if (isPausedAwaitingSignalRef.current) {
          isPausedAwaitingSignalRef.current = false;
          setIsPausedAwaitingSignal(false);
          cycleLossCountRef.current = 0;
          setCycleLossCount(0);
        }
      } else if (isPausedAwaitingSignalRef.current) {
        setIsPausedAwaitingSignal(false);
        isPausedAwaitingSignalRef.current = false;
        pausedFromMarketRef.current = null;
        setCycleLossCount(0);
        cycleLossCountRef.current = 0;
        setRecoveryLockedMarket({ symbol: targetSymbol, symbolName: overrideSymbolName || targetSymbol });
        recoveryLockedMarketRef.current = { symbol: targetSymbol, symbolName: overrideSymbolName || targetSymbol };
      }

      const p = paramsRef.current;
      const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === targetSymbol);
      const targetSymbolName = overrideSymbolName || mDef?.name || p.symbolName;
      let currentStake = typeof overrideStake === 'number'
        ? overrideStake
        : calculateCurrentStake(undefined, undefined, targetSymbol);

      const isHookActive = Boolean(p.virtualHookEnabled) && isInVirtualHookRef.current;
      const isSwitchActive = Boolean(p.virtualSwitchEnabled) && isInVirtualSwitchRef.current;
      const isCountActive = Boolean(p.virtualCountEnabled) && isInVirtualCountRef.current;
      const isVirtualSystemActive = Boolean(p.virtualHookEnabled || p.virtualSwitchEnabled || p.virtualCountEnabled);
      const shouldExecuteVirtual = isVirtualSystemActive && (isHookActive || isSwitchActive || isCountActive);

      // Settlement Correction Guarantee:
      // If there is an active corrected loss pending recovery, guarantee currentStake is at least the recovery stake!
      // ONLY apply if there is an active unrecovered real loss sequence (consecutiveCount > 0)!
      const pendingLossList = (
        (correctedLossItemsRef.current && correctedLossItemsRef.current.length > 0)
          ? correctedLossItemsRef.current
          : (autoRecoveryStorage.loadCorrectedLossItems() || [])
      ).filter((item) => item.status === 'pending_recovery');

      if (pendingLossList.length > 0 && !shouldExecuteVirtual) {
        const records = tradeRecordsRef.current.length > 0 ? tradeRecordsRef.current : autoRecoveryStorage.loadTradeRecords();
        const { totalLoss: cycleLoss } = calculateConsecutiveCycleLoss(records);

        const payoutRate = (p.autoMartingalePayoutPercent || 83) / 100;
        const totalPending = pendingLossList.reduce((acc, curr) => acc + (curr.lossAmount || 0), 0);
        const maxItemRecovery = pendingLossList.reduce((max, item) => Math.max(max, item.recoveryStake || 0), 0);
        const effectiveLoss = Math.max(totalPending, cycleLoss, accumulatedLossRef.current);
        const reqRecovery = Math.max(maxItemRecovery, Math.ceil((effectiveLoss / payoutRate) * 100) / 100);
        if (reqRecovery > currentStake) {
          currentStake = reqRecovery;
        }
      }

      const type = contractTypeToTrade || p.contractType;

      if (shouldExecuteVirtual) {
        const mDefTarget = VOLATILITY_MARKETS.find((m) => m.symbol === targetSymbol);
        const fallbackTargetBase = mDefTarget?.basePrice ?? 100;
        const lastQuote =
          targetSymbol === p.symbol && ticksRef.current.length > 0
            ? ticksRef.current[ticksRef.current.length - 1].quote
            : (marketTicksRef.current[targetSymbol]?.quote ?? fallbackTargetBase);

        const virtualContractId = Math.floor(900000000 + Math.random() * 99999999);
        const virtualStakeVal = p.stake ?? 0.35;
        const payoutRate = 1 + ((p.autoMartingalePayoutPercent ?? 83) / 100);
        const potentialPayout = Number((virtualStakeVal * payoutRate).toFixed(2));

        const virtualPurchaseMs = Date.now();
        const openRecord: TradeRecord = {
          id: `VIRTUAL-${virtualContractId}`,
          contractId: virtualContractId,
          symbol: targetSymbol,
          symbolName: targetSymbolName,
          contractType: type,
          stake: virtualStakeVal,
          payout: potentialPayout,
          profit: 0,
          status: 'open',
          purchaseTime: virtualPurchaseMs,
          entrySpot: lastQuote,
          entryBarrier: lastQuote.toFixed(2),
          barrier: lastQuote.toFixed(2),
          settleTimeRemaining: 59,
          settleTriggered: false,
          isVirtualTrade: true,
        };
        const virtualRem = Math.max(
          0,
          getTradeTargetSettleSec(openRecord) - Math.floor(virtualPurchaseMs / 1000)
        );
        openRecord.settleTimeRemaining = virtualRem;

        if (associatedStructureId) {
          tradedStructureIdsRef.current.add(associatedStructureId);
        }

        activeTradesRef.current.set(targetSymbol, openRecord);
        setActiveTrades(Array.from(activeTradesRef.current.values()));
        activeTradeRef.current = openRecord;
        autoRecoveryStorage.saveActiveTrade(openRecord);
        autoRecoveryStorage.saveActiveTrades(Array.from(activeTradesRef.current.values()));
        tradeRecordsRef.current = [openRecord, ...tradeRecordsRef.current.filter((t) => t.id !== openRecord.id && String(t.contractId) !== String(openRecord.contractId))];
        setTradeRecords((prev) => {
          const updated = [openRecord, ...prev.filter((t) => t.id !== openRecord.id && String(t.contractId) !== String(openRecord.contractId))];
          autoRecoveryStorage.saveTradeRecords(updated);
          return updated;
        });
        setActiveTradeCountdown(virtualRem);
        const isSwitch = isSwitchActive;
        const curBox = currentVirtualSwitchStageRef.current;
        const tag = isSwitch
          ? `[VIRTUAL SWITCH (BOX ${curBox}) TRADE EXECUTED]`
          : isHookActive
          ? `[VIRTUAL HOOK TRADE EXECUTED]`
          : `[VIRTUAL COUNT (Loss ${virtualCountLossesRef.current}/${p.virtualCountThreshold ?? 3}) TRADE EXECUTED]`;
        setBotStatusMessage(
          `${tag}: #${virtualContractId} on ${targetSymbolName} (1-min ${type} @ $${virtualStakeVal.toFixed(2)} [Simulated]). Real capital protected! Settle at :59s (${virtualRem}s)`
        );
        lastTradeDirectionRef.current = (type === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT';
        setIsTradePending(false);
        isTradePendingRef.current = false;
        isExecutingTradeRef.current = false;
        return;
      }

      // Check balance safety for real trades
      if (currentBalanceRef.current > 0 && currentStake > currentBalanceRef.current) {
        setBotStatusMessage('Insufficient balance for current calculated stake.');
        setIsAutoTrading(false);
        isAutoTradingRef.current = false;
        return;
      }

      try {
        executingMarketsRef.current.add(targetSymbol);
        isExecutingTradeRef.current = true;
        setIsTradePending(true);
        isTradePendingRef.current = true;
        setBotStatusMessage(`Executing 1-min ${type} on ${targetSymbolName} ($${currentStake.toFixed(2)}) for next candle open...`);

        const activeSession = sessionAuthRef.current;
        let tokenToUse = activeSession?.token;
        if (!tokenToUse) {
          try {
            const stored = localStorage.getItem('deriv_active_session');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (parsed?.token) {
                tokenToUse = parsed.token;
                sessionAuthRef.current = { token: parsed.token };
              }
            }
          } catch {}
        }
        if (!tokenToUse) {
          tokenToUse = 'DEMO';
        }

        const proposalRequest = {
          proposal: 1,
          amount: currentStake,
          basis: 'stake',
          contract_type: type,
          currency: currency || 'USD',
          duration: 1, // 1-minute candle duration
          duration_unit: 'm',
          symbol: targetSymbol,
        };
        const buyRequest = {
          price: currentStake,
        };

        const isVirtualAccount = Boolean(
          accountRef.current?.isVirtual ||
          account?.isVirtual ||
          tokenToUse.startsWith('DEMO') ||
          (accountRef.current?.loginid && accountRef.current.loginid.startsWith('VRTC'))
        );

        let data: any = null;
        let isTradeSuccess = false;
        let lastTradeErrorMessage = '';

        // 0. Fast-path: execute directly on the live authenticated WebSocket (~250ms, eliminates API reconnect drift)
        if (!tokenToUse.startsWith('DEMO') && !derivWs.getIsSimulated() && derivWs.isConnectedAndAuthorized()) {
          try {
            const wsResult = await derivWs.requestProposalAndBuy({
              symbol: targetSymbol,
              contractType: type,
              amount: currentStake,
              duration: 1,
              durationUnit: 'm',
              currency: currency || 'USD',
              timeoutMs: 2500,
            });
            if (wsResult?.buy?.buy?.contract_id) {
              data = wsResult;
              isTradeSuccess = true;
            }
          } catch (wsErr: any) {
            console.warn('[Fast WS Trade Fallback]:', wsErr?.message);
            if (wsErr?.message) {
              lastTradeErrorMessage = wsErr.message;
            }
          }
        }

        // 1. Secondary attempt: call backend /api/trade with a 3.5s timeout
        if (!isTradeSuccess || !data?.buy?.buy) {
          try {
            const controller = new AbortController();
            const timerId = setTimeout(() => controller.abort(), 3500);
            const res = await fetch('/api/trade', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                token: tokenToUse,
                accountId: accountRef.current?.loginid || account?.loginid || autoRecoveryStorage.loadActiveSession()?.accountId,
                appId: accountRef.current?.appId || appId,
                proposalRequest,
                buyRequest,
                isVirtual: isVirtualAccount,
              }),
            });
            clearTimeout(timerId);

            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              data = await res.json();
              if (res.ok && data?.buy?.buy) {
                isTradeSuccess = true;
              } else if (!res.ok) {
                lastTradeErrorMessage = data?.error || '';
                console.warn('[Trade Endpoint Warning]:', data?.error);
              }
            } else {
              const rawText = await res.text();
              console.warn(`[Trade Endpoint Non-JSON ${res.status}]:`, rawText.slice(0, 150));
            }
          } catch (fetchErr: any) {
            console.warn('[Trade Endpoint Fetch Exception]:', fetchErr?.message);
            lastTradeErrorMessage = fetchErr?.message || '';
          }
        }

        // 2. Client-side direct broker execution fallback:
        // When running on Vercel/cloud or if /api/trade returned an error, execute directly against Deriv gateways
        if (!isTradeSuccess || !data?.buy?.buy) {
          if (!isVirtualAccount && tokenToUse && !tokenToUse.startsWith('DEMO')) {
            try {
              setBotStatusMessage(`Placing real trade via direct Deriv broker gateway on ${targetSymbolName}...`);
              const directBrokerResult = await executeBrokerTradeDirectly({
                token: tokenToUse,
                accountId: accountRef.current?.loginid || account?.loginid || autoRecoveryStorage.loadActiveSession()?.accountId || '',
                appId: accountRef.current?.appId || appId || '33IM5dIMuFaBupAhk042L',
                symbol: targetSymbol,
                contractType: type,
                stake: currentStake,
                currency: currency || 'USD',
                duration: 1,
                durationUnit: 'm',
              });
              if (directBrokerResult?.buy?.buy?.contract_id) {
                data = directBrokerResult;
                isTradeSuccess = true;
              }
            } catch (directErr: any) {
              console.warn('[Direct Broker Trade Exception]:', directErr?.message);
              if (directErr?.message) {
                lastTradeErrorMessage = directErr.message;
              }
            }
          }
        }

        // 3. Fallback evaluation
        if (!isTradeSuccess || !data?.buy?.buy) {
          if (isVirtualAccount) {
            // Smooth simulation fallback for Demo accounts
            const simContractId = Math.floor(100000000 + Math.random() * 900000000);
            const simPayout = Number((currentStake * 1.95).toFixed(2));
            data = {
              proposal: {
                proposal: {
                  id: `demo_prop_${simContractId}`,
                  ask_price: currentStake,
                  payout: simPayout,
                },
              },
              buy: {
                buy: {
                  balance_after: Math.max(0, Number((currentBalanceRef.current - currentStake).toFixed(2))),
                  buy_price: currentStake,
                  contract_id: simContractId,
                  payout: simPayout,
                  purchase_time: Math.floor(Date.now() / 1000),
                  shortcode: `DEMO_${simContractId}`,
                  transaction_id: simContractId,
                },
              },
            };
          } else {
            throw new Error(
              lastTradeErrorMessage ||
                data?.error ||
                'Trade order could not be placed. Please check network connection or broker status.'
            );
          }
        }

        const buyData = data.buy?.buy || {};
        const proposalData = data.proposal?.proposal || {};
        const contractId = buyData.contract_id || Math.floor(100000000 + Math.random() * 900000000);
        const purchasePrice = Number(buyData.buy_price || currentStake);
        const potentialPayout = Number(buyData.payout || proposalData.payout || (currentStake * 1.95));
        const mDefTarget = VOLATILITY_MARKETS.find((m) => m.symbol === targetSymbol);
        const fallbackTargetBase = mDefTarget?.basePrice ?? 100;
        const lastQuote =
          targetSymbol === p.symbol && ticksRef.current.length > 0
            ? ticksRef.current[ticksRef.current.length - 1].quote
            : (marketTicksRef.current[targetSymbol]?.quote ?? fallbackTargetBase);

        if (typeof buyData.balance_after === 'number') {
          setCurrentBalance(buyData.balance_after);
        } else if (buyData.balance_after !== undefined && !isNaN(Number(buyData.balance_after))) {
          setCurrentBalance(Number(buyData.balance_after));
        } else {
          setCurrentBalance((prev) => Math.max(0, Number(((Number(prev) || 0) - purchasePrice).toFixed(2))));
        }

        // Register structure ID as officially traded on successful placement
        if (associatedStructureId) {
          tradedStructureIdsRef.current.add(associatedStructureId);
        }

        const purchaseMs = Date.now();
        const openRecord: TradeRecord = {
          id: String(contractId),
          contractId,
          symbol: targetSymbol,
          symbolName: targetSymbolName,
          contractType: type,
          stake: purchasePrice,
          payout: potentialPayout,
          profit: 0,
          status: 'open',
          purchaseTime: purchaseMs,
          entrySpot: lastQuote,
          entryBarrier: lastQuote.toFixed(2),
          barrier: lastQuote.toFixed(2),
          settleTimeRemaining: 59,
          settleTriggered: false,
          isVirtualTrade: false,
        };
        const initialRemaining = Math.max(
          0,
          getTradeTargetSettleSec(openRecord) - Math.floor(purchaseMs / 1000)
        );
        openRecord.settleTimeRemaining = initialRemaining;

        activeTradesRef.current.set(targetSymbol, openRecord);
        setActiveTrades(Array.from(activeTradesRef.current.values()));
        activeTradeRef.current = openRecord;
        autoRecoveryStorage.saveActiveTrade(openRecord);
        autoRecoveryStorage.saveActiveTrades(Array.from(activeTradesRef.current.values()));
        tradeRecordsRef.current = [openRecord, ...tradeRecordsRef.current.filter((t) => t.id !== openRecord.id && String(t.contractId) !== String(openRecord.contractId))];
        setTradeRecords((prev) => {
          const updated = [openRecord, ...prev.filter((t) => t.id !== openRecord.id && String(t.contractId) !== String(openRecord.contractId))];
          autoRecoveryStorage.saveTradeRecords(updated);
          return updated;
        });

        // Subscribe after openRecord is registered so live packets always match isOurTrade
        derivWs.subscribeProposalOpenContract(contractId);

        setActiveTradeCountdown(initialRemaining);
        setBotStatusMessage(`[TRADE EXECUTED]: #${contractId} on ${targetSymbolName} (1-min ${type} @ $${purchasePrice.toFixed(2)}). Settle at :59s (${initialRemaining}s)`);

        lastTradeDirectionRef.current = (type === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT';
        // If system was paused waiting for a fresh signal, executing this new signal resumes active trading
        if (isPausedAwaitingSignalRef.current) {
          isPausedAwaitingSignalRef.current = false;
          setIsPausedAwaitingSignal(false);
          cycleLossCountRef.current = 0;
          setCycleLossCount(0);
          pausedFromMarketRef.current = null;
        }

        // Fetch official entry barrier from Deriv backend
        (async () => {
          try {
            const detailsRes = await fetch('/api/contract/details', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: tokenToUse,
                contractId,
                accountId: accountRef.current?.loginid || account?.loginid,
                appId: accountRef.current?.appId || appId,
              }),
            });
            if (detailsRes.ok) {
              const contractDetails = await detailsRes.json();
              const entry = contractDetails.entry_spot ? Number(contractDetails.entry_spot) : undefined;
              const barrier = contractDetails.barrier || (entry !== undefined ? String(entry) : undefined);
              const returnedSymbol = contractDetails.symbol || targetSymbol;
              const mDefTrade = VOLATILITY_MARKETS.find((m) => m.symbol === returnedSymbol);
              const returnedSymbolName = contractDetails.display_name || mDefTrade?.name || targetSymbolName;

              if (activeTradeRef.current && activeTradeRef.current.contractId === contractId) {
                activeTradeRef.current = {
                  ...activeTradeRef.current,
                  symbol: activeTradeRef.current.symbol || returnedSymbol,
                  symbolName: activeTradeRef.current.symbolName || returnedSymbolName,
                  entrySpot: entry ?? activeTradeRef.current.entrySpot,
                  entryBarrier: barrier ?? activeTradeRef.current.entryBarrier,
                  barrier: barrier ?? activeTradeRef.current.barrier,
                };
              }
              setTradeRecords((prev) =>
                prev.map((t) =>
                  t.contractId === contractId
                    ? {
                        ...t,
                        symbol: t.symbol || returnedSymbol,
                        symbolName: t.symbolName || returnedSymbolName,
                        entrySpot: entry ?? t.entrySpot,
                        entryBarrier: barrier ?? t.entryBarrier,
                        barrier: barrier ?? t.barrier,
                      }
                    : t
                )
              );
            }
          } catch (fetchErr) {
            console.warn('Initial contract barrier fetch error:', fetchErr);
          }
        })();
      } catch (err: any) {
        setBotStatusMessage(`Trade order error: ${err.message || 'Failed to submit trade'}`);
      } finally {
        executingMarketsRef.current.delete(targetSymbol);
        setIsTradePending(false);
        isTradePendingRef.current = false;
        isExecutingTradeRef.current = false;
      }
    },
    [calculateCurrentStake, account, currency, appId, executeBrokerTradeDirectly, getTradeTargetSettleSec]
  );

  // Handle completed trade result (from 59s settlement or broker update)
  const handleTradeCompleted = useCallback(
    (finishedTrade: TradeRecord) => {
      const p = paramsRef.current;
      const contractId = Number(finishedTrade.contractId);

      const buildSnapshotWithRecord = (base: TradeRecord[], rec: TradeRecord): TradeRecord[] => {
        const cid = Number(rec.contractId);
        const idx = base.findIndex((t) => (rec.id && t.id === rec.id) || (cid && Number(t.contractId) === cid));
        if (idx >= 0) {
          const copy = [...base];
          copy[idx] = { ...copy[idx], ...rec };
          return copy;
        }
        return [rec, ...base];
      };

      // Prevent duplicate processing of the same finished contract
      if (handledContractIdsRef.current.has(contractId) || settledContractOutcomesRef.current.has(contractId)) {
        const existingOutcome = settledContractOutcomesRef.current.get(contractId);

        // CASE 1: Deriv confirms LOSS, but local settling marked as WON!
        // (Due to ~1s difference in exit spot, Deriv settled as a loss)
        if (existingOutcome === 'won' && finishedTrade.status === 'lost') {
          settledContractOutcomesRef.current.set(contractId, 'lost');

          const lossStake = Number(finishedTrade.stake || p.stake);
          const correctedLossRecord: TradeRecord = {
            ...finishedTrade,
            contractId,
            status: 'lost',
            profit: -lossStake,
            payout: 0,
          };
          const case1Snapshot = buildSnapshotWithRecord(tradeRecordsRef.current, correctedLossRecord);

          // 1. Correct that particular contract to a loss in trade records
          let allRecordsAfterCorrection: TradeRecord[] = [];
          setTradeRecords((prev) => {
            const existingIdx = prev.findIndex((t) => Number(t.contractId) === contractId);
            if (existingIdx >= 0) {
              const original = prev[existingIdx];
              const recordIsVirtual = isTradeRecordVirtual(original) || isTradeRecordVirtual(finishedTrade);
              const finalId = original.id && original.id.startsWith('VIRTUAL-')
                ? original.id
                : (recordIsVirtual ? `VIRTUAL-${contractId}` : (correctedLossRecord.id || String(contractId)));
              const updated = [...prev];
              updated[existingIdx] = {
                ...updated[existingIdx],
                ...correctedLossRecord,
                id: finalId,
                isVirtualTrade: recordIsVirtual,
                status: 'lost',
                profit: -lossStake,
                payout: 0,
              };
              allRecordsAfterCorrection = updated;
              autoRecoveryStorage.saveTradeRecords(updated);
              return updated;
            }
            allRecordsAfterCorrection = prev;
            return prev;
          });

          // 2. Reverse credited win on virtual simulation accounts (skip if trade was virtual)
          if (!isTradeRecordVirtual(finishedTrade) && account?.isVirtual) {
            const safeStake = Number(lossStake) || Number(finishedTrade.stake) || 0;
            const previousCreditedPayout = Number(finishedTrade.payout) > 0
              ? Number(finishedTrade.payout)
              : Number((safeStake * 1.83).toFixed(2));
            setCurrentBalance((prev) => Math.max(0, Number(((Number(prev) || 0) - previousCreditedPayout).toFixed(2))));
          } else if (!isTradeRecordVirtual(finishedTrade)) {
            // Real account: fetch latest official balance from Deriv WebSocket
            derivWs.subscribeBalance();
          }

          // 3. Calculate consecutive cycle loss (real-only for monetary recovery) + Post-Martingale loss count (ALL losses: virtual + real)
          const recordsToScan = allRecordsAfterCorrection.length > 0 ? allRecordsAfterCorrection : tradeRecordsRef.current;
          const { totalLoss: cycleLossTotal, consecutiveCount } = calculateConsecutiveCycleLoss(
            recordsToScan,
            contractId
          );
          const savedPreWin = preWinPhaseStateRef.current.get(contractId);
          const allConsecCount = calculateConsecutiveLossesAll(recordsToScan, contractId);
          const case1PhaseLossCount = savedPreWin
            ? savedPreWin.cycleLossCount + 1
            : Math.max(consecutiveCount, allConsecCount);

          const finalAccumulatedLoss = Math.max(lossStake, cycleLossTotal);
          const nextStep = Math.max(consecutiveCount, currentMartingaleStepRef.current + 1);

          setCurrentMartingaleStep(nextStep);
          currentMartingaleStepRef.current = nextStep;
          setAccumulatedLoss(finalAccumulatedLoss);
          accumulatedLossRef.current = finalAccumulatedLoss;
          setCycleLossCount(case1PhaseLossCount);
          cycleLossCountRef.current = case1PhaseLossCount;

          if (p.virtualCountEnabled && !isTradeRecordVirtual(finishedTrade)) {
            // Deriv confirmed this REAL trade LOST (reversing local win); stay on Real Account until a real win occurs
            setIsInVirtualCount(false);
            isInVirtualCountRef.current = false;
            const restoredVLosses = savedPreWin ? savedPreWin.virtualCountLosses : virtualCountLossesRef.current;
            setVirtualCountLosses(restoredVLosses);
            virtualCountLossesRef.current = restoredVLosses;
          }

          if (p.inInterModeEnabled && !isTradeRecordVirtual(finishedTrade) && savedPreWin) {
            const switchThreshold = Math.max(1, p.consecutivesToSwitchMode || 3);
            const modes = Array.isArray(p.modesConfig) && p.modesConfig.length === 10
              ? p.modesConfig
              : DEFAULT_IN_INTER_MODES;
            const prevMode = savedPreWin.currentMode || 0;
            const prevDefaultLoss = savedPreWin.defaultModeLossCount || 0;
            const prevInModeLoss = savedPreWin.inModeLossCount || 0;
            const prevSeqLoss = Math.max(savedPreWin.modeAccumulatedLoss || 0, finalAccumulatedLoss);
            if (prevMode === 0) {
              const nextDef = prevDefaultLoss + 1;
              if (nextDef >= switchThreshold) {
                const m1First = roundInInterStake(p.stake * (modes[0]?.interModeMartingale || 1.5));
                setCurrentMode(1);
                currentModeRef.current = 1;
                setDefaultModeLossCount(0);
                defaultModeLossCountRef.current = 0;
                setInModeLossCount(0);
                inModeLossCountRef.current = 0;
                setModeFirstStake(m1First);
                modeFirstStakeRef.current = m1First;
                setModeAccumulatedLoss(prevSeqLoss);
                modeAccumulatedLossRef.current = prevSeqLoss;
              } else {
                setCurrentMode(0);
                currentModeRef.current = 0;
                setDefaultModeLossCount(nextDef);
                defaultModeLossCountRef.current = nextDef;
                setModeAccumulatedLoss(prevSeqLoss);
                modeAccumulatedLossRef.current = prevSeqLoss;
              }
            } else {
              const nextInMode = prevInModeLoss + 1;
              const prevFirst = savedPreWin.modeFirstStake > 0
                ? savedPreWin.modeFirstStake
                : roundInInterStake(p.stake * (modes[0]?.interModeMartingale || 1.5));
              if (nextInMode >= switchThreshold && prevMode < 10) {
                const nextM = prevMode + 1;
                const nextFirst = roundInInterStake(prevFirst * (modes[nextM - 1]?.interModeMartingale || 1.5));
                setCurrentMode(nextM);
                currentModeRef.current = nextM;
                setInModeLossCount(0);
                inModeLossCountRef.current = 0;
                setModeFirstStake(nextFirst);
                modeFirstStakeRef.current = nextFirst;
              } else {
                setCurrentMode(prevMode);
                currentModeRef.current = prevMode;
                setInModeLossCount(nextInMode);
                inModeLossCountRef.current = nextInMode;
                setModeFirstStake(prevFirst);
                modeFirstStakeRef.current = prevFirst;
              }
              setModeAccumulatedLoss(prevSeqLoss);
              modeAccumulatedLossRef.current = prevSeqLoss;
            }
          }

          const maxMartingaleLimit = Math.max(1, p.maxMultiplier || 5);
          const maxAction = p.maxMartingaleAction || 'stop';

          if (nextStep >= maxMartingaleLimit) {
            if (maxAction === 'stop') {
              setIsAutoTrading(false);
              isAutoTradingRef.current = false;
              autoRecoveryStorage.saveAutoTradingState(false);
              setRecoveryLockedMarket(null);
              recoveryLockedMarketRef.current = null;
              setIsPausedAwaitingSignal(false);
              isPausedAwaitingSignalRef.current = false;

              autoRecoveryStorage.saveMartingaleState({
                currentMartingaleStep: nextStep,
                cycleLossCount: case1PhaseLossCount,
                isPausedAwaitingSignal: false,
                recoveryLockedMarket: null,
                startingBalance: startingBalanceRef.current,
                accumulatedLoss: finalAccumulatedLoss,
                currentPhase: savedPreWin ? savedPreWin.currentPhase : currentPhaseRef.current,
              });

              setBotStatusMessage(
                `[Max Martingale Reached (${nextStep}/${maxMartingaleLimit} Losses)]: Reached ${maxMartingaleLimit} consecutive martingale losses (-$${finalAccumulatedLoss.toFixed(2)} total loss). Auto-trading STOPPED as configured for capital protection.`
              );
              checkTakeProfitAndStopLoss(case1Snapshot);
              return;
            } else {
              // Reset to default stake!
              setCurrentMartingaleStep(0);
              currentMartingaleStepRef.current = 0;
              setAccumulatedLoss(0);
              accumulatedLossRef.current = 0;
              setCycleLossCount(0);
              cycleLossCountRef.current = 0;
              setRecoveryLockedMarket(null);
              recoveryLockedMarketRef.current = null;
              autoRecoveryStorage.clearCorrectedLossItems();
              setCorrectedLossItems([]);

              autoRecoveryStorage.saveMartingaleState({
                currentMartingaleStep: 0,
                cycleLossCount: 0,
                isPausedAwaitingSignal: false,
                recoveryLockedMarket: null,
                startingBalance: startingBalanceRef.current,
                accumulatedLoss: 0,
                currentPhase: 1,
              });

              setBotStatusMessage(
                `[Max Martingale Reached (${nextStep}/${maxMartingaleLimit} Losses)]: Reached ${maxMartingaleLimit} consecutive martingale losses. RESET to default stake ($${p.stake.toFixed(2)}) as configured. Bot continuing trading at base stake.`
              );
              checkTakeProfitAndStopLoss(case1Snapshot);
              return;
            }
          }

          const targetSymbol = finishedTrade.symbol || p.symbol;
          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === targetSymbol);
          const symName = finishedTrade.symbolName || mDef?.name || targetSymbol;

          // Do NOT lock the volatility: let all volatilities remain free so the system can analyze other markets!
          setRecoveryLockedMarket(null);
          recoveryLockedMarketRef.current = null;

          const isPauseActiveCase1 = p.pauseTradeEnabled !== false;
          const pauseLimitCase1 = Math.max(1, p.pauseLossThreshold ?? 2);
          const shouldPauseCase1 = isPauseActiveCase1 && case1PhaseLossCount >= pauseLimitCase1;
          const basePhaseCase1 = savedPreWin ? savedPreWin.currentPhase : (currentPhaseRef.current || 1);

          const nowSecCase1 = Math.floor(Date.now() / 1000);
          const secondInCandleCase1 = nowSecCase1 % 60;
          const wallCandleEpochCase1 = nowSecCase1 - secondInCandleCase1;
          const lossSymCandlesCase1 = targetSymbol === p.symbol ? candlesRef.current : marketCandlesRef.current[targetSymbol];
          const latestCandleEpochCase1 = lossSymCandlesCase1 && lossSymCandlesCase1.length > 0
            ? lossSymCandlesCase1[lossSymCandlesCase1.length - 1].epoch
            : wallCandleEpochCase1;
          const effectiveSettleEpochCase1 = Math.max(latestCandleEpochCase1, wallCandleEpochCase1);
          const nextFreshEpochCase1 = secondInCandleCase1 <= 5 ? effectiveSettleEpochCase1 : effectiveSettleEpochCase1 + 60;

          if (shouldPauseCase1) {
            const nextPhaseCase1 = basePhaseCase1 + 1;
            setCurrentPhase(nextPhaseCase1);
            currentPhaseRef.current = nextPhaseCase1;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setIsPausedAwaitingSignal(true);
            isPausedAwaitingSignalRef.current = true;
            minNextSignalCandleEpochRef.current = nextFreshEpochCase1;
            marketMinNextSignalCandleEpochRef.current[targetSymbol] = nextFreshEpochCase1;
            pendingStructureBreakRef.current = null;
            marketPendingBreaksRef.current = {};

            if (latestSmcResultRef.current?.structures) {
              latestSmcResultRef.current.structures.forEach((s) => {
                if (s.breakTime < nextFreshEpochCase1) tradedStructureIdsRef.current.add(s.id);
              });
            }
            Object.keys(marketSmcRef.current).forEach((sym) => {
              const smc = marketSmcRef.current[sym];
              if (smc?.structures) {
                smc.structures.forEach((s) => {
                  if (s.breakTime < nextFreshEpochCase1) tradedStructureIdsRef.current.add(s.id);
                });
              }
              const q = sym === p.symbol && ticksRef.current.length > 0
                ? ticksRef.current[ticksRef.current.length - 1].quote
                : marketTicksRef.current[sym]?.quote;
              if (smc && q !== undefined && q !== null) {
                if (smc.activeSwingHigh && q >= smc.activeSwingHigh.price) {
                  tradedStructureIdsRef.current.add(`${sym}-swing-high-${smc.activeSwingHigh.time}-${smc.activeSwingHigh.price.toFixed(4)}`);
                  tradedStructureIdsRef.current.add(`live-break-high-${sym}-${smc.activeSwingHigh.time}-${smc.activeSwingHigh.price.toFixed(4)}`);
                }
                if (smc.activeSwingLow && q <= smc.activeSwingLow.price) {
                  tradedStructureIdsRef.current.add(`${sym}-swing-low-${smc.activeSwingLow.time}-${smc.activeSwingLow.price.toFixed(4)}`);
                  tradedStructureIdsRef.current.add(`live-break-low-${sym}-${smc.activeSwingLow.time}-${smc.activeSwingLow.price.toFixed(4)}`);
                }
              }
            });
          } else {
            setCurrentPhase(basePhaseCase1);
            currentPhaseRef.current = basePhaseCase1;
          }

          const payoutRate = (p.autoMartingalePayoutPercent || 83) / 100;
          const nextRecoveryStake = Math.max(
            Math.ceil((finalAccumulatedLoss / payoutRate) * 100) / 100,
            calculateCurrentStake(nextStep, finalAccumulatedLoss)
          );

          if (individualMultiMarketEnabledRef.current) {
            const prevTargetM = marketMartingaleStatesRef.current[targetSymbol] || {
              symbol: targetSymbol,
              currentMartingaleStep: 0,
              accumulatedLoss: 0,
              cycleLossCount: 0,
              isPausedAwaitingSignal: false,
            };
            const updatedTargetM: MarketMartingaleState = {
              ...prevTargetM,
              currentMartingaleStep: nextStep,
              accumulatedLoss: finalAccumulatedLoss,
              cycleLossCount: shouldPauseCase1 ? 0 : case1PhaseLossCount,
              isPausedAwaitingSignal: shouldPauseCase1,
              updatedAt: Date.now(),
            };
            marketMartingaleStatesRef.current[targetSymbol] = updatedTargetM;
            setMarketMartingaleStates((prev) => {
              const updated = { ...prev, [targetSymbol]: updatedTargetM };
              autoRecoveryStorage.saveMarketMartingaleStates(updated);
              return updated;
            });
          }

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: nextStep,
            cycleLossCount: shouldPauseCase1 ? 0 : case1PhaseLossCount,
            isPausedAwaitingSignal: shouldPauseCase1,
            recoveryLockedMarket: null,
            startingBalance: startingBalanceRef.current,
            accumulatedLoss: finalAccumulatedLoss,
            currentPhase: currentPhaseRef.current,
            isInVirtualCount: p.virtualCountEnabled && !isTradeRecordVirtual(finishedTrade) ? false : isInVirtualCountRef.current,
            virtualCountLosses: p.virtualCountEnabled && !isTradeRecordVirtual(finishedTrade) ? virtualCountLossesRef.current : virtualCountLossesRef.current,
          });

          // 4. File this corrected trade in our Corrected Loss Alert Counter Box with full cycle loss!
          const newCorrectedItem: CorrectedLossItem = {
            id: `corrected-${contractId}-${Date.now()}`,
            contractId,
            symbol: targetSymbol,
            symbolName: symName,
            lossAmount: finalAccumulatedLoss,
            entryBarrier: finishedTrade.entryBarrier,
            exitBarrier: finishedTrade.exitBarrier,
            localSettledOutcome: 'won',
            derivConfirmedOutcome: 'lost',
            timestamp: Date.now(),
            status: 'pending_recovery',
            recoveryStep: nextStep,
            recoveryStake: nextRecoveryStake,
          };

          setCorrectedLossItems((prev) => {
            const filtered = prev.filter((item) => item.contractId !== contractId);
            const updated = [newCorrectedItem, ...filtered];
            autoRecoveryStorage.saveCorrectedLossItems(updated);
            correctedLossItemsRef.current = updated;
            return updated;
          });

          const nextRealLoss = realConsecutiveLossesRef.current + 1;
          setRealConsecutiveLosses(nextRealLoss);
          realConsecutiveLossesRef.current = nextRealLoss;

          const vHookEnabled = Boolean(p.virtualHookEnabled);
          const vThreshold = Math.max(1, p.virtualHookLossThreshold || 1);
          let hookEngaged = false;
          if (vHookEnabled && nextRealLoss >= vThreshold) {
            hookEngaged = true;
            setIsInVirtualHook(true);
            isInVirtualHookRef.current = true;
            setVirtualHookLossCount(0);
            virtualHookLossCountRef.current = 0;
          }

          let switchEngaged = false;
          let curBox = currentVirtualSwitchStageRef.current;
          if (p.virtualSwitchEnabled) {
            const activeBoxes = Array.isArray(p.virtualSwitchBoxes) && p.virtualSwitchBoxes.length > 0
              ? [...p.virtualSwitchBoxes].sort((a, b) => a - b)
              : [1, 2, 3];
            if (!activeBoxes.includes(curBox)) {
              curBox = activeBoxes[0];
              setCurrentVirtualSwitchStage(curBox);
              currentVirtualSwitchStageRef.current = curBox;
            }
            if (nextRealLoss >= curBox) {
              switchEngaged = true;
              setIsInVirtualSwitch(true);
              isInVirtualSwitchRef.current = true;
              setVirtualSwitchLossCount(0);
              virtualSwitchLossCountRef.current = 0;
            }
          }

          const isHookActive = Boolean(p.virtualHookEnabled) && isInVirtualHookRef.current;
          const isSwitchActive = Boolean(p.virtualSwitchEnabled) && isInVirtualSwitchRef.current;
          if (hookEngaged || switchEngaged || isHookActive || isSwitchActive) {
            pendingStructureBreakRef.current = null;
            marketPendingBreaksRef.current = {};
            const nowSec = Math.floor(Date.now() / 1000);
            const secondInCandle = nowSec % 60;
            const settleCandleEpoch = nowSec - secondInCandle;
            if (selectedStrategyRef.current.id !== 'continuous_trade') {
              lastExecutedCandleEpochRef.current = settleCandleEpoch;
              minNextSignalCandleEpochRef.current = settleCandleEpoch + 60;
            } else {
              minNextSignalCandleEpochRef.current = 0;
            }

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: nextStep,
              cycleLossCount: consecutiveCount,
              isPausedAwaitingSignal: false,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: finalAccumulatedLoss,
              currentPhase: currentPhaseRef.current,
              isInVirtualHook: isInVirtualHookRef.current,
              virtualHookLossCount: 0,
              isInVirtualSwitch: isInVirtualSwitchRef.current,
              virtualSwitchLossCount: 0,
              realConsecutiveLosses: nextRealLoss,
              currentVirtualSwitchStage: curBox,
            });

            const modeName = switchEngaged || isInVirtualSwitchRef.current
              ? `VIRTUAL SWITCH (BOX ${curBox})`
              : 'VIRTUAL HOOK';
            setBotStatusMessage(
              `[Deriv Official Correction]: Contract #${contractId} confirmed as LOSS by Deriv. Hit ${nextRealLoss} consecutive real loss(es). Switched to ${modeName} to protect real capital! Next trades will execute in virtual until 1 Virtual Win occurs.`
            );
            checkTakeProfitAndStopLoss(case1Snapshot);
            return;
          }

          const cycleNote = consecutiveCount > 1 ? ` (${consecutiveCount} consecutive losses joined: $${finalAccumulatedLoss.toFixed(2)})` : '';
          setBotStatusMessage(
            `[Deriv Official Correction]: Contract #${contractId} confirmed as LOSS by Deriv exit barrier. Updated to LOSS${cycleNote}. Martingale Step ${nextStep} ($${nextRecoveryStake.toFixed(2)} at 83% payout) armed for NEXT signal to recover full loss!`
          );
          checkTakeProfitAndStopLoss(case1Snapshot);
          return;
        }

        // CASE 2: Deriv confirms WIN, but previously marked as lost:
        if (existingOutcome === 'lost' && (finishedTrade.status === 'won' || (finishedTrade.profit ?? 0) > 0)) {
          settledContractOutcomesRef.current.set(contractId, 'won');
          const safePayout = Number(finishedTrade.payout) || 0;
          const safeStake = Number(finishedTrade.stake) || 0;
          const positiveProfit = typeof finishedTrade.profit === 'number' && finishedTrade.profit > 0
            ? finishedTrade.profit
            : Number(Math.max(0, safePayout - safeStake).toFixed(2));
          const case2Snapshot = buildSnapshotWithRecord(tradeRecordsRef.current, {
            ...finishedTrade,
            contractId,
            status: 'won',
            profit: positiveProfit,
            payout: safePayout,
            stake: safeStake,
          });

          // Since Deriv confirmed it WON, this was NOT a real loss!
          // Reset real consecutive losses to 0 and ensure both Virtual Hook and Virtual Switch are OFF!
          setRealConsecutiveLosses(0);
          realConsecutiveLossesRef.current = 0;
          setIsInVirtualHook(false);
          isInVirtualHookRef.current = false;
          setVirtualHookLossCount(0);
          virtualHookLossCountRef.current = 0;
          setIsInVirtualSwitch(false);
          isInVirtualSwitchRef.current = false;
          setVirtualSwitchLossCount(0);
          virtualSwitchLossCountRef.current = 0;

          setTradeRecords((prev) => {
            const existingIdx = prev.findIndex((t) => Number(t.contractId) === contractId);
            if (existingIdx >= 0) {
              const original = prev[existingIdx];
              const recordIsVirtual = isTradeRecordVirtual(original) || isTradeRecordVirtual(finishedTrade);
              const finalId = original.id && original.id.startsWith('VIRTUAL-')
                ? original.id
                : (recordIsVirtual ? `VIRTUAL-${contractId}` : (finishedTrade.id || String(contractId)));
              const updated = [...prev];
              updated[existingIdx] = {
                ...updated[existingIdx],
                ...finishedTrade,
                id: finalId,
                isVirtualTrade: recordIsVirtual,
                contractId,
                status: 'won',
                profit: positiveProfit,
                payout: safePayout,
                stake: safeStake,
              };
              autoRecoveryStorage.saveTradeRecords(updated);
              return updated;
            }
            return prev;
          });

          // Credit payout for virtual simulation accounts safely with numbers (skip if trade was virtual)
          if (!isTradeRecordVirtual(finishedTrade) && account?.isVirtual) {
            const creditAmount = safePayout > 0 ? safePayout : Number((safeStake + positiveProfit).toFixed(2));
            setCurrentBalance((prev) => Number(((Number(prev) || 0) + creditAmount).toFixed(2)));
          } else if (!isTradeRecordVirtual(finishedTrade)) {
            derivWs.subscribeBalance();
          }

          // Check if a subsequent Martingale trade is currently in flight:
          const inFlightTrade = activeTradeRef.current;
          if (inFlightTrade) {
            // A subsequent Martingale trade is already running!
            // Store this profit credit so that if that in-flight trade happens to lose,
            // we subtract this positiveProfit to recover only the exact net loss on the next signal!
            correctedWinCreditRef.current = Number((correctedWinCreditRef.current + positiveProfit).toFixed(2));
            setBotStatusMessage(
              `[Deriv Official Correction]: Contract #${contractId} confirmed WON! (+$${positiveProfit.toFixed(2)}). An active trade is running: if it wins, Martingale stops. If it loses, profit (+$${positiveProfit.toFixed(2)}) will be subtracted to recover exact net loss on next signal.`
            );
          } else {
            // No trade running: simply reset Martingale back to base stake!
            correctedWinCreditRef.current = 0;
            setCurrentMartingaleStep(0);
            currentMartingaleStepRef.current = 0;
            setAccumulatedLoss(0);
            accumulatedLossRef.current = 0;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setCurrentPhase(1);
            currentPhaseRef.current = 1;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
            autoRecoveryStorage.clearActiveTrade();
            autoRecoveryStorage.clearCorrectedLossItems();
            correctedLossItemsRef.current = [];
            setCorrectedLossItems([]);

            // Real account win confirmed by Deriv: if Virtual Count is enabled, switch back to Virtual
            if (p.virtualCountEnabled && !isTradeRecordVirtual(finishedTrade)) {
              setIsInVirtualCount(true);
              isInVirtualCountRef.current = true;
              setVirtualCountLosses(0);
              virtualCountLossesRef.current = 0;
            }

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: 0,
              cycleLossCount: 0,
              isPausedAwaitingSignal: false,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: 0,
              currentPhase: 1,
              isInVirtualCount: p.virtualCountEnabled ? true : isInVirtualCountRef.current,
              virtualCountLosses: 0,
            });

            if (individualMultiMarketEnabledRef.current && finishedTrade.symbol) {
              const sym = finishedTrade.symbol;
              const resetMState: MarketMartingaleState = {
                symbol: sym,
                currentMartingaleStep: 0,
                accumulatedLoss: 0,
                cycleLossCount: 0,
                isPausedAwaitingSignal: false,
                lastLossStake: undefined,
                updatedAt: Date.now(),
              };
              setMarketMartingaleStates((prev) => {
                const updated = { ...prev, [sym]: resetMState };
                marketMartingaleStatesRef.current = updated;
                autoRecoveryStorage.saveMarketMartingaleStates(updated);
                return updated;
              });
              marketPendingBreaksRef.current[sym] = null;
            }

            setBotStatusMessage(
              `[Deriv Official Confirmation]: Contract #${contractId} confirmed WON! (+$${positiveProfit.toFixed(2)}). Martingale reset to base stake ($${p.stake.toFixed(2)}). All volatilities free: waiting for next valid signal...`
            );
          }
          checkTakeProfitAndStopLoss(case2Snapshot);
          return;
        }

        // CASE 3: Always sync exact exitBarrier and entryBarrier from Deriv on the exact settled contract ONLY
        if (finishedTrade.exitBarrier || finishedTrade.entryBarrier || finishedTrade.exitSpot) {
          setTradeRecords((prev) => {
            const idx = prev.findIndex(
              (t) =>
                (finishedTrade.id && t.id === finishedTrade.id) ||
                (contractId > 0 && Number(t.contractId) === contractId)
            );
            if (idx >= 0) {
              const original = prev[idx];
              const recordIsVirtual = isTradeRecordVirtual(original) || isTradeRecordVirtual(finishedTrade);
              const finalId = original.id && original.id.startsWith('VIRTUAL-')
                ? original.id
                : (recordIsVirtual ? `VIRTUAL-${contractId}` : (original.id || String(contractId)));
              const updatedStatus = finishedTrade.status && finishedTrade.status !== 'open' ? finishedTrade.status : original.status;
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                id: finalId,
                status: updatedStatus,
                isVirtualTrade: recordIsVirtual,
                exitSpot: finishedTrade.exitSpot !== undefined ? finishedTrade.exitSpot : updated[idx].exitSpot,
                exitBarrier: finishedTrade.exitBarrier || updated[idx].exitBarrier,
                entrySpot: finishedTrade.entrySpot !== undefined ? finishedTrade.entrySpot : updated[idx].entrySpot,
                entryBarrier: finishedTrade.entryBarrier || updated[idx].entryBarrier,
                profit: finishedTrade.profit !== undefined ? finishedTrade.profit : updated[idx].profit,
                payout: finishedTrade.payout !== undefined ? finishedTrade.payout : updated[idx].payout,
              };
              autoRecoveryStorage.saveTradeRecords(updated);
              return updated;
            }
            return prev;
          });
        }
        return;
      }

      const isWon = finishedTrade.status === 'won' || (typeof finishedTrade.profit === 'number' && finishedTrade.profit > 0);
      handledContractIdsRef.current.add(contractId);
      settledContractOutcomesRef.current.set(contractId, isWon ? 'won' : 'lost');

      if (finishedTrade.symbol) {
        activeTradesRef.current.delete(finishedTrade.symbol);
      }
      for (const [sym, t] of activeTradesRef.current.entries()) {
        if (Number(t.contractId) === contractId) {
          activeTradesRef.current.delete(sym);
        }
      }
      const remainingActiveTrades = Array.from(activeTradesRef.current.values());
      setActiveTrades(remainingActiveTrades);
      activeTradeRef.current = remainingActiveTrades.length > 0 ? remainingActiveTrades[0] : null;

      if (remainingActiveTrades.length === 0) {
        setIsTradePending(false);
        isTradePendingRef.current = false;
        isExecutingTradeRef.current = false;
        autoRecoveryStorage.clearActiveTrade();
      } else {
        autoRecoveryStorage.saveActiveTrade(remainingActiveTrades[0]);
      }

      const potentialPayout = finishedTrade.payout > 0
        ? finishedTrade.payout
        : Number((finishedTrade.stake * 1.84).toFixed(2));
      const finalizedProfit = isWon
        ? (finishedTrade.profit > 0 ? finishedTrade.profit : Number((potentialPayout - finishedTrade.stake).toFixed(2)))
        : -finishedTrade.stake;

      const isVirtual = isTradeRecordVirtual(finishedTrade);
      const properId = finishedTrade.id && finishedTrade.id.startsWith('VIRTUAL-')
        ? finishedTrade.id
        : (isVirtual ? `VIRTUAL-${contractId}` : String(contractId));

      const resolvedFinishedTrade: TradeRecord = {
        ...finishedTrade,
        contractId,
        id: properId,
        payout: potentialPayout,
        profit: finalizedProfit,
        status: isWon ? 'won' : 'lost',
        isVirtualTrade: isVirtual,
      };
      const resolvedSnapshot = buildSnapshotWithRecord(tradeRecordsRef.current, resolvedFinishedTrade);
      tradeRecordsRef.current = resolvedSnapshot;

      // Update trade history records with locked outcome (strictly match by id / contractId first)
      setTradeRecords((prev) => {
        let existingIdx = prev.findIndex(
          (t) =>
            (properId && t.id === properId) ||
            (contractId > 0 && Number(t.contractId) === contractId)
        );
        if (existingIdx < 0 && (!contractId || isNaN(contractId))) {
          existingIdx = prev.findIndex(
            (t) => t.symbol === resolvedFinishedTrade.symbol && t.status === 'open'
          );
        }
        let updated: TradeRecord[];
        if (existingIdx >= 0) {
          const original = prev[existingIdx];
          const resolvedSymbol = original.symbol || resolvedFinishedTrade.symbol;
          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === resolvedSymbol);
          const resolvedSymbolName = original.symbolName || mDef?.name || resolvedFinishedTrade.symbolName || resolvedSymbol;
          const recordIsVirtual = isTradeRecordVirtual(original) || isVirtual;
          const finalId = original.id && original.id.startsWith('VIRTUAL-')
            ? original.id
            : (recordIsVirtual ? `VIRTUAL-${contractId}` : resolvedFinishedTrade.id);

          updated = [...prev];
          updated[existingIdx] = {
            ...resolvedFinishedTrade,
            id: finalId,
            isVirtualTrade: recordIsVirtual,
            symbol: resolvedSymbol,
            symbolName: resolvedSymbolName,
          };
        } else {
          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === resolvedFinishedTrade.symbol);
          const resolvedTrade = {
            ...resolvedFinishedTrade,
            isVirtualTrade: isVirtual,
            symbolName: resolvedFinishedTrade.symbolName || mDef?.name || resolvedFinishedTrade.symbol,
          };
          updated = [resolvedTrade, ...prev];
        }
        autoRecoveryStorage.saveTradeRecords(updated);
        return updated;
      });

      // Update balance on settlement for real trades (skip if trade was virtual)
      if (!isTradeRecordVirtual(finishedTrade)) {
        if (isWon) {
          const safePayout = Number(resolvedFinishedTrade.payout) || 0;
          setCurrentBalance((prev) => Number(((Number(prev) || 0) + safePayout).toFixed(2)));
          currentBalanceRef.current = Number(((Number(currentBalanceRef.current) || 0) + safePayout).toFixed(2));
        }
        derivWs.subscribeBalance();
        if (sessionAuthRef.current?.token) {
          fetch('/api/account/balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: sessionAuthRef.current.token,
              accountId: accountRef.current?.loginid,
              appId,
            }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data?.balance?.balance) {
                const b = Number(data.balance.balance);
                setCurrentBalance(b);
                currentBalanceRef.current = b;
              }
            })
            .catch(() => {});
        }
      }

      // Martingale stake progression logic & Multi-Phase Pause Trade continuity & Market Locking
      // 1. Virtual Hook & Virtual Switch Simulation Settlement
      // (Virtual Hook and Virtual Switch take flat simulated trades to absorb drawdowns until 1 virtual win occurs)
      const isSwitchActiveAtTrade = Boolean(p.virtualSwitchEnabled) && isInVirtualSwitchRef.current;
      const isHookActiveAtTrade = Boolean(p.virtualHookEnabled) && isInVirtualHookRef.current;

      if (isSwitchActiveAtTrade || isHookActiveAtTrade) {
        if (isWon) {
          // Virtual Hook / Switch WON!
          if (isSwitchActiveAtTrade) {
            const simProfit = finalizedProfit > 0
              ? finalizedProfit
              : Number((finishedTrade.payout - finishedTrade.stake).toFixed(2));
            const curBox = currentVirtualSwitchStageRef.current;
            const targetTp = Math.max(0.1, p.virtualSwitchTakeProfit ?? 0.5);
            const currentStageProfit = virtualSwitchStageProfitRef.current;

            isInVirtualSwitchRef.current = false;
            isInVirtualHookRef.current = false;
            const nextRealStake = calculateCurrentStake();
            const curStep = currentMartingaleStepRef.current;
            setBotStatusMessage(
              `[Virtual Switch WON]: Virtual trade #${contractId} WON! (+$${simProfit.toFixed(2)} [Simulated]). Returning to REAL account! Next trade will execute on REAL account (${curStep > 0 ? `Recovery Step ${curStep}` : 'Base Stake'} → $${nextRealStake.toFixed(2)}). Box ${curBox} Real Profit: +$${currentStageProfit.toFixed(2)} / +$${targetTp.toFixed(2)}.`
            );
          }

          if (isHookActiveAtTrade) {
            isInVirtualHookRef.current = false;
            isInVirtualSwitchRef.current = false;
            const nextRealStake = calculateCurrentStake();
            const curStep = currentMartingaleStepRef.current;
            setBotStatusMessage(
              `[Virtual Hook WON!]: Virtual trade #${contractId} WON! (+$${finalizedProfit.toFixed(2)} [Simulated]). Switching back to REAL ACCOUNT! Next trade will execute on REAL account with Martingale recovery (${curStep > 0 ? `Step ${curStep}` : 'Base Stake'} → $${nextRealStake.toFixed(2)}).`
            );
          }

          setIsInVirtualHook(false);
          isInVirtualHookRef.current = false;
          setVirtualHookLossCount(0);
          virtualHookLossCountRef.current = 0;
          setIsInVirtualSwitch(false);
          isInVirtualSwitchRef.current = false;
          setVirtualSwitchLossCount(0);
          virtualSwitchLossCountRef.current = 0;
          setRealConsecutiveLosses(0);
          realConsecutiveLossesRef.current = 0;
          setRecoveryLockedMarket(null);
          recoveryLockedMarketRef.current = null;
          setCycleLossCount(0);
          cycleLossCountRef.current = 0;
          setIsPausedAwaitingSignal(false);
          isPausedAwaitingSignalRef.current = false;
          pausedFromMarketRef.current = null;

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: currentMartingaleStepRef.current,
            accumulatedLoss: accumulatedLossRef.current,
            startingBalance: startingBalanceRef.current,
            currentPhase: currentPhaseRef.current,
            currentMode: currentModeRef.current,
            inModeLossCount: inModeLossCountRef.current,
            modeFirstStake: modeFirstStakeRef.current,
            modeAccumulatedLoss: modeAccumulatedLossRef.current,
            isInVirtualHook: false,
            virtualHookLossCount: 0,
            isInVirtualSwitch: false,
            virtualSwitchLossCount: 0,
            realConsecutiveLosses: 0,
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
            currentVirtualSwitchStage: currentVirtualSwitchStageRef.current,
            virtualSwitchStageProfit: virtualSwitchStageProfitRef.current,
            recoveryLockedMarket: null,
            isInVirtualCount: isInVirtualCountRef.current,
            virtualCountLosses: virtualCountLossesRef.current,
          });

          pendingStructureBreakRef.current = null;
          marketPendingBreaksRef.current = {};
          const nowSec = Math.floor(Date.now() / 1000);
          const secondInCandle = nowSec % 60;
          const settleCandleEpoch = nowSec - secondInCandle;
          if (selectedStrategyRef.current.id !== 'continuous_trade') {
            lastExecutedCandleEpochRef.current = settleCandleEpoch;
            minNextSignalCandleEpochRef.current = settleCandleEpoch + 60;
          } else {
            minNextSignalCandleEpochRef.current = 0;
          }
          return;
        } else {
          // Virtual Hook / Switch trade LOST
          const isPauseActiveV = p.pauseTradeEnabled !== false;
          const pauseLimitV = Math.max(1, p.pauseLossThreshold ?? 2);
          const nextPhaseLossV = cycleLossCountRef.current + 1;
          const shouldPauseV = isPauseActiveV && nextPhaseLossV >= pauseLimitV;

          const tradeSymbolV = finishedTrade.symbol || p.symbol;
          const nowSec = Math.floor(Date.now() / 1000);
          const secondInCandle = nowSec % 60;
          const wallCandleEpoch = nowSec - secondInCandle;
          const lossSymCandlesV = tradeSymbolV === p.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbolV];
          const latestCandleEpochV = lossSymCandlesV && lossSymCandlesV.length > 0
            ? lossSymCandlesV[lossSymCandlesV.length - 1].epoch
            : wallCandleEpoch;
          const effectiveSettleEpoch = Math.max(latestCandleEpochV, wallCandleEpoch);
          const nextFreshEpoch = secondInCandle <= 5 ? effectiveSettleEpoch : effectiveSettleEpoch + 60;

          if (shouldPauseV) {
            const nextPhaseV = (currentPhaseRef.current || 1) + 1;
            setCurrentPhase(nextPhaseV);
            currentPhaseRef.current = nextPhaseV;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setIsPausedAwaitingSignal(true);
            isPausedAwaitingSignalRef.current = true;
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
          } else if (isPauseActiveV) {
            setCycleLossCount(nextPhaseLossV);
            cycleLossCountRef.current = nextPhaseLossV;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
          } else {
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
          }

          if (isInVirtualSwitchRef.current) {
            const nextVCount = virtualSwitchLossCountRef.current + 1;
            setVirtualSwitchLossCount(nextVCount);
            virtualSwitchLossCountRef.current = nextVCount;
            setIsInVirtualSwitch(true);
            isInVirtualSwitchRef.current = true;
            const curBox = currentVirtualSwitchStageRef.current;
            setBotStatusMessage(
              shouldPauseV
                ? `[Virtual Switch Loss #${nextVCount} | Post-Martingale Paused (${pauseLimitV}/${pauseLimitV})]: Virtual trade #${contractId} LOST (-$0.00 Real Impact). Post-Martingale paused — awaiting NEW signal for Virtual Switch (Box ${curBox})...`
                : `[Virtual Switch Loss #${nextVCount}]: Virtual trade #${contractId} LOST (-$0.00 Real Impact). Real capital safe! Continuing in Virtual Switch (Box ${curBox}) - scanning markets to continue trading in virtual until 1 Virtual Win occurs...`
            );
          }

          if (isInVirtualHookRef.current) {
            const nextVCount = virtualHookLossCountRef.current + 1;
            setVirtualHookLossCount(nextVCount);
            virtualHookLossCountRef.current = nextVCount;
            setIsInVirtualHook(true);
            isInVirtualHookRef.current = true;

            setBotStatusMessage(
              shouldPauseV
                ? `[Virtual Hook Loss #${nextVCount} | Post-Martingale Paused (${pauseLimitV}/${pauseLimitV})]: Virtual trade #${contractId} LOST (-$0.00 Real Impact). Post-Martingale paused — awaiting NEW signal for Virtual Hook...`
                : `[Virtual Hook Loss #${nextVCount}]: Virtual trade #${contractId} LOST (-$0.00 Real Impact). Real capital safe! Continuing in Virtual Hook - scanning markets to continue trading in virtual until 1 Virtual Win occurs...`
            );
          }

          autoRecoveryStorage.saveMartingaleState({
            cycleLossCount: cycleLossCountRef.current,
            isPausedAwaitingSignal: isPausedAwaitingSignalRef.current,
            currentPhase: currentPhaseRef.current,
            recoveryLockedMarket: recoveryLockedMarketRef.current,
            isInVirtualHook: isInVirtualHookRef.current,
            virtualHookLossCount: virtualHookLossCountRef.current,
            isInVirtualSwitch: isInVirtualSwitchRef.current,
            virtualSwitchLossCount: virtualSwitchLossCountRef.current,
            currentVirtualSwitchStage: currentVirtualSwitchStageRef.current,
            virtualSwitchStageProfit: virtualSwitchStageProfitRef.current,
            isInVirtualCount: isInVirtualCountRef.current,
            virtualCountLosses: virtualCountLossesRef.current,
          });

          pendingStructureBreakRef.current = null;
          marketPendingBreaksRef.current = {};
          if (selectedStrategyRef.current.id !== 'continuous_trade') {
            lastExecutedCandleEpochRef.current = secondInCandle > 5 ? effectiveSettleEpoch : effectiveSettleEpoch - 60;
            marketLastExecutedCandleEpochRef.current[tradeSymbolV] = secondInCandle > 5 ? effectiveSettleEpoch : effectiveSettleEpoch - 60;
            minNextSignalCandleEpochRef.current = nextFreshEpoch;
            marketMinNextSignalCandleEpochRef.current[tradeSymbolV] = nextFreshEpoch;
            if (shouldPauseV) {
              if (latestSmcResultRef.current?.structures) {
                latestSmcResultRef.current.structures.forEach((s) => {
                  if (s.breakTime < nextFreshEpoch) tradedStructureIdsRef.current.add(s.id);
                });
              }
              Object.keys(marketSmcRef.current).forEach((sym) => {
                const smc = marketSmcRef.current[sym];
                if (smc?.structures) {
                  smc.structures.forEach((s) => {
                    if (s.breakTime < nextFreshEpoch) tradedStructureIdsRef.current.add(s.id);
                  });
                }
              });
            }
          } else {
            minNextSignalCandleEpochRef.current = shouldPauseV ? nextFreshEpoch : 0;
            marketMinNextSignalCandleEpochRef.current[tradeSymbolV] = shouldPauseV ? nextFreshEpoch : 0;
          }
          return;
        }
      }

      // 2. Standard Martingale & Post-Martingale Settlement (Runs for both Virtual Count and Real Trades)
      if (isWon) {
        // Snapshot pre-win Post-Martingale / Virtual Count / In-Inter-Mode state in case Deriv later corrects this win to LOSS (CASE 1)
        preWinPhaseStateRef.current.set(contractId, {
          cycleLossCount: cycleLossCountRef.current,
          currentPhase: currentPhaseRef.current || 1,
          isPausedAwaitingSignal: isPausedAwaitingSignalRef.current,
          isInVirtualCount: isInVirtualCountRef.current,
          virtualCountLosses: virtualCountLossesRef.current,
          defaultModeLossCount: defaultModeLossCountRef.current,
          inModeLossCount: inModeLossCountRef.current,
          currentMode: currentModeRef.current,
          modeFirstStake: modeFirstStakeRef.current,
          modeAccumulatedLoss: modeAccumulatedLossRef.current,
        });
        if (preWinPhaseStateRef.current.size > 50) {
          const oldestKey = preWinPhaseStateRef.current.keys().next().value;
          if (oldestKey !== undefined) preWinPhaseStateRef.current.delete(oldestKey);
        }

        if (!isVirtual) {
          // Reset real consecutive losses on real win
          setRealConsecutiveLosses(0);
          realConsecutiveLossesRef.current = 0;
          setIsInVirtualHook(false);
          isInVirtualHookRef.current = false;
          setVirtualHookLossCount(0);
          virtualHookLossCountRef.current = 0;
          setIsInVirtualSwitch(false);
          isInVirtualSwitchRef.current = false;
          setVirtualSwitchLossCount(0);
          virtualSwitchLossCountRef.current = 0;

          // If Virtual Count is enabled, a real win resets consecutive virtual losses to 0 and returns to Virtual Count!
          if (p.virtualCountEnabled) {
            setIsInVirtualCount(true);
            isInVirtualCountRef.current = true;
            setVirtualCountLosses(0);
            virtualCountLossesRef.current = 0;
          }

        // Virtual Switch Stage Profit Accumulation & Escalation Check:
        if (p.virtualSwitchEnabled) {
          const winProfit = finalizedProfit > 0
            ? finalizedProfit
            : Number((finishedTrade.payout - finishedTrade.stake).toFixed(2));
          const currentStageProfit = virtualSwitchStageProfitRef.current;
          const nextStageProfit = Number((currentStageProfit + Math.max(0, winProfit)).toFixed(2));
          const targetTp = Math.max(0.1, p.virtualSwitchTakeProfit ?? 0.5);

          const activeBoxes = Array.isArray(p.virtualSwitchBoxes) && p.virtualSwitchBoxes.length > 0
            ? [...p.virtualSwitchBoxes].sort((a, b) => a - b)
            : [1, 2, 3];

          let curBox = currentVirtualSwitchStageRef.current;
          if (!activeBoxes.includes(curBox)) {
            curBox = activeBoxes[0];
            setCurrentVirtualSwitchStage(curBox);
            currentVirtualSwitchStageRef.current = curBox;
          }

          if (nextStageProfit >= targetTp) {
            // Reached stage Take Profit! Escalate to next box or loop cycle
            const curIdx = activeBoxes.indexOf(curBox);
            let nextBox: number;
            let escalationMsg = '';
            if (curIdx === -1 || curIdx >= activeBoxes.length - 1) {
              // Reached final active box! Reset cycle to first active box!
              nextBox = activeBoxes[0];
              escalationMsg = `Virtual Switch Take Profit Hit! Target profit of +$${nextStageProfit.toFixed(2)} reached in Box ${curBox} (Target: +$${targetTp.toFixed(2)})! Cycle reset back to Box ${nextBox} (${nextBox} consecutive loss threshold before switching to virtual).`;
            } else {
              // Escalate to next checked box!
              nextBox = activeBoxes[curIdx + 1];
              escalationMsg = `Virtual Switch Take Profit Hit! Target profit of +$${nextStageProfit.toFixed(2)} reached in Box ${curBox} (Target: +$${targetTp.toFixed(2)})! Escalating to Box ${nextBox} (${nextBox} consecutive loss threshold before switching to virtual).`;
            }
            setCurrentVirtualSwitchStage(nextBox);
            currentVirtualSwitchStageRef.current = nextBox;
            setVirtualSwitchStageProfit(0);
            virtualSwitchStageProfitRef.current = 0;
            setRealConsecutiveLosses(0);
            realConsecutiveLossesRef.current = 0;

            setVirtualSwitchEscalationNotice(escalationMsg);
            setBotStatusMessage(`[VIRTUAL SWITCH ESCALATED]: ${escalationMsg}`);
            playEscalationChime();
            setTimeout(() => {
              setVirtualSwitchEscalationNotice((prev) => (prev === escalationMsg ? null : prev));
            }, 10000);
          } else {
            setVirtualSwitchStageProfit(nextStageProfit);
            virtualSwitchStageProfitRef.current = nextStageProfit;
            setBotStatusMessage(
              `[Real Trade WON]: Trade #${contractId} WON (+${winProfit.toFixed(2)})! Virtual Switch (Box ${curBox}): +$${nextStageProfit.toFixed(2)} / +$${targetTp.toFixed(2)} Take Profit.`
            );
          }
        }

        const isActiveInInterPartialRecovery =
          !individualMultiMarketEnabledRef.current &&
          Boolean(p.inInterModeEnabled) &&
          currentModeRef.current >= 1;

        // Clear corrected loss items and pause state on win; keep Mode recovery state if Mode 1..10 is still recovering
        correctedWinCreditRef.current = 0;
        setCurrentMartingaleStep(0);
        currentMartingaleStepRef.current = 0;
        if (!isActiveInInterPartialRecovery) {
          setAccumulatedLoss(0);
          accumulatedLossRef.current = 0;
        }
        setCycleLossCount(0);
        cycleLossCountRef.current = 0;
        setCurrentPhase(1);
        currentPhaseRef.current = 1;
        setIsPausedAwaitingSignal(false);
        isPausedAwaitingSignalRef.current = false;
        setRecoveryLockedMarket(null);
        recoveryLockedMarketRef.current = null;
        pausedFromMarketRef.current = null;

        // Clear all pending corrected loss items from memory and storage on win
        autoRecoveryStorage.clearCorrectedLossItems();
        correctedLossItemsRef.current = [];
        setCorrectedLossItems([]);

        // Check if Individual Multi-Market mode is active
        if (individualMultiMarketEnabledRef.current) {
          const sym = finishedTrade.symbol || p.symbol;
          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym);

          const resetMState: MarketMartingaleState = {
            symbol: sym,
            currentMartingaleStep: 0,
            accumulatedLoss: 0,
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
            currentPhase: 1,
            lastTradeDirection: (finishedTrade.contractType === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT',
            lastLossStake: undefined,
            updatedAt: Date.now(),
          };

          setMarketMartingaleStates((prev) => {
            const updated = { ...prev, [sym]: resetMState };
            marketMartingaleStatesRef.current = updated;
            autoRecoveryStorage.saveMarketMartingaleStates(updated);
            return updated;
          });

          const threshold = Math.max(1, p.virtualCountThreshold ?? 3);
          const vCountWinInfo = p.virtualCountEnabled
            ? (isTradeRecordVirtual(finishedTrade)
                ? ` [Virtual Win (0/${threshold} losses). Stays on Virtual]`
                : ` [Real Account Won! Switched back to Virtual Count (0/${threshold} losses)]`)
            : '';
          setBotStatusMessage(
            `[${mDef?.shortName || sym} WON]: Trade #${contractId} WON! (+$${finalizedProfit.toFixed(2)}). Independent Martingale for ${mDef?.shortName || sym} reset to base ($${p.stake.toFixed(2)}).${vCountWinInfo} Waiting for next signal...`
          );

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: 0,
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
            recoveryLockedMarket: null,
            startingBalance: startingBalanceRef.current,
            accumulatedLoss: 0,
            currentPhase: 1,
            currentMode: 0,
            inModeLossCount: 0,
            modeFirstStake: 0,
            modeAccumulatedLoss: 0,
            isInVirtualCount: p.virtualCountEnabled ? true : isInVirtualCountRef.current,
            virtualCountLosses: 0,
            realConsecutiveLosses: 0,
          });
        } else if (p.inInterModeEnabled && currentModeRef.current >= 1) {
          const mode = currentModeRef.current;
          const winProfit = finalizedProfit > 0
            ? finalizedProfit
            : Number(Math.max(0, finishedTrade.payout - finishedTrade.stake).toFixed(2));

          const currentSeqLoss = Math.max(modeAccumulatedLossRef.current, accumulatedLossRef.current);
          const remainingLoss = Math.max(0, Number((currentSeqLoss - winProfit).toFixed(2)));

          if (remainingLoss <= 0.01) {
            // Full recovery complete! Reset to Default Mode and base stake
            setCurrentMode(0);
            currentModeRef.current = 0;
            setDefaultModeLossCount(0);
            defaultModeLossCountRef.current = 0;
            setInModeLossCount(0);
            inModeLossCountRef.current = 0;
            setModeFirstStake(0);
            modeFirstStakeRef.current = 0;
            setModeAccumulatedLoss(0);
            modeAccumulatedLossRef.current = 0;
            setAccumulatedLoss(0);
            accumulatedLossRef.current = 0;

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: 0,
              cycleLossCount: 0,
              isPausedAwaitingSignal: false,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: 0,
              currentPhase: 1,
              currentMode: 0,
              defaultModeLossCount: 0,
              inModeLossCount: 0,
              modeFirstStake: 0,
              modeAccumulatedLoss: 0,
              isInVirtualCount: p.virtualCountEnabled ? true : isInVirtualCountRef.current,
              virtualCountLosses: 0,
              realConsecutiveLosses: 0,
            });

            setBotStatusMessage(
              `Trade #${contractId} WON! (+$${winProfit.toFixed(2)}). Mode ${mode} sequence loss FULLY RECOVERED! Switched back to Default Mode and base stake ($${p.stake.toFixed(2)}).`
            );
          } else {
            // Partial recovery: reset in-mode consecutive losses and Post-Martingale phase attempts, keep Mode M & 1st stake until all loss is recovered!
            const modes = Array.isArray(p.modesConfig) && p.modesConfig.length === 10
              ? p.modesConfig
              : DEFAULT_IN_INTER_MODES;
            let fallbackFirstStake = p.stake;
            for (let m = 0; m < mode; m++) {
              fallbackFirstStake = roundInInterStake(
                fallbackFirstStake * (modes[m]?.interModeMartingale || 1.5)
              );
            }
            const mode1stStake = modeFirstStakeRef.current > 0
              ? modeFirstStakeRef.current
              : fallbackFirstStake;

            setModeAccumulatedLoss(remainingLoss);
            modeAccumulatedLossRef.current = remainingLoss;
            setAccumulatedLoss(remainingLoss);
            accumulatedLossRef.current = remainingLoss;
            setDefaultModeLossCount(0);
            defaultModeLossCountRef.current = 0;
            setInModeLossCount(0);
            inModeLossCountRef.current = 0;

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: 0,
              cycleLossCount: 0,
              isPausedAwaitingSignal: false,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: remainingLoss,
              currentPhase: 1,
              currentMode: mode,
              defaultModeLossCount: 0,
              inModeLossCount: 0,
              modeFirstStake: mode1stStake,
              modeAccumulatedLoss: remainingLoss,
              isInVirtualCount: p.virtualCountEnabled ? true : isInVirtualCountRef.current,
              virtualCountLosses: 0,
              realConsecutiveLosses: 0,
            });

            setBotStatusMessage(
              `Trade #${contractId} WON! (+$${winProfit.toFixed(2)}). Repeating Mode ${mode} 1st stake ($${mode1stStake.toFixed(2)}) until all losses ($${remainingLoss.toFixed(2)} remaining) are recovered.`
            );
          }
        } else {
          // Standard / Auto-Martingale win reset
          if (p.inInterModeEnabled) {
            setCurrentMode(0);
            currentModeRef.current = 0;
            setDefaultModeLossCount(0);
            defaultModeLossCountRef.current = 0;
            setInModeLossCount(0);
            inModeLossCountRef.current = 0;
            setModeFirstStake(0);
            modeFirstStakeRef.current = 0;
            setModeAccumulatedLoss(0);
            modeAccumulatedLossRef.current = 0;
          }

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: 0,
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
            recoveryLockedMarket: null,
            startingBalance: startingBalanceRef.current,
            accumulatedLoss: 0,
            currentPhase: 1,
            currentMode: 0,
            defaultModeLossCount: 0,
            inModeLossCount: 0,
            modeFirstStake: 0,
            modeAccumulatedLoss: 0,
            isInVirtualCount: p.virtualCountEnabled ? true : isInVirtualCountRef.current,
            virtualCountLosses: 0,
            realConsecutiveLosses: 0,
          });

          const recoveryCycleInfo = p.autoMartingaleEnabled ? 'Auto Martingale 83% recovery cycle' : 'Martingale cycle';
          const threshold = Math.max(1, p.virtualCountThreshold ?? 3);
          const vCountWinInfo = p.virtualCountEnabled
            ? (isTradeRecordVirtual(finishedTrade)
                ? ` [Virtual Win (0/${threshold} losses). Stays on Virtual]`
                : ` [Real Account Won! Switched back to Virtual Count (0/${threshold} losses)]`)
            : '';
          const isContinuous = selectedStrategyRef.current.id === 'continuous_trade';
          const nextActionMsg = isContinuous
            ? 'Continuing execution on next candle at 58s...'
            : 'Waiting for next valid Break of Structure or CHoCH signal...';
          setBotStatusMessage(
            `Trade #${contractId} WON! (+$${finalizedProfit.toFixed(2)}). ${recoveryCycleInfo} complete! Stake reset to base ($${p.stake.toFixed(2)}).${vCountWinInfo} ${nextActionMsg}`
          );
        }

        const winSymbol = finishedTrade.symbol || p.symbol;
        if (individualMultiMarketEnabledRef.current) {
          // Reset this individual market's Martingale state completely!
          const resetMState: MarketMartingaleState = {
            symbol: winSymbol,
            currentMartingaleStep: 0,
            accumulatedLoss: 0,
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
            lastLossStake: undefined,
            updatedAt: Date.now(),
          };
          setMarketMartingaleStates((prev) => {
            const updated = { ...prev, [winSymbol]: resetMState };
            marketMartingaleStatesRef.current = updated;
            autoRecoveryStorage.saveMarketMartingaleStates(updated);
            return updated;
          });

          marketPendingBreaksRef.current[winSymbol] = null;
          if (winSymbol === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
          const nowSec = Math.floor(Date.now() / 1000);
          const secondInCandle = nowSec % 60;
          const winSymCandles = winSymbol === p.symbol ? candlesRef.current : marketCandlesRef.current[winSymbol];
          const settleCandleEpoch = winSymCandles && winSymCandles.length > 0
            ? winSymCandles[winSymCandles.length - 1].epoch
            : (nowSec - secondInCandle);
          const nextFreshEpoch = secondInCandle <= 5 ? settleCandleEpoch : settleCandleEpoch + 60;
          if (secondInCandle > 5) {
            marketLastExecutedCandleEpochRef.current[winSymbol] = settleCandleEpoch;
          }
          marketMinNextSignalCandleEpochRef.current[winSymbol] = selectedStrategyRef.current.id === 'continuous_trade' ? 0 : nextFreshEpoch;

          const smc = marketSmcRef.current[winSymbol] || (winSymbol === p.symbol ? latestSmcResultRef.current : null);
          if (smc?.structures) {
            smc.structures.forEach((s) => tradedStructureIdsRef.current.add(s.id));
          }
          if (smc?.activeSwingHigh) {
            tradedStructureIdsRef.current.add(`live-high-${smc.activeSwingHigh.time}-${smc.activeSwingHigh.price.toFixed(4)}`);
          }
          if (smc?.activeSwingLow) {
            tradedStructureIdsRef.current.add(`live-low-${smc.activeSwingLow.time}-${smc.activeSwingLow.price.toFixed(4)}`);
          }
          const cList = winSymbol === p.symbol ? candlesRef.current : marketCandlesRef.current[winSymbol];
          if (cList && cList.length >= 10) {
            const calculated = calculateSMC(cList, smcConfigRef.current);
            calculated.structures.forEach((s) => tradedStructureIdsRef.current.add(s.id));
          }

          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === winSymbol);
          setBotStatusMessage(
            `[${mDef?.shortName || winSymbol} WON! (+$${finalizedProfit.toFixed(2)})]: Recovery complete! Martingale reset to base stake ($${p.stake.toFixed(2)}). Bot stopped trading this market and is awaiting next valid Break of Structure or CHoCH signal...`
          );
        } else {
          // Discard any pending or armed break immediately
          pendingStructureBreakRef.current = null;
        }
      } else {
        // VIRTUAL TRADE WON! (Simulated Demo Trade)
        // Virtual trades NEVER cover or recover real account losses!
        // Real losses and recovery state MUST REMAIN FULLY ARMED!
        // However, any WIN breaks the consecutive loss streak, so Post-Martingale cycleLossCount resets to 0.
        if (p.virtualCountEnabled) {
          setVirtualCountLosses(0);
          virtualCountLossesRef.current = 0;
          if (isInVirtualCountRef.current) {
            setIsInVirtualCount(true);
            isInVirtualCountRef.current = true;
          }
        }

        setCycleLossCount(0);
        cycleLossCountRef.current = 0;
        setIsPausedAwaitingSignal(false);
        isPausedAwaitingSignalRef.current = false;
        setRecoveryLockedMarket(null);
        recoveryLockedMarketRef.current = null;
        pausedFromMarketRef.current = null;

        const vWinSymbol = finishedTrade.symbol || p.symbol;
        if (individualMultiMarketEnabledRef.current && marketMartingaleStatesRef.current[vWinSymbol]) {
          const updatedM: MarketMartingaleState = {
            ...marketMartingaleStatesRef.current[vWinSymbol],
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
            updatedAt: Date.now(),
          };
          marketMartingaleStatesRef.current[vWinSymbol] = updatedM;
          setMarketMartingaleStates((prev) => {
            const next = { ...prev, [vWinSymbol]: updatedM };
            autoRecoveryStorage.saveMarketMartingaleStates(next);
            return next;
          });
        }

        const hasRealPendingLoss =
          accumulatedLossRef.current > 0 ||
          correctedLossItemsRef.current.some((item) => item.status === 'pending_recovery');
        const threshold = Math.max(1, p.virtualCountThreshold ?? 3);

        if (hasRealPendingLoss) {
          setBotStatusMessage(
            `[Virtual Win (#${contractId})]: Virtual trade WON (+$0.00 Real Impact). Real loss recovery ($${accumulatedLossRef.current.toFixed(2)}) remains ARMED on real account! Virtual count at 0/${threshold} losses.`
          );
        } else {
          setBotStatusMessage(
            `[Virtual Win (#${contractId})]: Virtual trade WON (+$0.00 Real Impact). Virtual count at 0/${threshold} losses.`
          );
        }

        autoRecoveryStorage.saveMartingaleState({
          currentMartingaleStep: currentMartingaleStepRef.current,
          cycleLossCount: 0,
          isPausedAwaitingSignal: false,
          recoveryLockedMarket: null,
          startingBalance: startingBalanceRef.current,
          accumulatedLoss: accumulatedLossRef.current,
          currentPhase: currentPhaseRef.current,
          isInVirtualCount: isInVirtualCountRef.current,
          virtualCountLosses: 0,
          realConsecutiveLosses: realConsecutiveLossesRef.current,
        });

        pendingStructureBreakRef.current = null;
      }

      // When a trade is a win, wait for next valid signal (BOS or CHoCH) on a subsequent candle
      const nowSec = Math.floor(Date.now() / 1000);
      const secondInCandle = nowSec % 60;
      const winSym = finishedTrade.symbol || p.symbol;
      const winSymCandles = winSym === p.symbol ? candlesRef.current : marketCandlesRef.current[winSym];
      const settleCandleEpoch = winSymCandles && winSymCandles.length > 0
        ? winSymCandles[winSymCandles.length - 1].epoch
        : (nowSec - secondInCandle);
      const nextFreshEpoch = secondInCandle <= 5 ? settleCandleEpoch : settleCandleEpoch + 60;
      if (selectedStrategyRef.current.id !== 'continuous_trade') {
        if (secondInCandle > 5) {
          lastExecutedCandleEpochRef.current = settleCandleEpoch;
          marketLastExecutedCandleEpochRef.current[winSym] = settleCandleEpoch;
        }
        minNextSignalCandleEpochRef.current = nextFreshEpoch;
        marketMinNextSignalCandleEpochRef.current[winSym] = nextFreshEpoch;

        // Reset recovery locked market and post-martingale state upon winning
        setRecoveryLockedMarket(null);
        recoveryLockedMarketRef.current = null;
        setIsPausedAwaitingSignal(false);
        isPausedAwaitingSignalRef.current = false;
        setCycleLossCount(0);
        cycleLossCountRef.current = 0;
        pendingStructureBreakRef.current = null;
        marketPendingBreaksRef.current = {};
      } else {
        minNextSignalCandleEpochRef.current = 0;
      }

      // Mark all existing SMC structures and breached swing high/low levels as consumed/traded across all scanned markets
      if (latestSmcResultRef.current) {
        const res = latestSmcResultRef.current;
        (res.structures || []).forEach((s) => tradedStructureIdsRef.current.add(s.id));
        const sym = paramsRef.current.symbol;
        if (res.activeSwingHigh) {
          tradedStructureIdsRef.current.add(`${sym}-swing-high-${res.activeSwingHigh.time}-${res.activeSwingHigh.price.toFixed(4)}`);
          tradedStructureIdsRef.current.add(`live-break-high-${sym}-${res.activeSwingHigh.time}-${res.activeSwingHigh.price.toFixed(4)}`);
        }
        if (res.activeSwingLow) {
          tradedStructureIdsRef.current.add(`${sym}-swing-low-${res.activeSwingLow.time}-${res.activeSwingLow.price.toFixed(4)}`);
          tradedStructureIdsRef.current.add(`live-break-low-${sym}-${res.activeSwingLow.time}-${res.activeSwingLow.price.toFixed(4)}`);
        }
      }
      Object.keys(marketSmcRef.current).forEach((mSym) => {
        const bgSmc = marketSmcRef.current[mSym];
        if (bgSmc?.structures) {
          bgSmc.structures.forEach((s) => tradedStructureIdsRef.current.add(s.id));
        }
        if (bgSmc?.activeSwingHigh) {
          tradedStructureIdsRef.current.add(`${mSym}-swing-high-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`);
          tradedStructureIdsRef.current.add(`live-break-high-${mSym}-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`);
        }
        if (bgSmc?.activeSwingLow) {
          tradedStructureIdsRef.current.add(`${mSym}-swing-low-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`);
          tradedStructureIdsRef.current.add(`live-break-low-${mSym}-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`);
        }
      });
    } else {
        // Trade is a loss: Martingale MUST NEVER RESET on a loss!
        const lossStake = Number(finishedTrade.stake);

        // Virtual Count tracking: count consecutive virtual losses ONLY if virtualCountEnabled
        let virtualCountSwitchedToReal = false;
        if (Boolean(p.virtualCountEnabled)) {
          if (isTradeRecordVirtual(finishedTrade)) {
            const threshold = Math.max(1, p.virtualCountThreshold ?? 3);
            const nextCount = virtualCountLossesRef.current + 1;
            setVirtualCountLosses(nextCount);
            virtualCountLossesRef.current = nextCount;

            if (nextCount >= threshold) {
              // Consecutive virtual losses reached! Switch to REAL account for subsequent trades!
              setIsInVirtualCount(false);
              isInVirtualCountRef.current = false;
              virtualCountSwitchedToReal = true;
              // Check if there is an existing unrecovered real account loss (e.g. from a Deriv-corrected settlement or previous real loss)
              const hasRealLossToRecover =
                accumulatedLossRef.current > 0 ||
                modeAccumulatedLossRef.current > 0.01 ||
                correctedLossItemsRef.current.some((item) => item.status === 'pending_recovery');
              if (!hasRealLossToRecover) {
                // Reset real account Martingale state completely only when there is NO prior real loss pending recovery!
                setCurrentMartingaleStep(0);
                currentMartingaleStepRef.current = 0;
                setAccumulatedLoss(0);
                accumulatedLossRef.current = 0;
              } else {
                console.log(
                  `[Virtual Count Target Hit]: ${nextCount}/${threshold} virtual losses reached. Switching to REAL account with ARMED real recovery ($${accumulatedLossRef.current.toFixed(2)}).`
                );
              }
            } else {
              setIsInVirtualCount(true);
              isInVirtualCountRef.current = true;
            }
          }
        } else {
          setVirtualCountLosses(0);
          virtualCountLossesRef.current = 0;
          setIsInVirtualCount(false);
          isInVirtualCountRef.current = false;
        }

        if (individualMultiMarketEnabledRef.current) {
          const tradeSymbol = finishedTrade.symbol || p.symbol;
          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbol);

          const prevM = marketMartingaleStatesRef.current[tradeSymbol] || {
            symbol: tradeSymbol,
            currentMartingaleStep: 0,
            accumulatedLoss: 0,
            cycleLossCount: 0,
            isPausedAwaitingSignal: false,
          };

          const isVirtualTrade = Boolean(p.virtualHookEnabled || p.virtualSwitchEnabled || p.virtualCountEnabled) && isTradeRecordVirtual(finishedTrade);
          // Virtual trades strictly use default flat stake (0.35) and NEVER increment real Martingale
          const nextStep = isVirtualTrade ? (prevM.currentMartingaleStep || 0) : (prevM.currentMartingaleStep || 0) + 1;
          const newAccumulatedLoss = isVirtualTrade ? (prevM.accumulatedLoss || 0) : Number(((prevM.accumulatedLoss || 0) + lossStake).toFixed(2));
          // Post-Martingale MUST count and enforce consecutive losses for ALL features (Virtual and Real)!
          const nextCycleLossCount = (prevM.cycleLossCount || 0) + 1;
          const pauseLimit = Math.max(1, p.pauseLossThreshold ?? 2);
          const maxMartingaleLimit = Math.max(1, p.maxMultiplier || 5);
          const maxAction = p.maxMartingaleAction || 'stop';

          // Max multiplier check (applies to real trading only)
          if (!isVirtualTrade && nextStep >= maxMartingaleLimit) {
            if (maxAction === 'stop') {
              setIsAutoTrading(false);
              isAutoTradingRef.current = false;
              autoRecoveryStorage.saveAutoTradingState(false);
              setBotStatusMessage(
                `[${mDef?.shortName || tradeSymbol} Max Martingale Reached (${nextStep}/${maxMartingaleLimit} Losses)]: Auto-trading STOPPED as configured for capital protection.`
              );
              if (!isVirtualRecord(resolvedFinishedTrade)) checkTakeProfitAndStopLoss(resolvedSnapshot);
              return;
            } else {
              const resetMState: MarketMartingaleState = {
                symbol: tradeSymbol,
                currentMartingaleStep: 0,
                accumulatedLoss: 0,
                cycleLossCount: 0,
                isPausedAwaitingSignal: false,
                updatedAt: Date.now(),
              };
              marketMartingaleStatesRef.current[tradeSymbol] = resetMState;
              setMarketMartingaleStates((prev) => {
                const updated = { ...prev, [tradeSymbol]: resetMState };
                autoRecoveryStorage.saveMarketMartingaleStates(updated);
                return updated;
              });
              setBotStatusMessage(
                `[${mDef?.shortName || tradeSymbol} Max Martingale Reached (${nextStep}/${maxMartingaleLimit} Losses)]: RESET to base stake ($${p.stake.toFixed(2)}) as configured.`
              );
              if (!isVirtualRecord(resolvedFinishedTrade)) checkTakeProfitAndStopLoss(resolvedSnapshot);
              return;
            }
          }

          // Individual Multi-Market Post-Martingale Pause Check:
          // Respects Post-Martingale universally across both Virtual and Real trades!
          const isPauseActive = p.pauseTradeEnabled !== false;
          let isPausedForMarket = false;
          let storedCycleCount = nextCycleLossCount;

          const nowSec = Math.floor(Date.now() / 1000);
          const secondInCandle = nowSec % 60;
          const wallCandleEpoch = nowSec - secondInCandle;
          const lossSymCandles = tradeSymbol === p.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbol];
          const latestCandleEpoch = lossSymCandles && lossSymCandles.length > 0
            ? lossSymCandles[lossSymCandles.length - 1].epoch
            : wallCandleEpoch;
          const effectiveSettleEpoch = Math.max(latestCandleEpoch, wallCandleEpoch);
          const nextFreshEpoch = secondInCandle <= 5 ? effectiveSettleEpoch : effectiveSettleEpoch + 60;

          const lockedInfo = {
            symbol: tradeSymbol,
            symbolName: finishedTrade.symbolName || mDef?.name || tradeSymbol,
          };

          if (isPauseActive && nextCycleLossCount >= pauseLimit) {
            isPausedForMarket = true;
            storedCycleCount = 0;
            const nextPhase = (currentPhaseRef.current || 1) + 1;
            setCurrentPhase(nextPhase);
            currentPhaseRef.current = nextPhase;
            // Completed post-martingale pause limit: unlock and pause to await a NEW signal
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setIsPausedAwaitingSignal(true);
            isPausedAwaitingSignalRef.current = true;
            if (selectedStrategyRef.current.id !== 'continuous_trade') {
              marketLastExecutedCandleEpochRef.current[tradeSymbol] =
                secondInCandle > 5 ? effectiveSettleEpoch : effectiveSettleEpoch - 60;
            }
            marketMinNextSignalCandleEpochRef.current[tradeSymbol] = nextFreshEpoch;
            marketPendingBreaksRef.current[tradeSymbol] = null;
            if (tradeSymbol === p.symbol) pendingStructureBreakRef.current = null;

            const symSmc = tradeSymbol === p.symbol ? latestSmcResultRef.current : marketSmcRef.current[tradeSymbol];
            if (symSmc?.structures) {
              symSmc.structures.forEach((s) => {
                if (s.breakTime < nextFreshEpoch) tradedStructureIdsRef.current.add(s.id);
              });
            }
            const symQuote =
              tradeSymbol === p.symbol && ticksRef.current.length > 0
                ? ticksRef.current[ticksRef.current.length - 1].quote
                : marketTicksRef.current[tradeSymbol]?.quote;
            if (symSmc && symQuote !== undefined && symQuote !== null) {
              if (symSmc.activeSwingHigh && symQuote >= symSmc.activeSwingHigh.price) {
                tradedStructureIdsRef.current.add(`${tradeSymbol}-swing-high-${symSmc.activeSwingHigh.time}-${symSmc.activeSwingHigh.price.toFixed(4)}`);
                tradedStructureIdsRef.current.add(`live-break-high-${tradeSymbol}-${symSmc.activeSwingHigh.time}-${symSmc.activeSwingHigh.price.toFixed(4)}`);
              }
              if (symSmc.activeSwingLow && symQuote <= symSmc.activeSwingLow.price) {
                tradedStructureIdsRef.current.add(`${tradeSymbol}-swing-low-${symSmc.activeSwingLow.time}-${symSmc.activeSwingLow.price.toFixed(4)}`);
                tradedStructureIdsRef.current.add(`live-break-low-${tradeSymbol}-${symSmc.activeSwingLow.time}-${symSmc.activeSwingLow.price.toFixed(4)}`);
              }
            }
          } else {
            // Post-martingale in progress (e.g. 1 of 2) OR Post-Martingale disabled:
            isPausedForMarket = false;
            storedCycleCount = isPauseActive ? nextCycleLossCount : 0;
            if (!isVirtualTrade && isPauseActive) {
              setRecoveryLockedMarket(lockedInfo);
              recoveryLockedMarketRef.current = lockedInfo;
            } else {
              setRecoveryLockedMarket(null);
              recoveryLockedMarketRef.current = null;
            }
            setCycleLossCount(storedCycleCount);
            cycleLossCountRef.current = storedCycleCount;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
            marketMinNextSignalCandleEpochRef.current[tradeSymbol] = 0;
            lastTradeDirectionRef.current = (finishedTrade.contractType === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT';
          }

          const updatedMState: MarketMartingaleState = {
            symbol: tradeSymbol,
            currentMartingaleStep: nextStep,
            accumulatedLoss: newAccumulatedLoss,
            cycleLossCount: storedCycleCount,
            isPausedAwaitingSignal: isPausedForMarket,
            lastTradeDirection: (finishedTrade.contractType === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT',
            lastLossStake: lossStake,
            updatedAt: Date.now(),
          };

          marketMartingaleStatesRef.current[tradeSymbol] = updatedMState;
          setMarketMartingaleStates((prev) => {
            const updated = { ...prev, [tradeSymbol]: updatedMState };
            autoRecoveryStorage.saveMarketMartingaleStates(updated);
            return updated;
          });

          autoRecoveryStorage.saveMartingaleState({
            cycleLossCount: cycleLossCountRef.current,
            isPausedAwaitingSignal: isPausedAwaitingSignalRef.current,
            currentPhase: currentPhaseRef.current,
            recoveryLockedMarket: recoveryLockedMarketRef.current,
            isInVirtualCount: isInVirtualCountRef.current,
            virtualCountLosses: virtualCountLossesRef.current,
          });

          const nextRecoveryStake = calculateCurrentStake(nextStep, newAccumulatedLoss, tradeSymbol);

          const threshold = Math.max(1, p.virtualCountThreshold ?? 3);
          const vCountIndivTag = Boolean(p.virtualCountEnabled) && virtualCountSwitchedToReal
            ? `[Virtual Count Target Hit (${threshold}/${threshold} Losses): Switched to REAL ACCOUNT] `
            : Boolean(p.virtualCountEnabled) && isInVirtualCountRef.current
            ? `[Virtual Count Loss ${virtualCountLossesRef.current}/${threshold}] `
            : (Boolean(p.virtualCountEnabled) && !isInVirtualCountRef.current)
            ? `[Real Account Trading] `
            : '';

          if (isPausedForMarket) {
            setBotStatusMessage(
              `${vCountIndivTag}[${mDef?.shortName || tradeSymbol} Post-Martingale Paused (${pauseLimit}/${pauseLimit} Losses)]: Paused${virtualCountSwitchedToReal ? ` (Switched to REAL Account)` : isVirtualTrade ? ` (Flat Virtual Stake $${(p.stake ?? 0.35).toFixed(2)})` : ` at Step ${nextStep} (-$${newAccumulatedLoss.toFixed(2)} loss)`}. Bot holding and awaiting next confirmed breakout signal on ${mDef?.shortName || tradeSymbol}${virtualCountSwitchedToReal ? ` (will execute on REAL account starting with DEFAULT BASE STAKE $${p.stake.toFixed(2)})` : ''}...`
            );
          } else {
            setBotStatusMessage(
              `${vCountIndivTag}[${mDef?.shortName || tradeSymbol} Loss #${nextCycleLossCount}/${pauseLimit}]: Trade #${contractId} lost at 59s (-$${lossStake.toFixed(2)}${finishedTrade.isVirtualTrade ? ' [Simulated]' : ''}). ${virtualCountSwitchedToReal ? `Switched to REAL ACCOUNT! Opening next trade immediately at 59s on ${mDef?.shortName || tradeSymbol} at DEFAULT BASE STAKE ($${p.stake.toFixed(2)})` : isVirtualTrade ? `Opening next virtual trade immediately at 59s ($${(p.stake ?? 0.35).toFixed(2)})` : `Opening Martingale Step ${nextStep} immediately at 59s on ${mDef?.shortName || tradeSymbol} ($${nextRecoveryStake.toFixed(2)} stake | -$${newAccumulatedLoss.toFixed(2)} total loss)`}...`
            );
          }

          const stoppedIndivByTpSl = !isVirtualRecord(resolvedFinishedTrade) ? checkTakeProfitAndStopLoss(resolvedSnapshot) : false;
          if (!stoppedIndivByTpSl && !isPausedForMarket && isAutoTradingRef.current && selectedStrategyRef.current.id === 'smc_structure_confluence' && !updatedMState.isPausedAwaitingSignal) {
            const reentryDir = (finishedTrade.contractType === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT';
            pending59sReentryMarketsRef.current.add(tradeSymbol);
            setTimeout(() => {
              pending59sReentryMarketsRef.current.delete(tradeSymbol);
              if (!isAutoTradingRef.current || selectedStrategyRef.current.id !== 'smc_structure_confluence' || marketMartingaleStatesRef.current[tradeSymbol]?.isPausedAwaitingSignal) return;
              if (checkTakeProfitAndStopLoss(tradeRecordsRef.current)) return;
              if (activeTradesRef.current.has(tradeSymbol) || executingMarketsRef.current.has(tradeSymbol)) return;
              marketPendingBreaksRef.current[tradeSymbol] = null;
              if (tradeSymbol === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
              const curSec = Math.floor(Date.now() / 1000);
              const symC = tradeSymbol === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbol];
              const curEpoch = symC && symC.length > 0 ? symC[symC.length - 1].epoch : (curSec - (curSec % 60));
              marketLastExecutedCandleEpochRef.current[tradeSymbol] = curEpoch;
              const smcNow = tradeSymbol === paramsRef.current.symbol ? latestSmcResultRef.current : marketSmcRef.current[tradeSymbol];
              const trendDir = smcNow?.currentTrend === 'BEARISH' ? 'PUT' : (smcNow?.currentTrend === 'BULLISH' ? 'CALL' : null);
              const chosenType: 'CALL' | 'PUT' = trendDir || reentryDir || lastTradeDirectionRef.current || 'CALL';
              const nextStakeNow = calculateCurrentStake(undefined, undefined, tradeSymbol);
              const targetDef = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbol) || { name: tradeSymbol, shortName: tradeSymbol };
              setBotStatusMessage(
                `[${targetDef.shortName} 59s Re-Entry]: Loss settled at 59s → Opening next Martingale trade immediately (${chosenType} @ $${nextStakeNow.toFixed(2)})...`
              );
              executeTradeRef.current(chosenType, nextStakeNow, undefined, tradeSymbol, targetDef.name);
            }, 0);
          }
          return;
        } else {

          const { totalLoss: cycleLossTotal, consecutiveCount } = calculateConsecutiveCycleLoss(
            tradeRecordsRef.current,
            finishedTrade.contractId
          );

          const nextRealLoss = !isTradeRecordVirtual(finishedTrade)
            ? realConsecutiveLossesRef.current + 1
            : realConsecutiveLossesRef.current;
          if (!isTradeRecordVirtual(finishedTrade)) {
            setRealConsecutiveLosses(nextRealLoss);
            realConsecutiveLossesRef.current = nextRealLoss;
          }

        const vHookEnabled = Boolean(p.virtualHookEnabled);
        const vThreshold = Math.max(1, p.virtualHookLossThreshold || 1);
        const shouldTriggerVirtualHook = vHookEnabled && !isTradeRecordVirtual(finishedTrade) && nextRealLoss >= vThreshold;

        // Virtual Switch Trigger Check (Box 1 = 1 loss, Box 2 = 2 losses, etc.)
        let shouldTriggerVirtualSwitch = false;
        if (p.virtualSwitchEnabled && !isTradeRecordVirtual(finishedTrade)) {
          const activeBoxes = Array.isArray(p.virtualSwitchBoxes) && p.virtualSwitchBoxes.length > 0
            ? [...p.virtualSwitchBoxes].sort((a, b) => a - b)
            : [1, 2, 3];

          let curBox = currentVirtualSwitchStageRef.current;
          if (!activeBoxes.includes(curBox)) {
            curBox = activeBoxes[0];
            setCurrentVirtualSwitchStage(curBox);
            currentVirtualSwitchStageRef.current = curBox;
          }

          const switchLossThreshold = curBox;
          if (nextRealLoss >= switchLossThreshold) {
            shouldTriggerVirtualSwitch = true;
            setIsInVirtualSwitch(true);
            isInVirtualSwitchRef.current = true;
            setVirtualSwitchLossCount(0);
            virtualSwitchLossCountRef.current = 0;
          }
        }

        if (shouldTriggerVirtualHook) {
          setIsInVirtualHook(true);
          isInVirtualHookRef.current = true;
          setVirtualHookLossCount(0);
          virtualHookLossCountRef.current = 0;
        }

        const isSwitchEngaged = shouldTriggerVirtualSwitch || (Boolean(p.virtualSwitchEnabled) && isInVirtualSwitchRef.current);
        const isHookEngaged = shouldTriggerVirtualHook || (Boolean(p.virtualHookEnabled) && isInVirtualHookRef.current);

        if (isSwitchEngaged || isHookEngaged) {
          const nextStep = Math.max(consecutiveCount, currentMartingaleStepRef.current + 1);
          const newAccumulatedLoss = Math.max(
            Number((accumulatedLossRef.current + lossStake).toFixed(2)),
            cycleLossTotal
          );
          setCurrentMartingaleStep(nextStep);
          currentMartingaleStepRef.current = nextStep;
          setAccumulatedLoss(newAccumulatedLoss);
          accumulatedLossRef.current = newAccumulatedLoss;

          const isPauseActive = p.pauseTradeEnabled !== false;
          const pauseLimit = Math.max(1, p.pauseLossThreshold ?? 2);
          const nextPhaseLossCount = cycleLossCountRef.current + 1;
          const currentPhaseNum = currentPhaseRef.current || 1;
          const tradeSymbol = finishedTrade.symbol || paramsRef.current.symbol;
          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbol);
          const lockedInfo = {
            symbol: tradeSymbol,
            symbolName: finishedTrade.symbolName || mDef?.name || tradeSymbol,
          };

          let lockedToStore: { symbol: string; symbolName: string } | null = null;
          let isPausedToStore = false;

          if (isPauseActive && nextPhaseLossCount >= pauseLimit) {
            if (multiMarketEnabledRef.current) {
              setRecoveryLockedMarket(null);
              recoveryLockedMarketRef.current = null;
              lockedToStore = null;
            } else {
              setRecoveryLockedMarket(lockedInfo);
              recoveryLockedMarketRef.current = lockedInfo;
              lockedToStore = lockedInfo;
            }
            setIsPausedAwaitingSignal(true);
            isPausedAwaitingSignalRef.current = true;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            pausedFromMarketRef.current = null;
            const nextPhaseHook = currentPhaseNum + 1;
            setCurrentPhase(nextPhaseHook);
            currentPhaseRef.current = nextPhaseHook;
            isPausedToStore = true;
          } else if (isPauseActive) {
            setCycleLossCount(nextPhaseLossCount);
            cycleLossCountRef.current = nextPhaseLossCount;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
            setRecoveryLockedMarket(lockedInfo);
            recoveryLockedMarketRef.current = lockedInfo;
            pausedFromMarketRef.current = null;
            lockedToStore = lockedInfo;
          } else {
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
          }

          const nowSec = Math.floor(Date.now() / 1000);
          const secondInCandle = nowSec % 60;
          const wallCandleEpoch = nowSec - secondInCandle;
          const lossSymCandlesHS = tradeSymbol === p.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbol];
          const latestCandleEpochHS = lossSymCandlesHS && lossSymCandlesHS.length > 0
            ? lossSymCandlesHS[lossSymCandlesHS.length - 1].epoch
            : wallCandleEpoch;
          const effectiveSettleEpochHS = Math.max(latestCandleEpochHS, wallCandleEpoch);
          const nextFreshEpochHS = secondInCandle <= 5 ? effectiveSettleEpochHS : effectiveSettleEpochHS + 60;
          if (selectedStrategyRef.current.id !== 'continuous_trade') {
            lastExecutedCandleEpochRef.current = secondInCandle > 5 ? effectiveSettleEpochHS : effectiveSettleEpochHS - 60;
            marketLastExecutedCandleEpochRef.current[tradeSymbol] = secondInCandle > 5 ? effectiveSettleEpochHS : effectiveSettleEpochHS - 60;
            minNextSignalCandleEpochRef.current = nextFreshEpochHS;
            marketMinNextSignalCandleEpochRef.current[tradeSymbol] = nextFreshEpochHS;
          } else {
            minNextSignalCandleEpochRef.current = isPausedToStore ? nextFreshEpochHS : 0;
            marketMinNextSignalCandleEpochRef.current[tradeSymbol] = isPausedToStore ? nextFreshEpochHS : 0;
          }

          pendingStructureBreakRef.current = null;
          marketPendingBreaksRef.current = {};
          if (latestSmcResultRef.current?.structures) {
            latestSmcResultRef.current.structures.forEach((s) => {
              if (s.breakTime < nextFreshEpochHS) {
                tradedStructureIdsRef.current.add(s.id);
              }
            });
          }
          Object.keys(marketSmcRef.current).forEach((sym) => {
            const smc = marketSmcRef.current[sym];
            if (smc?.structures) {
              smc.structures.forEach((s) => {
                if (s.breakTime < nextFreshEpochHS) {
                  tradedStructureIdsRef.current.add(s.id);
                }
              });
            }
          });

          if (isSwitchEngaged) {
            const curBox = currentVirtualSwitchStageRef.current;
            setIsInVirtualSwitch(true);
            isInVirtualSwitchRef.current = true;
            setVirtualSwitchLossCount(0);
            virtualSwitchLossCountRef.current = 0;

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: nextStep,
              cycleLossCount: cycleLossCountRef.current,
              isPausedAwaitingSignal: isPausedToStore,
              recoveryLockedMarket: lockedToStore,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: newAccumulatedLoss,
              currentPhase: currentPhaseRef.current,
              isInVirtualSwitch: true,
              virtualSwitchLossCount: 0,
              realConsecutiveLosses: nextRealLoss,
              currentVirtualSwitchStage: curBox,
              isInVirtualCount: isInVirtualCountRef.current,
              virtualCountLosses: virtualCountLossesRef.current,
            });

            setBotStatusMessage(
              `[Virtual Switch Engaged]: Real trade #${contractId} LOST (-$${lossStake.toFixed(2)}). Hit threshold of ${nextRealLoss}/${curBox} consecutive real loss(es). Switched to VIRTUAL TRADING to protect real capital! The bot will continue scanning markets and trading in virtual until 1 Virtual Win occurs...`
            );
            checkTakeProfitAndStopLoss(resolvedSnapshot);
            return;
          }

          if (isHookEngaged) {
            setIsInVirtualHook(true);
            isInVirtualHookRef.current = true;
            setVirtualHookLossCount(0);
            virtualHookLossCountRef.current = 0;

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: nextStep,
              cycleLossCount: cycleLossCountRef.current,
              isPausedAwaitingSignal: isPausedToStore,
              recoveryLockedMarket: lockedToStore,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: newAccumulatedLoss,
              currentPhase: currentPhaseRef.current,
              isInVirtualHook: true,
              virtualHookLossCount: 0,
              realConsecutiveLosses: nextRealLoss,
              isInVirtualCount: isInVirtualCountRef.current,
              virtualCountLosses: virtualCountLossesRef.current,
            });

            setBotStatusMessage(
              `[Virtual Hook Engaged]: Real trade #${contractId} LOST (-$${lossStake.toFixed(2)}). Hit threshold of ${nextRealLoss}/${vThreshold} consecutive real loss(es). Switched to VIRTUAL HOOK to protect real capital! The bot will continue scanning markets and trading in virtual until 1 Virtual Win occurs...`
            );
            checkTakeProfitAndStopLoss(resolvedSnapshot);
            return;
          }
        }

        if (p.inInterModeEnabled && !isTradeRecordVirtual(finishedTrade)) {
          const switchThreshold = Math.max(1, p.consecutivesToSwitchMode || 3);
          const modes = Array.isArray(p.modesConfig) && p.modesConfig.length === 10
            ? p.modesConfig
            : DEFAULT_IN_INTER_MODES;
          const currentModeVal = currentModeRef.current;
          let modeStatusNote = '';

          if (currentModeVal === 0) {
            // Currently in Default Mode (Mode 0)
            const nextDefaultLossCount = defaultModeLossCountRef.current + 1;
            const nextStep = Math.max(consecutiveCount, currentMartingaleStepRef.current + 1);
            const newTotalSeqLoss = Math.max(
              Number((accumulatedLossRef.current + lossStake).toFixed(2)),
              cycleLossTotal
            );

            setAccumulatedLoss(newTotalSeqLoss);
            accumulatedLossRef.current = newTotalSeqLoss;
            setCurrentMartingaleStep(nextStep);
            currentMartingaleStepRef.current = nextStep;

            // Check if consecutive losses in Default Mode hit threshold to switch to Mode 1
            if (nextDefaultLossCount >= switchThreshold) {
              const mode1Config = modes[0];
              const mode1FirstStake = roundInInterStake(
                p.stake * (mode1Config.interModeMartingale || 1.5)
              );

              setDefaultModeLossCount(0);
              defaultModeLossCountRef.current = 0;
              setCurrentMode(1);
              currentModeRef.current = 1;
              setInModeLossCount(0);
              inModeLossCountRef.current = 0;
              setModeFirstStake(mode1FirstStake);
              modeFirstStakeRef.current = mode1FirstStake;
              setModeAccumulatedLoss(newTotalSeqLoss);
              modeAccumulatedLossRef.current = newTotalSeqLoss;

              modeStatusNote = `[Switch to Mode 1]: Hit ${nextDefaultLossCount}/${switchThreshold} consecutive losses in Default Mode (-$${newTotalSeqLoss.toFixed(2)} total loss). Shifted to Mode 1! 1st stake = $${p.stake.toFixed(2)} × ${mode1Config.interModeMartingale}x = $${mode1FirstStake.toFixed(2)}.`;
            } else {
              // Stay in Default Mode using standard Martingale progression
              setDefaultModeLossCount(nextDefaultLossCount);
              defaultModeLossCountRef.current = nextDefaultLossCount;
              modeStatusNote = `Trade #${contractId} LOST (-$${lossStake.toFixed(2)}). Default Mode Loss ${nextDefaultLossCount}/${switchThreshold} (-$${newTotalSeqLoss.toFixed(2)} loss). Continuing Default Mode Martingale.`;
            }
          } else {
            // Currently inside Mode 1 to Mode 10
            const mode = currentModeVal;
            const modeConfig = modes[mode - 1];
            const nextInModeLoss = inModeLossCountRef.current + 1;
            const nextStep = currentMartingaleStepRef.current + 1;
            const baseSeqLoss = Math.max(modeAccumulatedLossRef.current, accumulatedLossRef.current);
            const newSeqLoss = Number((baseSeqLoss + lossStake).toFixed(2));

            setModeAccumulatedLoss(newSeqLoss);
            modeAccumulatedLossRef.current = newSeqLoss;
            setAccumulatedLoss(newSeqLoss);
            accumulatedLossRef.current = newSeqLoss;
            setCurrentMartingaleStep(nextStep);
            currentMartingaleStepRef.current = nextStep;

            // Compute current mode's 1st stake accurately (chained if ref wasn't set)
            let fallbackFirst = p.stake;
            for (let m = 0; m < mode; m++) {
              fallbackFirst = roundInInterStake(
                fallbackFirst * (modes[m]?.interModeMartingale || 1.5)
              );
            }
            const currentModeFirstStake = modeFirstStakeRef.current > 0
              ? modeFirstStakeRef.current
              : fallbackFirst;

            // Check if consecutive losses within this mode reached switchThreshold
            if (nextInModeLoss >= switchThreshold) {
              if (mode < 10) {
                const nextMode = mode + 1;
                const nextConfig = modes[nextMode - 1];
                // Multiply PREVIOUS mode's 1st stake by the next mode's Inter-Mode Martingale!
                const nextFirstStake = roundInInterStake(
                  currentModeFirstStake * (nextConfig.interModeMartingale || 1.5)
                );

                setCurrentMode(nextMode);
                currentModeRef.current = nextMode;
                setInModeLossCount(0);
                inModeLossCountRef.current = 0;
                setModeFirstStake(nextFirstStake);
                modeFirstStakeRef.current = nextFirstStake;

                modeStatusNote = `[Shift to Mode ${nextMode}]: Mode ${mode} hit ${nextInModeLoss}/${switchThreshold} consecutive losses (-$${newSeqLoss.toFixed(2)} total loss). Shifted to Mode ${nextMode}! 1st stake = $${currentModeFirstStake.toFixed(2)} × ${nextConfig.interModeMartingale}x = $${nextFirstStake.toFixed(2)}.`;
              } else {
                // Mode 10 limit reached
                const maxAction = p.maxMartingaleAction || 'stop';
                if (maxAction === 'stop') {
                  setIsAutoTrading(false);
                  isAutoTradingRef.current = false;
                  autoRecoveryStorage.saveAutoTradingState(false);
                  setBotStatusMessage(
                    `[Max Mode 10 Reached]: Mode 10 reached ${nextInModeLoss}/${switchThreshold} consecutive losses (-$${newSeqLoss.toFixed(2)} total loss). Auto-trading STOPPED as configured for capital protection.`
                  );
                  autoRecoveryStorage.saveMartingaleState({
                    currentMartingaleStep: nextStep,
                    cycleLossCount: cycleLossCountRef.current,
                    isPausedAwaitingSignal: false,
                    recoveryLockedMarket: null,
                    startingBalance: startingBalanceRef.current,
                    accumulatedLoss: newSeqLoss,
                    currentPhase: currentPhaseRef.current,
                    currentMode: mode,
                    defaultModeLossCount: defaultModeLossCountRef.current,
                    inModeLossCount: nextInModeLoss,
                    modeFirstStake: currentModeFirstStake,
                    modeAccumulatedLoss: newSeqLoss,
                  });
                  checkTakeProfitAndStopLoss(resolvedSnapshot);
                  return;
                } else {
                  setCurrentMode(0);
                  currentModeRef.current = 0;
                  setDefaultModeLossCount(0);
                  defaultModeLossCountRef.current = 0;
                  setInModeLossCount(0);
                  inModeLossCountRef.current = 0;
                  setModeFirstStake(0);
                  modeFirstStakeRef.current = 0;
                  setModeAccumulatedLoss(0);
                  modeAccumulatedLossRef.current = 0;
                  setCurrentMartingaleStep(0);
                  currentMartingaleStepRef.current = 0;
                  setAccumulatedLoss(0);
                  accumulatedLossRef.current = 0;
                  setCycleLossCount(0);
                  cycleLossCountRef.current = 0;
                  setCurrentPhase(1);
                  currentPhaseRef.current = 1;
                  setIsPausedAwaitingSignal(false);
                  isPausedAwaitingSignalRef.current = false;
                  setRecoveryLockedMarket(null);
                  recoveryLockedMarketRef.current = null;

                  autoRecoveryStorage.saveMartingaleState({
                    currentMartingaleStep: 0,
                    cycleLossCount: 0,
                    isPausedAwaitingSignal: false,
                    recoveryLockedMarket: null,
                    startingBalance: startingBalanceRef.current,
                    accumulatedLoss: 0,
                    currentPhase: 1,
                    currentMode: 0,
                    defaultModeLossCount: 0,
                    inModeLossCount: 0,
                    modeFirstStake: 0,
                    modeAccumulatedLoss: 0,
                  });

                  setBotStatusMessage(
                    `[Max Mode 10 Reached]: Mode 10 reached ${nextInModeLoss}/${switchThreshold} consecutive losses. RESET to Default Mode and base stake ($${p.stake.toFixed(2)}) as configured.`
                  );
                  checkTakeProfitAndStopLoss(resolvedSnapshot);
                  return;
                }
              }
            } else {
              // Stay in current mode, increment inModeLossCount & apply In-Mode Martingale
              setInModeLossCount(nextInModeLoss);
              inModeLossCountRef.current = nextInModeLoss;

              const inMult = modeConfig.inModeMartingale || 1.4;
              let nextInModeStake = currentModeFirstStake;
              for (let i = 0; i < nextInModeLoss; i++) {
                nextInModeStake = roundInInterStake(nextInModeStake * inMult);
              }

              modeStatusNote = `Trade #${contractId} LOST (-$${lossStake.toFixed(2)}). Mode ${mode} In-Mode Loss ${nextInModeLoss}/${switchThreshold}. Applying In-Mode Martingale (${inMult}x) → Next Stake: $${nextInModeStake.toFixed(2)} (Loss to recover: $${newSeqLoss.toFixed(2)}).`;
            }
          }

          // Respect Post-Martingale (Pause Trade on Consecutive Losses) cleanly with In-Mode & Inter-Mode!
          const isPauseActiveInInter = p.pauseTradeEnabled !== false;
          const pauseLimitInInter = Math.max(1, p.pauseLossThreshold ?? 2);
          const nextPhaseLossCountInInter = cycleLossCountRef.current + 1;
          const currentPhaseNumInInter = currentPhaseRef.current || 1;
          const tradeSymbolInInter = finishedTrade.symbol || p.symbol;
          const mDefInInter = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbolInInter);
          const lockedInfoInInter = {
            symbol: tradeSymbolInInter,
            symbolName: finishedTrade.symbolName || mDefInInter?.name || tradeSymbolInInter,
          };
          const tradeDirInInter = (finishedTrade.contractType === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT';
          lastTradeDirectionRef.current = tradeDirInInter;

          const nowSecInInter = Math.floor(Date.now() / 1000);
          const secondInCandleInInter = nowSecInInter % 60;
          const wallCandleEpochInInter = nowSecInInter - secondInCandleInInter;
          const lossSymCandlesInInter = tradeSymbolInInter === p.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbolInInter];
          const latestCandleEpochInInter = lossSymCandlesInInter && lossSymCandlesInInter.length > 0
            ? lossSymCandlesInInter[lossSymCandlesInInter.length - 1].epoch
            : wallCandleEpochInInter;
          const effectiveSettleEpochInInter = Math.max(latestCandleEpochInInter, wallCandleEpochInInter);
          const nextFreshEpochInInter = secondInCandleInInter <= 5 ? effectiveSettleEpochInInter : effectiveSettleEpochInInter + 60;

          if (isPauseActiveInInter && nextPhaseLossCountInInter >= pauseLimitInInter) {
            if (selectedStrategyRef.current.id !== 'continuous_trade') {
              const executedEpochMark = secondInCandleInInter > 5 ? effectiveSettleEpochInInter : effectiveSettleEpochInInter - 60;
              lastExecutedCandleEpochRef.current = executedEpochMark;
              marketLastExecutedCandleEpochRef.current[tradeSymbolInInter] = executedEpochMark;
            }
            const nextPhase = currentPhaseNumInInter + 1;
            setCurrentPhase(nextPhase);
            currentPhaseRef.current = nextPhase;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
            pausedFromMarketRef.current = null;
            setIsPausedAwaitingSignal(true);
            isPausedAwaitingSignalRef.current = true;

            minNextSignalCandleEpochRef.current = nextFreshEpochInInter;
            marketMinNextSignalCandleEpochRef.current[tradeSymbolInInter] = nextFreshEpochInInter;

            pendingStructureBreakRef.current = null;
            marketPendingBreaksRef.current = {};

            if (latestSmcResultRef.current?.structures) {
              latestSmcResultRef.current.structures.forEach((s) => {
                if (s.breakTime < nextFreshEpochInInter) {
                  tradedStructureIdsRef.current.add(s.id);
                }
              });
            }
            Object.keys(marketSmcRef.current).forEach((sym) => {
              const smc = marketSmcRef.current[sym];
              if (smc?.structures) {
                smc.structures.forEach((s) => {
                  if (s.breakTime < nextFreshEpochInInter) {
                    tradedStructureIdsRef.current.add(s.id);
                  }
                });
              }
            });
            // Mark already-breached active swing levels so paused mode requires a genuinely NEW break
            const checkSymsInter = multiMarketEnabledRef.current ? selectedMarketsRef.current : [p.symbol];
            checkSymsInter.forEach((sym) => {
              const bgSmc = sym === p.symbol ? latestSmcResultRef.current : marketSmcRef.current[sym];
              const q =
                sym === p.symbol && ticksRef.current.length > 0
                  ? ticksRef.current[ticksRef.current.length - 1].quote
                  : marketTicksRef.current[sym]?.quote;
              if (bgSmc && q !== undefined && q !== null) {
                if (bgSmc.activeSwingHigh && q >= bgSmc.activeSwingHigh.price) {
                  tradedStructureIdsRef.current.add(`${sym}-swing-high-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`);
                  tradedStructureIdsRef.current.add(`live-break-high-${sym}-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`);
                }
                if (bgSmc.activeSwingLow && q <= bgSmc.activeSwingLow.price) {
                  tradedStructureIdsRef.current.add(`${sym}-swing-low-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`);
                  tradedStructureIdsRef.current.add(`live-break-low-${sym}-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`);
                }
              }
            });

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: currentMartingaleStepRef.current,
              cycleLossCount: 0,
              isPausedAwaitingSignal: true,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: accumulatedLossRef.current,
              currentPhase: nextPhase,
              currentMode: currentModeRef.current,
              defaultModeLossCount: defaultModeLossCountRef.current,
              inModeLossCount: inModeLossCountRef.current,
              modeFirstStake: modeFirstStakeRef.current,
              modeAccumulatedLoss: modeAccumulatedLossRef.current,
              isInVirtualHook: isInVirtualHookRef.current,
              virtualHookLossCount: virtualHookLossCountRef.current,
              isInVirtualCount: isInVirtualCountRef.current,
              virtualCountLosses: virtualCountLossesRef.current,
            });

            const nextStakeOnResume = calculateCurrentStake();
            setBotStatusMessage(
              `${modeStatusNote} [Post-Martingale Limit Reached (${pauseLimitInInter}/${pauseLimitInInter} Losses)]: Paused next-candle re-entry. Awaiting a NEW Break of Structure or CHoCH signal from any volatility to resume Mode ${currentModeRef.current} ($${nextStakeOnResume.toFixed(2)} stake)...`
            );
            checkTakeProfitAndStopLoss(resolvedSnapshot);
            return;
          }

          if (isPauseActiveInInter) {
            setCycleLossCount(nextPhaseLossCountInInter);
            cycleLossCountRef.current = nextPhaseLossCountInInter;
            setRecoveryLockedMarket(lockedInfoInInter);
            recoveryLockedMarketRef.current = lockedInfoInInter;
          } else {
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
          }
          setIsPausedAwaitingSignal(false);
          isPausedAwaitingSignalRef.current = false;
          pausedFromMarketRef.current = null;

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: currentMartingaleStepRef.current,
            cycleLossCount: cycleLossCountRef.current,
            isPausedAwaitingSignal: false,
            recoveryLockedMarket: recoveryLockedMarketRef.current,
            startingBalance: startingBalanceRef.current,
            accumulatedLoss: accumulatedLossRef.current,
            currentPhase: currentPhaseNumInInter,
            currentMode: currentModeRef.current,
            defaultModeLossCount: defaultModeLossCountRef.current,
            inModeLossCount: inModeLossCountRef.current,
            modeFirstStake: modeFirstStakeRef.current,
            modeAccumulatedLoss: modeAccumulatedLossRef.current,
            isInVirtualHook: isInVirtualHookRef.current,
            virtualHookLossCount: virtualHookLossCountRef.current,
            isInVirtualCount: isInVirtualCountRef.current,
            virtualCountLosses: virtualCountLossesRef.current,
          });

          setBotStatusMessage(
            isPauseActiveInInter
              ? `[Attempt ${nextPhaseLossCountInInter}/${pauseLimitInInter} Lost] ${modeStatusNote}`
              : modeStatusNote
          );

          const stoppedInInterByTpSl = checkTakeProfitAndStopLoss(resolvedSnapshot);
          if (!stoppedInInterByTpSl && isAutoTradingRef.current && selectedStrategyRef.current.id === 'smc_structure_confluence' && !isPausedAwaitingSignalRef.current) {
            const reentrySym = finishedTrade.symbol || p.symbol;
            const reentryDir = tradeDirInInter;
            pending59sReentryMarketsRef.current.add(reentrySym);
            setTimeout(() => {
              pending59sReentryMarketsRef.current.delete(reentrySym);
              if (!isAutoTradingRef.current || selectedStrategyRef.current.id !== 'smc_structure_confluence' || isPausedAwaitingSignalRef.current) return;
              if (checkTakeProfitAndStopLoss(tradeRecordsRef.current)) return;
              if (activeTradeRef.current || activeTradesRef.current.size > 0 || isExecutingTradeRef.current || isTradePendingRef.current) return;
              marketPendingBreaksRef.current[reentrySym] = null;
              if (reentrySym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
              const curSec = Math.floor(Date.now() / 1000);
              const symC = reentrySym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[reentrySym];
              const curEpoch = symC && symC.length > 0 ? symC[symC.length - 1].epoch : (curSec - (curSec % 60));
              lastExecutedCandleEpochRef.current = curEpoch;
              marketLastExecutedCandleEpochRef.current[reentrySym] = curEpoch;
              const smcNow = reentrySym === paramsRef.current.symbol ? latestSmcResultRef.current : marketSmcRef.current[reentrySym];
              const trendDir = smcNow?.currentTrend === 'BEARISH' ? 'PUT' : (smcNow?.currentTrend === 'BULLISH' ? 'CALL' : null);
              const chosenType: 'CALL' | 'PUT' = trendDir || reentryDir || lastTradeDirectionRef.current || 'CALL';
              const nextStakeNow = calculateCurrentStake();
              const targetDef = VOLATILITY_MARKETS.find((m) => m.symbol === reentrySym) || { name: reentrySym, shortName: reentrySym };
              setBotStatusMessage(
                `[${targetDef.shortName} 59s Re-Entry]: Loss settled at 59s → Opening Mode ${currentModeRef.current} trade immediately (${chosenType} @ $${nextStakeNow.toFixed(2)})...`
              );
              executeTradeRef.current(chosenType, nextStakeNow, undefined, reentrySym, targetDef.name);
            }, 0);
          }
          return;
        }

        // Standard Martingale progression when inInterModeEnabled is false
        const isVirtual = Boolean(p.virtualHookEnabled || p.virtualSwitchEnabled || p.virtualCountEnabled) && isTradeRecordVirtual(finishedTrade);
        // Virtual trades strictly use default flat stake (0.35); Martingale only kicks in on real trading!
        // When a virtual trade loses, it does NOT alter or wipe real accumulated loss or real Martingale step!
        let nextStep = isVirtual ? currentMartingaleStepRef.current : Math.max(consecutiveCount, currentMartingaleStepRef.current + 1);
        let newAccumulatedLoss = isVirtual ? accumulatedLossRef.current : Math.max(
          Number((accumulatedLossRef.current + lossStake).toFixed(2)),
          cycleLossTotal
        );
        let nextStakeToExecute: number;

        if (isVirtual) {
          nextStakeToExecute = p.stake ?? 0.35;
        } else if (correctedWinCreditRef.current > 0) {
          const profitCredit = correctedWinCreditRef.current;
          correctedWinCreditRef.current = 0; // consumed

          // Subtract the profit made from the corrected win to recover only the exact net loss
          const netLoss = Math.max(0, Number((lossStake - profitCredit).toFixed(2)));
          newAccumulatedLoss = netLoss;

          const payoutRate = (p.autoMartingalePayoutPercent || 83) / 100;
          const targetRecovery = Math.max(
            Number(p.stake.toFixed(2)),
            Math.ceil(((netLoss + p.stake * payoutRate) / payoutRate) * 100) / 100
          );
          nextStakeToExecute = targetRecovery;

          // Calibrate step for this net loss stake
          const factor = Math.max(1.05, p.multiplier);
          nextStep = Math.max(1, Math.round(Math.log(targetRecovery / p.stake) / Math.log(factor)));
        } else if (p.autoMartingaleEnabled) {
          const payoutRate = (p.autoMartingalePayoutPercent || 83) / 100;
          const requiredStake = Math.ceil((newAccumulatedLoss / payoutRate) * 100) / 100;
          nextStakeToExecute = Math.max(
            Number(p.stake.toFixed(2)),
            Number(requiredStake.toFixed(2))
          );
        } else {
          const rawMultiplier = Math.pow(p.multiplier, nextStep);
          const calculatedMultiplierStake = Number((p.stake * rawMultiplier).toFixed(2));
          // Strictly apply Martingale multiplier to the lost stake: NEVER repeat the same stake on a loss!
          const strictlyMultipliedStake = Number((finishedTrade.stake * p.multiplier).toFixed(2));
          nextStakeToExecute = Math.max(calculatedMultiplierStake, strictlyMultipliedStake);
        }

        if (!isVirtual) {
          setCurrentMartingaleStep(nextStep);
          currentMartingaleStepRef.current = nextStep;
          setAccumulatedLoss(newAccumulatedLoss);
          accumulatedLossRef.current = newAccumulatedLoss;
        }

        const maxMartingaleLimit = Math.max(1, p.maxMultiplier || 5);
        const maxAction = p.maxMartingaleAction || 'stop';

        // Check if Max Martingale consecutive losses limit reached! Only applies to real trading!
        if (!isVirtual && nextStep >= maxMartingaleLimit) {
          if (maxAction === 'stop') {
            setIsAutoTrading(false);
            isAutoTradingRef.current = false;
            autoRecoveryStorage.saveAutoTradingState(false);
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: nextStep,
              cycleLossCount: nextStep,
              isPausedAwaitingSignal: false,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: newAccumulatedLoss,
              currentPhase: currentPhaseRef.current,
            });

            setBotStatusMessage(
              `[Max Martingale Reached (${nextStep}/${maxMartingaleLimit} Losses)]: Reached ${maxMartingaleLimit} consecutive martingale losses (-$${newAccumulatedLoss.toFixed(2)} total loss). Auto-trading STOPPED as configured for capital protection.`
            );
            if (!isVirtualRecord(resolvedFinishedTrade)) checkTakeProfitAndStopLoss(resolvedSnapshot);
            return;
          } else {
            // Reset to default stake!
            setCurrentMartingaleStep(0);
            currentMartingaleStepRef.current = 0;
            setAccumulatedLoss(0);
            accumulatedLossRef.current = 0;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            setCurrentPhase(1);
            currentPhaseRef.current = 1;
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
            setIsPausedAwaitingSignal(false);
            isPausedAwaitingSignalRef.current = false;
            autoRecoveryStorage.clearCorrectedLossItems();
            setCorrectedLossItems([]);

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: 0,
              cycleLossCount: 0,
              isPausedAwaitingSignal: false,
              recoveryLockedMarket: null,
              startingBalance: startingBalanceRef.current,
              accumulatedLoss: 0,
              currentPhase: 1,
            });

            setBotStatusMessage(
              `[Max Martingale Reached (${nextStep}/${maxMartingaleLimit} Losses)]: Reached ${maxMartingaleLimit} consecutive martingale losses. RESET to default stake ($${p.stake.toFixed(2)}) as configured. Bot continuing trading at base stake.`
            );
            if (!isVirtualRecord(resolvedFinishedTrade)) checkTakeProfitAndStopLoss(resolvedSnapshot);
            return;
          }
        }

        const isPauseActive = p.pauseTradeEnabled !== false;
        const pauseLimit = Math.max(1, p.pauseLossThreshold ?? 2);
        // Post-Martingale MUST apply to ALL trades (both Virtual and Real)!
        const nextPhaseLossCount = cycleLossCountRef.current + 1;
        const currentPhaseNum = currentPhaseRef.current || 1;
        const tradeSymbol = finishedTrade.symbol || paramsRef.current.symbol;
        const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbol);
        const lockedInfo = {
          symbol: tradeSymbol,
          symbolName: finishedTrade.symbolName || mDef?.name || tradeSymbol,
        };
        const threshold = Math.max(1, p.virtualCountThreshold ?? 3);

        const nowSec = Math.floor(Date.now() / 1000);
        const secondInCandle = nowSec % 60;
        const wallCandleEpoch = nowSec - secondInCandle;
        const lossSymCandles = tradeSymbol === p.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbol];
        const latestCandleEpoch = lossSymCandles && lossSymCandles.length > 0
          ? lossSymCandles[lossSymCandles.length - 1].epoch
          : wallCandleEpoch;
        const effectiveSettleEpoch = Math.max(latestCandleEpoch, wallCandleEpoch);
        const nextFreshEpoch = secondInCandle <= 5 ? effectiveSettleEpoch : effectiveSettleEpoch + 60;

        if (isPauseActive && nextPhaseLossCount >= pauseLimit) {
          // Reached the Post-Martingale pause limit (e.g. 1/1 or 2/2 losses) across virtual or real trades!
          if (selectedStrategyRef.current.id !== 'continuous_trade') {
            const executedEpochMark = secondInCandle > 5 ? effectiveSettleEpoch : effectiveSettleEpoch - 60;
            lastExecutedCandleEpochRef.current = executedEpochMark;
            marketLastExecutedCandleEpochRef.current[tradeSymbol] = executedEpochMark;
          }
          const nextPhase = currentPhaseNum + 1;
          setCurrentPhase(nextPhase);
          currentPhaseRef.current = nextPhase;
          setCycleLossCount(0);
          cycleLossCountRef.current = 0;
          // Completed post-martingale pause limit: unlock so bot waits for a NEW signal across allowed markets
          setRecoveryLockedMarket(null);
          recoveryLockedMarketRef.current = null;
          pausedFromMarketRef.current = null;
          setIsPausedAwaitingSignal(true);
          isPausedAwaitingSignalRef.current = true;

          // Prevent immediate re-entry from the loss candle
          minNextSignalCandleEpochRef.current = nextFreshEpoch;
          marketMinNextSignalCandleEpochRef.current[tradeSymbol] = nextFreshEpoch;

          // Discard any armed/pending breaks
          pendingStructureBreakRef.current = null;
          marketPendingBreaksRef.current = {};

          // Invalidate past structures up to the paused candle
          if (latestSmcResultRef.current?.structures) {
            latestSmcResultRef.current.structures.forEach((s) => {
              if (s.breakTime < nextFreshEpoch) {
                tradedStructureIdsRef.current.add(s.id);
              }
            });
          }
          Object.keys(marketSmcRef.current).forEach((sym) => {
            const smc = marketSmcRef.current[sym];
            if (smc?.structures) {
              smc.structures.forEach((s) => {
                if (s.breakTime < nextFreshEpoch) {
                  tradedStructureIdsRef.current.add(s.id);
                }
              });
            }
          });
          // Mark already-breached active swing levels so paused mode requires a genuinely NEW break
          const checkSymsStd = multiMarketEnabledRef.current ? selectedMarketsRef.current : [p.symbol];
          checkSymsStd.forEach((sym) => {
            const bgSmc = sym === p.symbol ? latestSmcResultRef.current : marketSmcRef.current[sym];
            const q =
              sym === p.symbol && ticksRef.current.length > 0
                ? ticksRef.current[ticksRef.current.length - 1].quote
                : marketTicksRef.current[sym]?.quote;
            if (bgSmc && q !== undefined && q !== null) {
              if (bgSmc.activeSwingHigh && q >= bgSmc.activeSwingHigh.price) {
                tradedStructureIdsRef.current.add(`${sym}-swing-high-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`);
                tradedStructureIdsRef.current.add(`live-break-high-${sym}-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`);
              }
              if (bgSmc.activeSwingLow && q <= bgSmc.activeSwingLow.price) {
                tradedStructureIdsRef.current.add(`${sym}-swing-low-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`);
                tradedStructureIdsRef.current.add(`live-break-low-${sym}-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`);
              }
            }
          });

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: nextStep,
            cycleLossCount: 0,
            isPausedAwaitingSignal: true,
            recoveryLockedMarket: null,
            startingBalance: startingBalanceRef.current,
            accumulatedLoss: newAccumulatedLoss,
            currentPhase: nextPhase,
            isInVirtualCount: isInVirtualCountRef.current,
            virtualCountLosses: virtualCountLossesRef.current,
          });

          const pauseModeStr = virtualCountSwitchedToReal
            ? `REAL account starting with DEFAULT BASE STAKE $${(p.stake ?? 0.35).toFixed(2)}`
            : isVirtual
            ? `Virtual flat stake $${(p.stake ?? 0.35).toFixed(2)}`
            : p.autoMartingaleEnabled
            ? `Auto Martingale 83% ($${newAccumulatedLoss.toFixed(2)} total loss)`
            : `Step ${nextStep} ($${nextStakeToExecute.toFixed(2)} stake)`;

          const vCountTag = Boolean(p.virtualCountEnabled) && virtualCountSwitchedToReal
            ? `[Virtual Count Target Hit (${threshold}/${threshold} Losses): Switched to REAL ACCOUNT] `
            : Boolean(p.virtualCountEnabled) && isInVirtualCountRef.current
            ? `[Virtual Count Loss ${virtualCountLossesRef.current}/${threshold}] `
            : (Boolean(p.virtualCountEnabled) && !isInVirtualCountRef.current)
            ? `[Real Account Trading] `
            : '';

          setBotStatusMessage(
            `${vCountTag}[Post-Martingale Limit Reached (${pauseLimit}/${pauseLimit} Losses)]: Paused${virtualCountSwitchedToReal ? ` (Switched to REAL Account)` : isVirtual ? ` (Flat Virtual Stake $${(p.stake ?? 0.35).toFixed(2)})` : ` at Step ${nextStep} (-$${newAccumulatedLoss.toFixed(2)} loss)`}. Bot paused next-candle re-entry. Awaiting a NEW Break of Structure or CHoCH signal from any volatility to resume (${pauseModeStr})...`
          );
          if (!isVirtualRecord(resolvedFinishedTrade)) checkTakeProfitAndStopLoss(resolvedSnapshot);
          return;
        } else {
          // Within pause attempts (e.g. Attempt 1 of 2, or 2 of 3) OR Post-Martingale OFF:
          const storedCycleCount = isPauseActive ? nextPhaseLossCount : 0;
          setCycleLossCount(storedCycleCount);
          cycleLossCountRef.current = storedCycleCount;
          if (!isVirtual && isPauseActive) {
            setRecoveryLockedMarket(lockedInfo);
            recoveryLockedMarketRef.current = lockedInfo;
          } else {
            setRecoveryLockedMarket(null);
            recoveryLockedMarketRef.current = null;
          }
          setIsPausedAwaitingSignal(false);
          isPausedAwaitingSignalRef.current = false;
          pausedFromMarketRef.current = null;

          const tradeDir = (finishedTrade.contractType === 'PUT' ? 'PUT' : 'CALL') as 'CALL' | 'PUT';
          lastTradeDirectionRef.current = tradeDir;

          autoRecoveryStorage.saveMartingaleState({
            currentMartingaleStep: nextStep,
            cycleLossCount: storedCycleCount,
            isPausedAwaitingSignal: false,
            recoveryLockedMarket: !isVirtual && isPauseActive ? lockedInfo : null,
            startingBalance: startingBalanceRef.current,
            accumulatedLoss: newAccumulatedLoss,
            currentPhase: currentPhaseNum,
            realConsecutiveLosses: nextRealLoss,
            currentVirtualSwitchStage: currentVirtualSwitchStageRef.current,
            virtualSwitchStageProfit: virtualSwitchStageProfitRef.current,
            isInVirtualCount: isInVirtualCountRef.current,
            virtualCountLosses: virtualCountLossesRef.current,
          });

          const recoveryModeText = p.autoMartingaleEnabled
            ? `Auto Martingale 83% ($${newAccumulatedLoss.toFixed(2)} loss)`
            : `Step ${nextStep} (${p.multiplier}x Multiplier)`;

          const curBox = currentVirtualSwitchStageRef.current;
          const switchInfo = p.virtualSwitchEnabled
            ? ` [Box ${curBox} Loss ${nextRealLoss}/${curBox}: Stays on REAL account until ${curBox} loss${curBox > 1 ? 'es' : ''}]`
            : '';

          const vCountTag = Boolean(p.virtualCountEnabled) && virtualCountSwitchedToReal
            ? `[Virtual Count Target Hit (${threshold}/${threshold} Losses): Switched to REAL ACCOUNT] `
            : Boolean(p.virtualCountEnabled) && isInVirtualCountRef.current
            ? `[Virtual Count Loss ${virtualCountLossesRef.current}/${threshold}] `
            : (Boolean(p.virtualCountEnabled) && !isInVirtualCountRef.current)
            ? `[Real Account Trading] `
            : '';

          setBotStatusMessage(
            `${vCountTag}[Attempt ${nextPhaseLossCount}/${pauseLimit} Lost]${switchInfo}: Trade #${finishedTrade.contractId} on ${lockedInfo.symbolName} LOST at 59s (-$${lossStake.toFixed(2)}${finishedTrade.isVirtualTrade ? ' [Simulated]' : ''}). ${virtualCountSwitchedToReal ? `Switched to REAL ACCOUNT! Opening next trade immediately at 59s on ${lockedInfo.symbolName} starting with DEFAULT BASE STAKE ($${(p.stake ?? 0.35).toFixed(2)})` : isVirtual ? `Opening next virtual trade immediately at 59s ($${nextStakeToExecute.toFixed(2)})` : `Opening Martingale Step ${nextStep} immediately at 59s ($${nextStakeToExecute.toFixed(2)} stake | ${recoveryModeText})`}...`
          );

          const stoppedStdByTpSl = !isVirtualRecord(resolvedFinishedTrade) ? checkTakeProfitAndStopLoss(resolvedSnapshot) : false;
          if (!stoppedStdByTpSl && isAutoTradingRef.current && selectedStrategyRef.current.id === 'smc_structure_confluence' && !isPausedAwaitingSignalRef.current) {
            pending59sReentryMarketsRef.current.add(tradeSymbol);
            setTimeout(() => {
              pending59sReentryMarketsRef.current.delete(tradeSymbol);
              if (!isAutoTradingRef.current || selectedStrategyRef.current.id !== 'smc_structure_confluence' || isPausedAwaitingSignalRef.current) return;
              if (checkTakeProfitAndStopLoss(tradeRecordsRef.current)) return;
              if (activeTradeRef.current || activeTradesRef.current.size > 0 || isExecutingTradeRef.current || isTradePendingRef.current) return;
              marketPendingBreaksRef.current[tradeSymbol] = null;
              if (tradeSymbol === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
              const curSec = Math.floor(Date.now() / 1000);
              const symC = tradeSymbol === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[tradeSymbol];
              const curEpoch = symC && symC.length > 0 ? symC[symC.length - 1].epoch : (curSec - (curSec % 60));
              lastExecutedCandleEpochRef.current = curEpoch;
              marketLastExecutedCandleEpochRef.current[tradeSymbol] = curEpoch;
              const smcNow = tradeSymbol === paramsRef.current.symbol ? latestSmcResultRef.current : marketSmcRef.current[tradeSymbol];
              const trendDir = smcNow?.currentTrend === 'BEARISH' ? 'PUT' : (smcNow?.currentTrend === 'BULLISH' ? 'CALL' : null);
              const chosenType: 'CALL' | 'PUT' = trendDir || tradeDir || lastTradeDirectionRef.current || 'CALL';
              const nextStakeNow = calculateCurrentStake();
              const targetDef = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbol) || { name: lockedInfo.symbolName, shortName: tradeSymbol };
              setBotStatusMessage(
                `[${targetDef.shortName} 59s Re-Entry]: Loss settled at 59s → Opening next Martingale trade immediately (${chosenType} @ $${nextStakeNow.toFixed(2)})...`
              );
              executeTradeRef.current(chosenType, nextStakeNow, undefined, tradeSymbol, targetDef.name);
            }, 0);
          }
          return;
        }
        }
      }

      // Check Risk Management: User-defined Take Profit and Stop Loss triggers on settled contracts (real/demo account trades only)
      if (!isVirtualRecord(resolvedFinishedTrade)) {
        checkTakeProfitAndStopLoss(resolvedSnapshot);
      }
    },
    [account, checkTakeProfitAndStopLoss, calculateCurrentStake]
  );

  // Settle active trade at exactly 59 seconds using entry barrier comparison
  const settleOpenTrade = useCallback((targetTrade?: TradeRecord) => {
    const openTrade =
      targetTrade ||
      activeTradeRef.current ||
      Array.from(activeTradesRef.current.values()).find((t) => t.status === 'open') ||
      tradeRecordsRef.current.find((t) => t.status === 'open');
    if (!openTrade || openTrade.status !== 'open') return;

    const tradeSymbol = openTrade.symbol || paramsRef.current.symbol;
    const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === tradeSymbol);
    const tradeSymbolName = openTrade.symbolName || mDef?.name || tradeSymbol;
    const fallbackBasePrice = mDef?.basePrice ?? 100;
    const lastQuote =
      tradeSymbol === paramsRef.current.symbol && ticksRef.current.length > 0
        ? ticksRef.current[ticksRef.current.length - 1].quote
        : (marketTicksRef.current[tradeSymbol]?.quote ?? fallbackBasePrice);
    const entryBarrier =
      openTrade.entrySpot !== undefined && !isNaN(openTrade.entrySpot)
        ? openTrade.entrySpot
        : openTrade.entryBarrier !== undefined && !isNaN(Number(openTrade.entryBarrier))
        ? Number(openTrade.entryBarrier)
        : lastQuote;

    const currentQuote =
      tradeSymbol === paramsRef.current.symbol && ticksRef.current.length > 0
        ? ticksRef.current[ticksRef.current.length - 1].quote
        : (marketTicksRef.current[tradeSymbol]?.quote ?? (entryBarrier + (Math.random() > 0.5 ? 0.05 : -0.05)));

    // Determine win/loss by comparing current exit price against entry barrier (equal price is NOT a win on Rise/Fall)
    const cType = (openTrade.contractType || '').toUpperCase();
    let won = false;
    if (cType === 'CALL' || cType === 'CALLE' || cType === 'RISE' || cType === 'HIGHER') {
      won = currentQuote > entryBarrier;
    } else if (cType === 'PUT' || cType === 'PUTE' || cType === 'FALL' || cType === 'LOWER') {
      won = currentQuote < entryBarrier;
    } else if (cType === 'DIGITEVEN') {
      const lastDigit = parseInt(currentQuote.toFixed(2).slice(-1), 10);
      won = lastDigit % 2 === 0;
    } else if (cType === 'DIGITODD') {
      const lastDigit = parseInt(currentQuote.toFixed(2).slice(-1), 10);
      won = lastDigit % 2 !== 0;
    } else {
      won = currentQuote > entryBarrier;
    }

    const purchasePrice = openTrade.stake;
    const potentialPayout = openTrade.payout > 0
      ? openTrade.payout
      : Number((purchasePrice * 1.84).toFixed(2));
    const profit = won ? Number((potentialPayout - purchasePrice).toFixed(2)) : -purchasePrice;

    const p = paramsRef.current;
    const isVirtualSystemActive = Boolean(p.virtualHookEnabled || p.virtualSwitchEnabled || p.virtualCountEnabled);
    const isVirtual = isVirtualSystemActive && isTradeRecordVirtual(openTrade);
    openTrade.status = won ? 'won' : 'lost';
    openTrade.profit = profit;
    openTrade.exitSpot = currentQuote;
    openTrade.exitBarrier = String(currentQuote);
    openTrade.settleTimeRemaining = 0;
    openTrade.settleTriggered = true;
    openTrade.isVirtualTrade = isVirtual;

    const finishedRecord: TradeRecord = {
      ...openTrade,
      id: isVirtual && openTrade.id && openTrade.id.startsWith('VIRTUAL-')
        ? openTrade.id
        : (isVirtual ? `VIRTUAL-${openTrade.contractId}` : String(openTrade.contractId)),
      symbol: tradeSymbol,
      symbolName: tradeSymbolName,
      payout: potentialPayout,
      profit,
      status: won ? 'won' : 'lost',
      sellTime: Date.now(),
      entrySpot: entryBarrier,
      entryBarrier: openTrade.entryBarrier || String(entryBarrier),
      exitSpot: currentQuote,
      exitBarrier: String(currentQuote),
      settleTimeRemaining: 0,
      settleTriggered: true,
      isVirtualTrade: isVirtual,
    };

    const hasSpecificIdentity = Boolean(
      openTrade.id || (openTrade.contractId && !isNaN(Number(openTrade.contractId)))
    );
    const matchesRecord = (t: TradeRecord) => {
      if (openTrade.id && t.id === openTrade.id) return true;
      if (openTrade.contractId && Number(t.contractId) === Number(openTrade.contractId)) return true;
      return !hasSpecificIdentity && t.symbol === tradeSymbol && t.status === 'open';
    };

    if (openTrade.symbol) {
      activeTradesRef.current.delete(openTrade.symbol);
    }
    for (const [sym, t] of activeTradesRef.current.entries()) {
      if (matchesRecord(t)) {
        activeTradesRef.current.delete(sym);
      }
    }
    const remainingActive = Array.from(activeTradesRef.current.values());
    setActiveTrades(remainingActive);
    activeTradeRef.current = remainingActive.length > 0 ? remainingActive[0] : null;
    if (remainingActive.length === 0) {
      setActiveTradeCountdown(0);
      autoRecoveryStorage.clearActiveTrade();
      autoRecoveryStorage.saveActiveTrades([]);
    } else {
      autoRecoveryStorage.saveActiveTrade(remainingActive[0]);
      autoRecoveryStorage.saveActiveTrades(remainingActive);
    }

    // Immediately and unconditionally update both tradeRecordsRef and React state setTradeRecords
    setTradeRecords((prev) => {
      const idx = prev.findIndex(matchesRecord);
      let updated: TradeRecord[];
      if (idx >= 0) {
        updated = [...prev];
        updated[idx] = finishedRecord;
      } else {
        updated = [finishedRecord, ...prev];
      }
      autoRecoveryStorage.saveTradeRecords(updated);
      tradeRecordsRef.current = updated;
      return updated;
    });

    tradeRecordsRef.current = tradeRecordsRef.current.map((t) =>
      matchesRecord(t) ? finishedRecord : t
    );
    isExecutingTradeRef.current = false;
    isTradePendingRef.current = false;
    setIsTradePending(false);
    handleTradeCompleted(finishedRecord);

    // If virtual trade, skip Deriv broker verification because contract is simulated locally
    if (isVirtual) {
      return;
    }

    // Immediately check WebSocket and verify that particular contract on Deriv
    const contractIdNum = Number(openTrade.contractId);
    if (contractIdNum && !isNaN(contractIdNum)) {
      derivWs.requestContractStatus(contractIdNum);
      setTimeout(() => derivWs.requestContractStatus(contractIdNum), 1000);
      setTimeout(() => derivWs.requestContractStatus(contractIdNum), 2500);
      setTimeout(() => derivWs.requestContractStatus(contractIdNum), 4500);

      // Immediately fetch official exit barrier and outcome from Deriv
      (async () => {
        try {
          const activeSession = sessionAuthRef.current;
          const tokenToUse = activeSession?.token || autoRecoveryStorage.loadActiveSession()?.token;
          if (tokenToUse) {
            const res = await fetch('/api/contract/details', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: tokenToUse,
                contractId: contractIdNum,
                accountId: accountRef.current?.loginid || account?.loginid,
                appId: accountRef.current?.appId || appId,
              }),
            });
            if (res.ok) {
              const details = await res.json();
              if (details && details.contract_id) {
                const officialExitBarrier = details.exit_barrier || (details.exit_tick !== undefined ? String(details.exit_tick) : undefined);
                const officialEntryBarrier = details.entry_barrier || details.barrier || (details.entry_spot !== undefined ? String(details.entry_spot) : undefined);
                const officialStatus = details.status === 'won' || details.status === 'lost' ? details.status : undefined;
                const officialProfit = typeof details.profit === 'number' ? Number(details.profit) : undefined;

                if (officialExitBarrier || officialStatus) {
                  handleTradeCompletedRef.current({
                    id: String(contractIdNum),
                    contractId: contractIdNum,
                    symbol: details.symbol || tradeSymbol,
                    symbolName: details.display_name || tradeSymbolName,
                    contractType: openTrade.contractType,
                    stake: Number(openTrade.stake) || 0,
                    payout: details.payout !== undefined && !isNaN(Number(details.payout))
                      ? Number(details.payout)
                      : (Number(openTrade.payout) || 0),
                    profit: officialProfit !== undefined
                      ? officialProfit
                      : (officialStatus === 'won' ? Number((potentialPayout - openTrade.stake).toFixed(2)) : -Number(openTrade.stake)),
                    status: officialStatus || (won ? 'won' : 'lost'),
                    purchaseTime: openTrade.purchaseTime,
                    sellTime: Date.now(),
                    entrySpot: details.entry_spot ?? entryBarrier,
                    exitSpot: details.exit_tick ?? currentQuote,
                    entryBarrier: officialEntryBarrier || openTrade.entryBarrier,
                    exitBarrier: officialExitBarrier,
                  });
                }
              }
            }
          }
        } catch (fetchErr) {
          console.warn('Official exit barrier check error:', fetchErr);
        }
      })();
    }
  }, [handleTradeCompleted, appId, account]);

  // Check and execute trade ONLY when a valid Break of Structure (BOS) or Change of Character (CHoCH) break occurs and candle timer reaches 58 seconds
  const checkAndExecuteSmcBreak = useCallback(
    (smcInput?: SmcAnalysisResult | null) => {
      if (!isAutoTradingRef.current) return;
      if (selectedStrategyRef.current.id !== 'smc_structure_confluence') return;

      const isIndiv = individualMultiMarketEnabledRef.current;

      const nowSecCheck = Math.floor(Date.now() / 1000);

      const isTradeRunningOnSymbol = (sym: string): boolean => {
        if (pending59sReentryMarketsRef.current.has(sym)) return true;
        const activeInMap = activeTradesRef.current.get(sym);
        const openInRecords = tradeRecordsRef.current.find((t) => t.symbol === sym && t.status === 'open');
        const openTrade = openInRecords || (activeInMap?.status === 'open' ? activeInMap : null);

        if (openTrade && openTrade.status === 'open') {
          if (nowSecCheck >= getTradeTargetSettleSec(openTrade)) {
            settleOpenTrade(openTrade);
            return false;
          }
          return true;
        }
        if (activeTradeRef.current && activeTradeRef.current.symbol === sym && activeTradeRef.current.status === 'open') {
          if (nowSecCheck >= getTradeTargetSettleSec(activeTradeRef.current)) {
            settleOpenTrade(activeTradeRef.current);
            return false;
          }
          return true;
        }
        if (executingMarketsRef.current.has(sym)) return true;
        return false;
      };

      const getRunningTradesCount = (): number => {
        const runningSyms = new Set<string>();
        for (const [sym, t] of activeTradesRef.current.entries()) {
          if (t.status === 'open') {
            if (nowSecCheck >= getTradeTargetSettleSec(t)) {
              settleOpenTrade(t);
            } else {
              runningSyms.add(sym);
            }
          }
        }
        for (const t of tradeRecordsRef.current) {
          if (t.symbol && t.status === 'open' && !runningSyms.has(t.symbol)) {
            if (nowSecCheck >= getTradeTargetSettleSec(t)) {
              settleOpenTrade(t);
            } else {
              runningSyms.add(t.symbol);
            }
          }
        }
        for (const sym of executingMarketsRef.current) {
          runningSyms.add(sym);
        }
        for (const sym of pending59sReentryMarketsRef.current) {
          runningSyms.add(sym);
        }
        return runningSyms.size;
      };

      if (!isIndiv && (getRunningTradesCount() > 0 || isExecutingTradeRef.current || isTradePendingRef.current)) return;

      const nowSec = Math.floor(Date.now() / 1000);
      const secondInCandle = nowSec % 60;
      const wallCandleEpoch = nowSec - secondInCandle;
      const primaryLatestCandleEpoch =
        candlesRef.current.length > 0 ? candlesRef.current[candlesRef.current.length - 1].epoch : wallCandleEpoch;

      // When waiting for a new signal after a win or Post-Martingale pause in global mode, do not evaluate candles until minNextSignalCandleEpoch is reached
      if (!isIndiv && minNextSignalCandleEpochRef.current > 0 && Math.max(primaryLatestCandleEpoch, wallCandleEpoch) < minNextSignalCandleEpochRef.current) {
        return;
      }

      // Prevent arming or executing if we already executed a trade on this candle in global mode
      if (!isIndiv && lastExecutedCandleEpochRef.current === primaryLatestCandleEpoch) {
        return;
      }

      // Determine symbols to scan (individual multi-market, global multi-market, or single-market)
      const isMulti = multiMarketEnabledRef.current;
      const pauseLimitForScan = Math.max(1, paramsRef.current.pauseLossThreshold ?? 2);
      let symbolsToScan: string[] = [];

      // Check if we are currently locked to a market during an active, incomplete Post-Martingale cycle:
      const activeLockedMarket = recoveryLockedMarketRef.current;
      const isLockedInPostMartingale = Boolean(
        activeLockedMarket &&
        !isPausedAwaitingSignalRef.current
      );

      if (isLockedInPostMartingale && activeLockedMarket) {
        // Active Post-Martingale cycle in progress on this market!
        // MUST STAY on this market until Post-Martingale completes or wins!
        // All other volatilities are strictly locked out.
        symbolsToScan = [activeLockedMarket.symbol];
      } else if (isIndiv) {
        symbolsToScan = selectedMarketsRef.current.length > 0 ? selectedMarketsRef.current : [paramsRef.current.symbol];
      } else if (isMulti) {
        symbolsToScan = selectedMarketsRef.current.length > 0 ? selectedMarketsRef.current : [paramsRef.current.symbol];
      } else {
        symbolsToScan = [paramsRef.current.symbol];
      }

      const allRecoveringSyms: Set<string> = isIndiv
        ? new Set(
            Object.values(marketMartingaleStatesRef.current)
              .filter((m) => m && (m.currentMartingaleStep > 0 || (m.cycleLossCount || 0) > 0))
              .map((m) => m.symbol)
          )
        : new Set<string>();

      const activeNextCandleMartingaleSyms: Set<string> = isIndiv
        ? new Set(
            Object.values(marketMartingaleStatesRef.current)
              .filter((m) => m && (m.currentMartingaleStep > 0 || (m.cycleLossCount || 0) > 0) && !m.isPausedAwaitingSignal && (m.cycleLossCount || 0) < pauseLimitForScan)
              .map((m) => m.symbol)
          )
        : new Set<string>();

      // Next-Candle Execution for Locked Market during active Post-Martingale cycle:
      if (
        activeLockedMarket &&
        !isPausedAwaitingSignalRef.current
      ) {
        const lockedSym = activeLockedMarket.symbol;
        if (isTradeRunningOnSymbol(lockedSym)) return;
        const lockedCandles = lockedSym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[lockedSym];
        const lockedCandleEpoch = lockedCandles && lockedCandles.length > 0
          ? lockedCandles[lockedCandles.length - 1].epoch
          : wallCandleEpoch;
        if (secondInCandle <= 45 && lastExecutedCandleEpochRef.current !== lockedCandleEpoch) {
          lastExecutedCandleEpochRef.current = lockedCandleEpoch;
          marketLastExecutedCandleEpochRef.current[lockedSym] = lockedCandleEpoch;
          marketPendingBreaksRef.current[lockedSym] = null;
          if (lockedSym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;

          const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === lockedSym) || {
            name: activeLockedMarket.symbolName || lockedSym,
            shortName: lockedSym,
          };
          const smc = lockedSym === paramsRef.current.symbol
            ? (smcInput || latestSmcResultRef.current)
            : marketSmcRef.current[lockedSym];
          const trendDir = smc?.currentTrend === 'BEARISH' ? 'PUT' : (smc?.currentTrend === 'BULLISH' ? 'CALL' : null);
          const chosenType: 'CALL' | 'PUT' = trendDir || lastTradeDirectionRef.current || 'CALL';
          const currentStake = isIndiv
            ? calculateCurrentStake(undefined, undefined, lockedSym)
            : calculateCurrentStake();
          const attemptNum = cycleLossCountRef.current + 1;
          const maxAttempts = pauseLimitForScan;

          const isVirtual = Boolean(
            (paramsRef.current.virtualCountEnabled && isInVirtualCountRef.current) ||
            (paramsRef.current.virtualHookEnabled && isInVirtualHookRef.current) ||
            (paramsRef.current.virtualSwitchEnabled && isInVirtualSwitchRef.current)
          );

          setBotStatusMessage(
            `[${mDef.shortName} Next Candle]: Post-Martingale attempt ${attemptNum}/${maxAttempts} executing immediately on next candle (1-min ${chosenType} @ $${currentStake.toFixed(2)}${isVirtual ? ' [Virtual Flat Stake]' : ''}). Holding on ${mDef.shortName} until post-martingale completes...`
          );
          executeTrade(chosenType, currentStake, undefined, lockedSym, mDef.name);
          return;
        }
      }

      // Next-Candle Martingale Execution for Individual Multi-Market:
      if (isIndiv && secondInCandle <= 45) {
        const maxConcurrent = Math.max(1, paramsRef.current.maxConcurrentTrades || 1);
        const pauseLimit = Math.max(1, paramsRef.current.pauseLossThreshold ?? 2);
        for (const sym of symbolsToScan) {
          const currentActiveCount = getRunningTradesCount();
          if (currentActiveCount >= maxConcurrent) break;

          if (isTradeRunningOnSymbol(sym)) continue;
          const symCandles = sym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[sym];
          const symCandleEpoch = symCandles && symCandles.length > 0
            ? symCandles[symCandles.length - 1].epoch
            : wallCandleEpoch;
          if (marketLastExecutedCandleEpochRef.current[sym] === symCandleEpoch) continue;

          const mState = marketMartingaleStatesRef.current[sym];
          if (
            mState &&
            (mState.currentMartingaleStep > 0 || (mState.cycleLossCount || 0) > 0) &&
            !mState.isPausedAwaitingSignal &&
            (mState.cycleLossCount || 0) < pauseLimit
          ) {
            marketLastExecutedCandleEpochRef.current[sym] = symCandleEpoch;
            marketPendingBreaksRef.current[sym] = null;
            if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;

            const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym) || {
              name: sym,
              shortName: sym,
            };
            const smc = sym === paramsRef.current.symbol
              ? (smcInput || latestSmcResultRef.current)
              : marketSmcRef.current[sym];
            const trendDir = smc?.currentTrend === 'BEARISH' ? 'PUT' : (smc?.currentTrend === 'BULLISH' ? 'CALL' : null);
            const chosenType: 'CALL' | 'PUT' = trendDir || mState.lastTradeDirection || lastTradeDirectionRef.current || 'CALL';
            const currentStake = calculateCurrentStake(undefined, undefined, sym);
            const attemptNum = (mState.cycleLossCount || 0) + 1;
            const maxAttempts = pauseLimit;

            setBotStatusMessage(
              `[${mDef.shortName} Next Candle]: Independent Martingale attempt ${attemptNum}/${maxAttempts} executing immediately on next candle (1-min ${chosenType} @ $${currentStake.toFixed(2)})...`
            );
            executeTrade(chosenType, currentStake, undefined, sym, mDef.name);
          } else if (
            paramsRef.current.pauseTradeEnabled !== false &&
            mState &&
            (mState.currentMartingaleStep > 0 || (mState.cycleLossCount || 0) > 0) &&
            ((mState.cycleLossCount || 0) >= pauseLimit || mState.isPausedAwaitingSignal)
          ) {
            if (!mState.isPausedAwaitingSignal) {
              const updated = { ...mState, isPausedAwaitingSignal: true };
              marketMartingaleStatesRef.current[sym] = updated;
              setMarketMartingaleStates((prev) => ({ ...prev, [sym]: updated }));
              autoRecoveryStorage.saveMarketMartingaleStates(marketMartingaleStatesRef.current);
            }
          }
        }
      }

      const unfulfilledMartingales = isIndiv
        ? Array.from(activeNextCandleMartingaleSyms).filter(
            (s) => !isTradeRunningOnSymbol(s)
          ).length
        : 0;

      // Step 1: Check armed breaks and execute IMMEDIATELY when the breaking candle closes
      for (const sym of symbolsToScan) {
        const candlesList = sym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[sym];
        if (!candlesList || candlesList.length < 2) continue;
        const latestCandle = candlesList[candlesList.length - 1];
        const closedCandle = candlesList[candlesList.length - 2];
        const latestCandleEpoch = latestCandle.epoch;

        if (isIndiv) {
          const maxConcurrent = Math.max(1, paramsRef.current.maxConcurrentTrades || 1);
          const currentActiveCount = getRunningTradesCount();
          if (currentActiveCount >= maxConcurrent) break;

          const isSymRecovering = Boolean(allRecoveringSyms.has(sym));
          if (!activeNextCandleMartingaleSyms.has(sym) && !isSymRecovering && (currentActiveCount + unfulfilledMartingales) >= maxConcurrent) {
            continue;
          }

          if (isTradeRunningOnSymbol(sym)) continue;
          if (marketLastExecutedCandleEpochRef.current[sym] === latestCandleEpoch) continue;
        } else {
          if (isTradeRunningOnSymbol(sym)) continue;
          if (lastExecutedCandleEpochRef.current === latestCandleEpoch) continue;
        }

        const pending =
          marketPendingBreaksRef.current[sym] ||
          (sym === paramsRef.current.symbol ? pendingStructureBreakRef.current : null);
        if (!pending) continue;

        if (isIndiv) {
          const mState = marketMartingaleStatesRef.current[sym];
          const minSig = marketMinNextSignalCandleEpochRef.current[sym] || autoTraderStartCandleEpochRef.current || 0;
          if (mState?.isPausedAwaitingSignal && minSig > 0 && pending.candleEpoch < minSig) {
            marketPendingBreaksRef.current[sym] = null;
            if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
            continue;
          }
        } else {
          const minSig = minNextSignalCandleEpochRef.current || 0;
          if (minSig > 0 && pending.candleEpoch < minSig) {
            marketPendingBreaksRef.current[sym] = null;
            if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
            continue;
          }
        }

        // Still inside the forming breaking candle: keep waiting until it closes
        if (pending.candleEpoch >= latestCandleEpoch) {
          continue;
        }

        // Discard stale pending breaks older than the immediately closed candle
        if (latestCandleEpoch - pending.candleEpoch > 60) {
          marketPendingBreaksRef.current[sym] = null;
          if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
          continue;
        }

        // The breaking candle JUST CLOSED (closedCandle.epoch === pending.candleEpoch)!
        const targetClosedCandle =
          candlesList.find((c) => c.epoch === pending.candleEpoch) || closedCandle;
        const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym) || { name: sym, shortName: sym };
        const smc =
          (sym === paramsRef.current.symbol ? (smcInput || latestSmcResultRef.current) : marketSmcRef.current[sym]) ||
          (candlesList.length >= 10 ? calculateSMC(candlesList, smcConfigRef.current) : null);

        const isClosedBeyondLevel =
          Boolean(targetClosedCandle) &&
          (pending.direction === 'bullish'
            ? targetClosedCandle.close > pending.level
            : targetClosedCandle.close < pending.level);
        const matchingClosedEvent = (smc?.structures || []).find(
          (s) =>
            s.breakTime === pending.candleEpoch &&
            s.direction === pending.direction &&
            !tradedStructureIdsRef.current.has(s.id)
        );

        if (isClosedBeyondLevel || matchingClosedEvent) {
          if (isIndiv) {
            marketLastExecutedCandleEpochRef.current[sym] = latestCandleEpoch;
          } else {
            lastExecutedCandleEpochRef.current = latestCandleEpoch;
          }
          const chosenType: 'CALL' | 'PUT' = pending.direction === 'bullish' ? 'CALL' : 'PUT';
          const currentStake = isIndiv
            ? calculateCurrentStake(undefined, undefined, sym)
            : calculateCurrentStake();
          const breakId = matchingClosedEvent?.id || pending.id;
          tradedStructureIdsRef.current.add(pending.id);
          tradedStructureIdsRef.current.add(breakId);
          marketPendingBreaksRef.current[sym] = null;
          if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;

          setBotStatusMessage(
            `[${mDef.shortName} Candle Closed]: ${pending.type} (${pending.direction.toUpperCase()} @ ${pending.level.toFixed(2)}) closed at ${targetClosedCandle.close.toFixed(2)}! Executing 1-min ${chosenType} ($${currentStake.toFixed(2)}) immediately (settles at 59s)...`
          );
          executeTrade(chosenType, currentStake, breakId, sym, mDef.name);
          if (!isIndiv) {
            return;
          }
          continue;
        } else {
          // Candle wicked past level mid-candle but closed back inside: clear armed state without burning the swing level
          marketPendingBreaksRef.current[sym] = null;
          if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;
          setBotStatusMessage(
            `[${mDef.shortName} Candle Closed]: ${pending.type} wick rejected (closed ${targetClosedCandle.close.toFixed(2)} inside ${pending.level.toFixed(2)}). Waiting for confirmed candle-close break...`
          );
        }
      }

      // Step 2: Scan for confirmed candle-close BOS/CHoCH breaks OR arm newly forming candle breaks
      for (const sym of symbolsToScan) {
        const candlesList = sym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[sym];
        if (!candlesList || candlesList.length < 5) continue;
        const latestCandle = candlesList[candlesList.length - 1];
        const closedCandle = candlesList[candlesList.length - 2];
        const latestCandleEpoch = latestCandle.epoch;

        if (isIndiv) {
          const maxConcurrent = Math.max(1, paramsRef.current.maxConcurrentTrades || 1);
          const currentActiveCount = getRunningTradesCount();
          if (currentActiveCount >= maxConcurrent) break;

          const isSymRecovering = Boolean(allRecoveringSyms.has(sym));
          if (!activeNextCandleMartingaleSyms.has(sym) && !isSymRecovering && (currentActiveCount + unfulfilledMartingales) >= maxConcurrent) {
            continue;
          }

          if (isTradeRunningOnSymbol(sym)) continue;
          if (marketLastExecutedCandleEpochRef.current[sym] === latestCandleEpoch) continue;
        } else {
          if (isTradeRunningOnSymbol(sym)) continue;
          if (lastExecutedCandleEpochRef.current === latestCandleEpoch) continue;
        }

        if (marketPendingBreaksRef.current[sym]) continue;

        const smc =
          (sym === paramsRef.current.symbol ? (smcInput || latestSmcResultRef.current) : marketSmcRef.current[sym]) ||
          (candlesList.length >= 10 ? calculateSMC(candlesList, smcConfigRef.current) : null);

        if (!smc) continue;

        const currentQuote =
          sym === paramsRef.current.symbol && ticksRef.current.length > 0
            ? ticksRef.current[ticksRef.current.length - 1].quote
            : (marketTicksRef.current[sym]?.quote ?? latestCandle.close);

        const minSignalEpoch = isIndiv
          ? Math.max(autoTraderStartCandleEpochRef.current, marketMinNextSignalCandleEpochRef.current[sym] || 0)
          : Math.max(autoTraderStartCandleEpochRef.current, minNextSignalCandleEpochRef.current);

        const mState = isIndiv ? marketMartingaleStatesRef.current[sym] : null;

        const validStructures = (smc.structures || []).filter((s) => {
          if (s.type !== 'BOS' && s.type !== 'CHoCH') return false;
          if (s.direction !== 'bullish' && s.direction !== 'bearish') return false;
          if (tradedStructureIdsRef.current.has(s.id)) return false;

          // Only consider the currently forming candle or the immediately closed candle
          const isCurrentOrJustClosed =
            s.breakTime === latestCandleEpoch ||
            (closedCandle.epoch === latestCandleEpoch - 60 && s.breakTime === closedCandle.epoch);
          if (!isCurrentOrJustClosed) return false;

          if (minSignalEpoch > 0 && s.breakTime < minSignalEpoch) return false;

          if (isIndiv) {
            if (mState?.isPausedAwaitingSignal) {
              const minAllowed = marketMinNextSignalCandleEpochRef.current[sym] || autoTraderStartCandleEpochRef.current || 0;
              if (minAllowed > 0 && s.breakTime < minAllowed) return false;
            }
          } else {
            if (isPausedAwaitingSignalRef.current) {
              const minAllowed = minNextSignalCandleEpochRef.current || autoTraderStartCandleEpochRef.current || 0;
              if (minAllowed > 0 && s.breakTime < minAllowed) return false;
            }
          }

          return true;
        });

        const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym) || { name: sym, shortName: sym };

        // Priority 1: A breaking candle JUST CLOSED (breakTime === closedCandle.epoch) -> execute immediately!
        const justClosedBreak = validStructures.find(
          (s) => closedCandle.epoch === latestCandleEpoch - 60 && s.breakTime === closedCandle.epoch
        );

        if (justClosedBreak) {
          const chosenType: 'CALL' | 'PUT' = justClosedBreak.direction === 'bullish' ? 'CALL' : 'PUT';
          const currentStake = isIndiv
            ? calculateCurrentStake(undefined, undefined, sym)
            : calculateCurrentStake();
          if (isIndiv) {
            marketLastExecutedCandleEpochRef.current[sym] = latestCandleEpoch;
          } else {
            lastExecutedCandleEpochRef.current = latestCandleEpoch;
          }
          tradedStructureIdsRef.current.add(justClosedBreak.id);
          marketPendingBreaksRef.current[sym] = null;
          if (sym === paramsRef.current.symbol) pendingStructureBreakRef.current = null;

          setBotStatusMessage(
            `[${mDef.shortName} Candle Closed]: ${justClosedBreak.type} (${justClosedBreak.direction.toUpperCase()} @ ${justClosedBreak.level.toFixed(2)}) closed! Executing 1-min ${chosenType} ($${currentStake.toFixed(2)}) immediately (settles at 59s)...`
          );
          executeTrade(chosenType, currentStake, justClosedBreak.id, sym, mDef.name);
          if (!isIndiv) {
            return;
          }
          continue;
        }

        // Priority 2: Break forming on current candle -> arm and wait for candle to close (NEVER execute mid-candle or at 58s!)
        let formingBreak: {
          id: string;
          type: 'BOS' | 'CHoCH';
          direction: 'bullish' | 'bearish';
          level: number;
          breakTime: number;
        } | null = null;

        const formingStructure = validStructures.find((s) => s.breakTime === latestCandleEpoch);
        if (formingStructure) {
          formingBreak = {
            id: formingStructure.id,
            type: formingStructure.type,
            direction: formingStructure.direction,
            level: formingStructure.level,
            breakTime: formingStructure.breakTime,
          };
        }

        const pauseMinSig = isIndiv ? (marketMinNextSignalCandleEpochRef.current[sym] || 0) : minNextSignalCandleEpochRef.current;
        const isEligibleForLiveBreak = !pauseMinSig || latestCandleEpoch >= pauseMinSig;

        if (!formingBreak && smc.activeSwingHigh && typeof smc.activeSwingHigh.price === 'number' && currentQuote > smc.activeSwingHigh.price && isEligibleForLiveBreak) {
          const liveHighId = `live-break-high-${sym}-${smc.activeSwingHigh.time}-${smc.activeSwingHigh.price.toFixed(4)}`;
          const swingHighId = `${sym}-swing-high-${smc.activeSwingHigh.time}-${smc.activeSwingHigh.price.toFixed(4)}`;
          if (!tradedStructureIdsRef.current.has(liveHighId) && !tradedStructureIdsRef.current.has(swingHighId)) {
            const tag: 'BOS' | 'CHoCH' = smc.currentTrend === 'BEARISH' ? 'CHoCH' : 'BOS';
            formingBreak = {
              id: liveHighId,
              type: tag,
              direction: 'bullish',
              level: smc.activeSwingHigh.price,
              breakTime: latestCandleEpoch,
            };
          }
        }

        if (!formingBreak && smc.activeSwingLow && typeof smc.activeSwingLow.price === 'number' && currentQuote < smc.activeSwingLow.price && isEligibleForLiveBreak) {
          const liveLowId = `live-break-low-${sym}-${smc.activeSwingLow.time}-${smc.activeSwingLow.price.toFixed(4)}`;
          const swingLowId = `${sym}-swing-low-${smc.activeSwingLow.time}-${smc.activeSwingLow.price.toFixed(4)}`;
          if (!tradedStructureIdsRef.current.has(liveLowId) && !tradedStructureIdsRef.current.has(swingLowId)) {
            const tag: 'BOS' | 'CHoCH' = smc.currentTrend === 'BULLISH' ? 'CHoCH' : 'BOS';
            formingBreak = {
              id: liveLowId,
              type: tag,
              direction: 'bearish',
              level: smc.activeSwingLow.price,
              breakTime: latestCandleEpoch,
            };
          }
        }

        if (formingBreak) {
          const pendingObj = {
            id: formingBreak.id,
            type: formingBreak.type,
            direction: formingBreak.direction,
            level: formingBreak.level,
            candleEpoch: latestCandleEpoch,
            detectedTime: nowSec,
            symbol: sym,
            symbolName: mDef.name,
          };
          marketPendingBreaksRef.current[sym] = pendingObj;
          if (sym === paramsRef.current.symbol) {
            pendingStructureBreakRef.current = pendingObj;
          }
          setBotStatusMessage(
            `[${mDef.shortName} ${secondInCandle}s/60s]: ${formingBreak.type} (${formingBreak.direction.toUpperCase()} @ ${formingBreak.level.toFixed(2)}) detected. Waiting for candle to close before entry...`
          );
        }
      }
    },
    [calculateCurrentStake, executeTrade, getTradeTargetSettleSec, settleOpenTrade]
  );

  // Helper to extract latest Change of Character (CHoCH) direction for any market
  const getLatestChochDirection = useCallback(
    (sym: string, smcInput?: SmcAnalysisResult | null): 'CALL' | 'PUT' => {
      const smc = sym === paramsRef.current.symbol ? (smcInput || latestSmcResultRef.current) : marketSmcRef.current[sym];
      if (smc && smc.structures && smc.structures.length > 0) {
        const chochEvents = smc.structures
          .filter((s) => s.type === 'CHoCH')
          .sort((a, b) => (b.breakTime || 0) - (a.breakTime || 0));
        if (chochEvents.length > 0) {
          return chochEvents[0].direction === 'bullish' ? 'CALL' : 'PUT';
        }
      }
      if (smc?.currentTrend === 'BEARISH') return 'PUT';
      return 'CALL';
    },
    []
  );

  // Continuous Trade Strategy Execution Engine:
  // - Executes every 1-minute candle at 58 seconds
  // - Settles at 59 seconds
  // - Direction is dictated by latest Change of Character (CHoCH):
  //   Bullish CHoCH -> Continuous BUY (CALL) every candle until Bearish CHoCH
  //   Bearish CHoCH -> Continuous SELL (PUT) every candle until Bullish CHoCH
  // - Respects Post-Martingale pause, Multi-Market lock, Virtual Count, and Auto-Martingale loss recovery
  // Continuous Trade Strategy Execution Engine:
  // - Executes every 1-minute candle at 58 seconds
  // - At 58 seconds:
  //   1. Checks any running trade from the previous candle:
  //      - If the running trade is currently in PROFIT: executes next trade with default/initial stake (e.g. 0.35)
  //      - If the running trade is currently in LOSS: executes next trade with Martingale (multiplies stake / loss recovery)
  //   2. Direction is dictated by latest Change of Character (CHoCH):
  //      Bullish CHoCH -> Continuous BUY (CALL) every candle until Bearish CHoCH
  //      Bearish CHoCH -> Continuous SELL (PUT) every candle until Bullish CHoCH
  //   3. Settles the previous candle trade cleanly on 59 / at 58s transition and applies lot size updates
  const checkAndExecuteContinuousTrade = useCallback(
    async (smcInput?: SmcAnalysisResult | null) => {
      if (!isAutoTradingRef.current) return;
      if (selectedStrategyRef.current.id !== 'continuous_trade') return;

      const isIndiv = individualMultiMarketEnabledRef.current;
      const nowSec = Math.floor(Date.now() / 1000);
      const secondInCandle = nowSec % 60;
      const currentCandleEpoch = nowSec - secondInCandle;

      // Determine active target symbols
      const isMulti = multiMarketEnabledRef.current;
      const activeLockedMarket = recoveryLockedMarketRef.current;
      const isLockedInPostMartingale = Boolean(activeLockedMarket && !isPausedAwaitingSignalRef.current);

      let targetSymbols: string[] = [];
      if (isLockedInPostMartingale && activeLockedMarket) {
        targetSymbols = [activeLockedMarket.symbol];
      } else if (isIndiv) {
        targetSymbols = selectedMarketsRef.current.length > 0 ? selectedMarketsRef.current : [paramsRef.current.symbol];
      } else if (isMulti) {
        targetSymbols = selectedMarketsRef.current.length > 0 ? selectedMarketsRef.current : [paramsRef.current.symbol];
      } else {
        targetSymbols = [paramsRef.current.symbol];
      }

      // Continuous Trade places trades strictly at 58 seconds of each candle
      if (secondInCandle < 58) {
        const secTo58 = 58 - secondInCandle;
        const sym = targetSymbols[0] || paramsRef.current.symbol;
        const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym);
        const dir = getLatestChochDirection(sym, smcInput);
        const dirLabel = dir === 'CALL' ? 'BUY (Bullish CHoCH)' : 'SELL (Bearish CHoCH)';

        setBotStatusMessage(
          `[Continuous Trade | ${mDef?.shortName || sym}]: Current direction: ${dirLabel}. Waiting for Candle 58s (in ${secTo58}s)...`
        );
        return;
      }

      // At second 58 or 59:
      for (const sym of targetSymbols) {
        const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym) || {
          symbol: sym,
          name: sym,
          shortName: sym,
          category: 'volatility',
          basePrice: 100,
        };

        const lastCandleTraded = continuousCandleEpochTradedRef.current[sym] || 0;
        if (lastCandleTraded === currentCandleEpoch) {
          continue; // Already placed trade for this 58s candle
        }

        // Respect Post-Martingale pause in Continuous Trade: skip if currently paused awaiting a new candle signal
        const isPausedBeforeContinuous = isIndiv
          ? Boolean(marketMartingaleStatesRef.current[sym]?.isPausedAwaitingSignal)
          : Boolean(isPausedAwaitingSignalRef.current);
        const minSigBeforeContinuous = isIndiv
          ? (marketMinNextSignalCandleEpochRef.current[sym] || 0)
          : (minNextSignalCandleEpochRef.current || 0);
        if (isPausedBeforeContinuous && minSigBeforeContinuous > 0 && currentCandleEpoch < minSigBeforeContinuous) {
          const pauseLim = paramsRef.current.pauseLossThreshold ?? 2;
          setBotStatusMessage(
            `[Continuous Trade | ${mDef.shortName}]: Post-Martingale Paused (${pauseLim}/${pauseLim} Losses). Awaiting next candle signal...`
          );
          continue;
        }

        // Find any currently running trade for this symbol
        const runningTrade =
          activeTradesRef.current.get(sym) ||
          (activeTradeRef.current?.symbol === sym && activeTradeRef.current.status === 'open' ? activeTradeRef.current : null) ||
          tradeRecordsRef.current.find((t) => t.symbol === sym && t.status === 'open');

        let nextStake: number = paramsRef.current.stake ?? 0.35;
        const p = paramsRef.current;
        const isVirtualSystemActive = Boolean(p.virtualHookEnabled || p.virtualSwitchEnabled || p.virtualCountEnabled);
        const isCountActive = Boolean(p.virtualCountEnabled) && isInVirtualCountRef.current;

        if (runningTrade && runningTrade.status === 'open') {
          const pTime = runningTrade.purchaseTime || Date.now();
          const tradeAge = Math.floor((Date.now() - pTime) / 1000);
          const isLocalSimOrVirtual = Boolean(
            runningTrade.isVirtualTrade ||
            (typeof runningTrade.id === 'string' && runningTrade.id.startsWith('VIRTUAL-')) ||
            (typeof runningTrade.shortcode === 'string' && runningTrade.shortcode.startsWith('DEMO_')) ||
            derivWs.getIsSimulated() ||
            !(sessionAuthRef.current?.token || autoRecoveryStorage.loadActiveSession()?.token) ||
            (sessionAuthRef.current?.token || autoRecoveryStorage.loadActiveSession()?.token || '').startsWith('DEMO')
          );
          // Wait full 1-minute duration before settling (59s for virtual/sim, 60s+ for live Deriv contracts)
          const minDurationSec = isLocalSimOrVirtual ? 59 : 60;

          if (tradeAge < minDurationSec) {
            continue;
          }

          // Full contract duration completed: settle running trade before opening next candle trade
          settleOpenTrade(runningTrade);

          if (!isAutoTradingRef.current) {
            break;
          }

          // If settling this trade triggered a Post-Martingale pause, pause immediately instead of opening next trade!
          const isPausedAfterSettle = isIndiv
            ? Boolean(marketMartingaleStatesRef.current[sym]?.isPausedAwaitingSignal)
            : Boolean(isPausedAwaitingSignalRef.current);
          const minSigAfterSettle = isIndiv
            ? (marketMinNextSignalCandleEpochRef.current[sym] || 0)
            : (minNextSignalCandleEpochRef.current || 0);
          if (isPausedAfterSettle && (minSigAfterSettle === 0 || currentCandleEpoch < minSigAfterSettle)) {
            continuousCandleEpochTradedRef.current[sym] = currentCandleEpoch;
            const pauseLim = paramsRef.current.pauseLossThreshold ?? 2;
            setBotStatusMessage(
              `[Continuous Trade | ${mDef.shortName}]: Post-Martingale Paused (${pauseLim}/${pauseLim} Losses). Holding & awaiting next candle signal...`
            );
            continue;
          }

          const wasWon = (runningTrade.status as string) === 'won' || (runningTrade.profit !== undefined && runningTrade.profit > 0);
          const isRunningVirtual = isVirtualSystemActive && isTradeRecordVirtual(runningTrade);

          if (p.inInterModeEnabled && !isRunningVirtual && !isCountActive) {
            // handleTradeCompleted inside settleOpenTrade already updated Mode state & losses cleanly!
            nextStake = calculateCurrentStake(undefined, undefined, sym);
          } else if (wasWon) {
            if (!isRunningVirtual) {
              // Real trade WON: reset Martingale completely and use default base stake!
              nextStake = p.stake ?? 0.35;
              setCurrentMartingaleStep(0);
              currentMartingaleStepRef.current = 0;
              setAccumulatedLoss(0);
              accumulatedLossRef.current = 0;
              setCycleLossCount(0);
              cycleLossCountRef.current = 0;
              realConsecutiveLossesRef.current = 0;
              correctedLossItemsRef.current = [];
              setCorrectedLossItems([]);
              autoRecoveryStorage.clearCorrectedLossItems();

              if (individualMultiMarketEnabledRef.current) {
                const resetMState: MarketMartingaleState = {
                  symbol: sym,
                  currentMartingaleStep: 0,
                  accumulatedLoss: 0,
                  cycleLossCount: 0,
                  isPausedAwaitingSignal: false,
                  updatedAt: Date.now(),
                };
                marketMartingaleStatesRef.current[sym] = resetMState;
                autoRecoveryStorage.saveMarketMartingaleStates(marketMartingaleStatesRef.current);
              }

              setBotStatusMessage(
                `[Continuous Trade 58s | ${mDef.shortName}]: Previous real trade WON! Martingale reset to default stake ($${nextStake.toFixed(2)}). Executing next candle...`
              );
            } else {
              // Virtual trade WON: state already updated by handleTradeCompleted inside settleOpenTrade!
              nextStake = calculateCurrentStake(undefined, undefined, sym);
              setBotStatusMessage(
                `[Continuous Trade 58s | ${mDef.shortName}]: Virtual trade WON (+$0.00 Real Impact). Continuing on Virtual Count (${virtualCountLossesRef.current}/${Math.max(1, p.virtualCountThreshold ?? 3)}). Next stake: $${nextStake.toFixed(2)}.`
              );
            }
          } else {
            // Previous trade was a LOSS:
            if (isRunningVirtual && Boolean(p.virtualCountEnabled)) {
              // handleTradeCompleted inside settleOpenTrade ALREADY updated virtualCountLosses & switched to Real if threshold reached
              const threshold = Math.max(1, p.virtualCountThreshold ?? 3);
              const curCount = virtualCountLossesRef.current;
              nextStake = calculateCurrentStake(undefined, undefined, sym);
              if (!isInVirtualCountRef.current) {
                setBotStatusMessage(
                  `[Continuous Trade 58s | ${mDef.shortName}]: Virtual Count reached ${curCount}/${threshold} losses! Switched to REAL ACCOUNT -> Next stake: $${nextStake.toFixed(2)}.`
                );
              } else {
                setBotStatusMessage(
                  `[Continuous Trade 58s | ${mDef.shortName}]: Virtual loss ${curCount}/${threshold}. Next stake: $${nextStake.toFixed(2)}.`
                );
              }
            } else {
              // Real trade was a loss (or virtual features are off): apply Martingale recovery!
              if (isCountActive) {
                nextStake = p.stake ?? 0.35;
              } else {
                const mult = Math.max(1.05, p.multiplier || 2.0);
                let martingaleStake: number;
                if (p.autoMartingaleEnabled) {
                  const payoutRate = (p.autoMartingalePayoutPercent || 83) / 100;
                  const loss = Math.max(runningTrade.stake || 0.35, accumulatedLossRef.current);
                  martingaleStake = Math.ceil((loss / payoutRate) * 100) / 100;
                } else {
                  martingaleStake = Number(((runningTrade.stake || p.stake || 0.35) * mult).toFixed(2));
                }
                const calcStake = calculateCurrentStake(undefined, undefined, sym);
                nextStake = Math.max(martingaleStake, calcStake);
              }
              setBotStatusMessage(
                `[Continuous Trade 58s | ${mDef.shortName}]: Previous trade was a LOSS (-$${(runningTrade.stake || 0.35).toFixed(2)}). Applying Martingale -> Executing next candle with Martingale stake ($${nextStake.toFixed(2)}).`
              );
            }
          }
        } else {
          // No running trade in progress (e.g. initial start, or trade already settled): check the most recent completed trade
          const recentTrade = tradeRecordsRef.current.find(
            (t) => (t.symbol === sym || !sym) && (t.status === 'won' || t.status === 'lost')
          ) || tradeRecordsRef.current.find(
            (t) => (t.status === 'won' || t.status === 'lost')
          );

          const isRecentVirtual = recentTrade ? (isVirtualSystemActive && isTradeRecordVirtual(recentTrade)) : false;
          const isRecentWon = recentTrade && (recentTrade.status === 'won' || (recentTrade.profit ?? 0) > 0);

          if (p.inInterModeEnabled && !isRecentVirtual && !isCountActive) {
            nextStake = calculateCurrentStake(undefined, undefined, sym);
          } else if (isRecentVirtual) {
            // Prior trade was virtual: NEVER reset real Martingale state or clear corrected loss items!
            if (isCountActive) {
              nextStake = p.stake ?? 0.35;
            } else {
              // We are trading on real account! Apply real recovery stake if there are pending losses!
              nextStake = calculateCurrentStake(undefined, undefined, sym);
            }
            setBotStatusMessage(
              `[Continuous Trade 58s | ${mDef.shortName}]: Prior trade was virtual. ${isCountActive ? 'Virtual count active' : 'Real account active'} -> Next Stake: $${nextStake.toFixed(2)}.`
            );
          } else if (!recentTrade || isRecentWon) {
            // Real trade was WON: reset Martingale completely and use default base stake!
            nextStake = p.stake ?? 0.35;
            setCurrentMartingaleStep(0);
            currentMartingaleStepRef.current = 0;
            setAccumulatedLoss(0);
            accumulatedLossRef.current = 0;
            setCycleLossCount(0);
            cycleLossCountRef.current = 0;
            realConsecutiveLossesRef.current = 0;
            correctedLossItemsRef.current = [];
            setCorrectedLossItems([]);
            autoRecoveryStorage.clearCorrectedLossItems();
            setBotStatusMessage(
              `[Continuous Trade 58s | ${mDef.shortName}]: Last settled real trade was WON. Base stake ($${nextStake.toFixed(2)}) applied. Executing next candle...`
            );
          } else {
            // Last trade was a real verified LOSS:
            if (isCountActive) {
              nextStake = p.stake ?? 0.35;
            } else {
              if (p.autoMartingaleEnabled) {
                const payoutRate = (p.autoMartingalePayoutPercent || 83) / 100;
                const loss = Math.max(recentTrade.stake || 0.35, accumulatedLossRef.current);
                nextStake = Math.ceil((loss / payoutRate) * 100) / 100;
              } else {
                const mult = Math.max(1.05, p.multiplier || 2.0);
                nextStake = Number(((recentTrade.stake || p.stake || 0.35) * mult).toFixed(2));
              }
              const calcStake = calculateCurrentStake(undefined, undefined, sym);
              nextStake = Math.max(nextStake, calcStake);
            }
            setBotStatusMessage(
              `[Continuous Trade 58s | ${mDef.shortName}]: Last real trade was a LOSS (-$${(recentTrade.stake || 0.35).toFixed(2)}). Executing next candle with Martingale stake ($${nextStake.toFixed(2)}).`
            );
          }
        }

        // Direction dictated by latest Change of Character (CHoCH)
        const chosenDirection = getLatestChochDirection(sym, smcInput);
        const prevDirection = continuousDirectionRef.current[sym];

        if (prevDirection && prevDirection !== chosenDirection) {
          setBotStatusMessage(
            `[Continuous Trade CHoCH Shift]: ${mDef.shortName} flipped from ${prevDirection === 'CALL' ? 'BUY' : 'SELL'} to ${chosenDirection === 'CALL' ? 'BUY (Bullish CHoCH)' : 'SELL (Bearish CHoCH)'}! Placing new trade at 58s.`
          );
        }
        continuousDirectionRef.current[sym] = chosenDirection;

        // Mark candle epoch as executed for Continuous Trade
        continuousCandleEpochTradedRef.current[sym] = currentCandleEpoch;
        lastExecutedCandleEpochRef.current = currentCandleEpoch;
        marketLastExecutedCandleEpochRef.current[sym] = currentCandleEpoch;

        // Clear active trade references & flags immediately before executeTrade so no concurrency blockage happens
        activeTradesRef.current.delete(sym);
        if (activeTradeRef.current?.symbol === sym) {
          activeTradeRef.current = null;
        }
        isExecutingTradeRef.current = false;
        isTradePendingRef.current = false;
        setIsTradePending(false);

        // Execute the next continuous trade at 58 seconds
        executeTrade(chosenDirection, nextStake, undefined, sym, mDef.name);

        if (!isIndiv) {
          break;
        }
      }
    },
    [calculateCurrentStake, executeTrade, getLatestChochDirection, settleOpenTrade]
  );

  // Evaluate strategy and execute next trade in auto mode
  const evaluateAndTriggerAutoStrategy = useCallback(() => {
    const strategy = selectedStrategyRef.current;
    const currentTicks = ticksRef.current;
    let chosenType: 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' = strategy.defaultContractType;

    if (strategy.id === 'continuous_trade') {
      checkAndExecuteContinuousTrade();
      return;
    }

    if (strategy.id === 'smc_structure_confluence') {
      checkAndExecuteSmcBreak();
      return;
    }

    if (strategy.id === 'consecutive_ticks_trend' && currentTicks.length >= 4) {
      const last4 = currentTicks.slice(-4);
      const is3Up = last4[3].quote > last4[2].quote && last4[2].quote > last4[1].quote && last4[1].quote > last4[0].quote;
      const is3Down = last4[3].quote < last4[2].quote && last4[2].quote < last4[1].quote && last4[1].quote < last4[0].quote;

      if (is3Up) {
        chosenType = 'CALL';
      } else if (is3Down) {
        chosenType = 'PUT';
      } else {
        setBotStatusMessage('Monitoring tick momentum... waiting for 3 consecutive directional ticks.');
        setTimeout(() => {
          if (isAutoTradingRef.current) evaluateAndTriggerAutoStrategyRef.current();
        }, 1200);
        return;
      }
    } else if (strategy.id === 'digit_even_odd_martingale' && currentTicks.length > 0) {
      const latestQuote = currentTicks[currentTicks.length - 1].quote;
      const lastDigit = parseInt(latestQuote.toFixed(2).slice(-1), 10);
      chosenType = lastDigit % 2 === 0 ? 'DIGITEVEN' : 'DIGITODD';
    } else if (strategy.id === 'mean_reversion_oscillator' && currentTicks.length >= 10) {
      const window = currentTicks.slice(-10).map((t) => t.quote);
      const min = Math.min(...window);
      const max = Math.max(...window);
      const current = window[window.length - 1];

      if (current >= max * 0.999) {
        chosenType = 'PUT';
      } else if (current <= min * 1.001) {
        chosenType = 'CALL';
      }
    }

    executeTrade(chosenType);
  }, [executeTrade, checkAndExecuteSmcBreak, checkAndExecuteContinuousTrade]);

  executeTradeRef.current = executeTrade;
  evaluateAndTriggerAutoStrategyRef.current = evaluateAndTriggerAutoStrategy;
  checkAndExecuteSmcBreakRef.current = checkAndExecuteSmcBreak;
  checkAndExecuteContinuousTradeRef.current = checkAndExecuteContinuousTrade;

  // Active trade 59-second settlement & SMC structure monitoring engine
  useEffect(() => {
    let lastScanSec = 0;

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const secondInCandle = nowSec % 60;
      const currentCandleEpoch = nowSec - secondInCandle;

      // Auto-heal and auto-settle expired open trades in tradeRecordsRef at candle timer :59s:
      for (const rec of tradeRecordsRef.current) {
        if (rec && rec.status === 'open') {
          if (!rec.purchaseTime || rec.purchaseTime <= 0) {
            rec.purchaseTime = Date.now();
          }
          if (nowSec >= getTradeTargetSettleSec(rec)) {
            settleOpenTrade(rec);
          } else if (rec.symbol && !activeTradesRef.current.has(rec.symbol)) {
            activeTradesRef.current.set(rec.symbol, rec);
            setActiveTrades(Array.from(activeTradesRef.current.values()));
            if (!activeTradeRef.current) activeTradeRef.current = rec;
          }
        }
      }

      // 1. Active trade countdown & exact :59s candle-timer settlement
      const currentActiveTrades = Array.from(activeTradesRef.current.values());
      if (currentActiveTrades.length > 0) {
        let minRemaining = 60;
        for (const openTrade of currentActiveTrades) {
          if (openTrade && openTrade.status === 'open') {
            if (!openTrade.purchaseTime || openTrade.purchaseTime <= 0) {
              openTrade.purchaseTime = Date.now();
            }
            const targetSettleSec = getTradeTargetSettleSec(openTrade);
            const remaining = Math.max(0, targetSettleSec - nowSec);
            if (remaining < minRemaining) minRemaining = remaining;

            if (nowSec >= targetSettleSec) {
              settleOpenTrade(openTrade);
            }
          }
        }
        setActiveTradeCountdown(minRemaining);
      } else {
        const openTrade = activeTradeRef.current;
        if (openTrade && openTrade.status === 'open') {
          if (!openTrade.purchaseTime || openTrade.purchaseTime <= 0) {
            openTrade.purchaseTime = Date.now();
          }
          const targetSettleSec = getTradeTargetSettleSec(openTrade);
          const remaining = Math.max(0, targetSettleSec - nowSec);
          setActiveTradeCountdown(remaining);

          if (nowSec >= targetSettleSec) {
            settleOpenTrade(openTrade);
          }
        }
      }

      // 2. SMC & Continuous Auto-Trader structure break monitoring and market scan status updates
      if (nowSec !== lastScanSec) {
        lastScanSec = nowSec;

        const isIndiv = individualMultiMarketEnabledRef.current;
        const canScan = isIndiv
          ? true
          : (!activeTradeRef.current && !isExecutingTradeRef.current && !isTradePendingRef.current);

        if (
          isAutoTradingRef.current &&
          selectedStrategyRef.current.id === 'smc_structure_confluence' &&
          canScan
        ) {
          checkAndExecuteSmcBreakRef.current();
        } else if (
          isAutoTradingRef.current &&
          selectedStrategyRef.current.id === 'continuous_trade'
        ) {
          checkAndExecuteContinuousTradeRef.current();
        }

        // Update real-time scan status across all volatility markets
        const scanItems: Record<string, MultiMarketScanItem> = {};
        const secRemaining = Math.max(0, 60 - secondInCandle);

        VOLATILITY_MARKETS.forEach((m) => {
          const sym = m.symbol;
          const cList = sym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[sym] || [];
          const q =
            sym === paramsRef.current.symbol && ticksRef.current.length > 0
              ? ticksRef.current[ticksRef.current.length - 1].quote
              : (marketTicksRef.current[sym]?.quote ?? (cList.length > 0 ? cList[cList.length - 1].close : m.basePrice));
          const smc = sym === paramsRef.current.symbol ? latestSmcResultRef.current : marketSmcRef.current[sym];
          const armed =
            marketPendingBreaksRef.current[sym] ||
            (sym === paramsRef.current.symbol ? pendingStructureBreakRef.current : null);
          const isTradedNow = activeTradesRef.current.has(sym) || activeTradeRef.current?.symbol === sym;
          const isSelected = selectedMarketsRef.current.includes(sym);

          scanItems[sym] = {
            symbol: sym,
            name: m.name,
            shortName: m.shortName,
            category: m.category,
            lastQuote: q,
            trend: smc?.currentTrend === 'BULLISH' ? 'BULLISH' : smc?.currentTrend === 'BEARISH' ? 'BEARISH' : 'NEUTRAL',
            activeSwingHigh: smc?.activeSwingHigh?.price,
            activeSwingLow: smc?.activeSwingLow?.price,
            armedBreak: armed,
            status: isTradedNow ? 'trading' : armed ? 'armed' : isAutoTradingRef.current && isSelected ? 'scanning' : 'idle',
            candleRemaining: secRemaining,
          };
        });
        setMarketScanStatus(scanItems);

        // Informative live status update when actively monitoring
        if (
          isAutoTradingRef.current &&
          (isIndiv || (!activeTradeRef.current && !isExecutingTradeRef.current)) &&
          nowSec % 2 === 0
        ) {
          const currentStake = calculateCurrentStake();
          const step = currentMartingaleStepRef.current;
          const smc = latestSmcResultRef.current;
          const currentTicks = ticksRef.current;
          const currentQuote = currentTicks.length > 0 ? currentTicks[currentTicks.length - 1].quote : null;

          const isMulti = multiMarketEnabledRef.current;
          const activeCount = selectedMarketsRef.current.length;
          const highStr = smc?.activeSwingHigh ? smc.activeSwingHigh.price.toFixed(2) : 'Scanning';
          const lowStr = smc?.activeSwingLow ? smc.activeSwingLow.price.toFixed(2) : 'Scanning';
          const quoteStr = currentQuote !== null ? currentQuote.toFixed(2) : '...';

          const phaseNum = currentPhaseRef.current || 1;
          const pauseThresh = paramsRef.current.pauseLossThreshold ?? 2;
          const pauseIndicator = isPausedAwaitingSignalRef.current
            ? ` | Phase ${phaseNum - 1} Paused (${pauseThresh}/${pauseThresh}): Awaiting Signal for Phase ${phaseNum}`
            : paramsRef.current.pauseTradeEnabled !== false
            ? ` | Phase ${phaseNum} (Attempt ${cycleLossCountRef.current + 1}/${pauseThresh})`
            : '';

          const armedPending =
            pendingStructureBreakRef.current ||
            Object.values(marketPendingBreaksRef.current).find((b) => Boolean(b)) ||
            null;

          const isVirtualCountNow = Boolean(paramsRef.current.virtualCountEnabled) && isInVirtualCountRef.current;
          const vCountPrefix = isVirtualCountNow
            ? `Virtual Count (${virtualCountLossesRef.current}/${paramsRef.current.virtualCountThreshold ?? 3}) | `
            : '';

          if (selectedStrategyRef.current.id === 'continuous_trade') {
            // Let Continuous Trade loop manage its own 58s / Post-Martingale pause status message
          } else if (isInVirtualSwitchRef.current) {
            const curBox = currentVirtualSwitchStageRef.current;
            const vLoss = virtualSwitchLossCountRef.current;
            setBotStatusMessage(
              `[Virtual Switch (Box ${curBox}) Active | Loss #${vLoss} | Target: 1 Win${pauseIndicator}]: ${
                isMulti ? `Scanning ${activeCount} Volatilities` : `Monitoring ${paramsRef.current.symbolName}`
              } for simulated trade setup. Real capital safe!`
            );
          } else if (isInVirtualHookRef.current) {
            const vLoss = virtualHookLossCountRef.current;
            setBotStatusMessage(
              `[Virtual Hook Active | Loss #${vLoss} | Target: 1 Win${pauseIndicator}]: ${
                isMulti ? `Scanning ${activeCount} Volatilities` : `Monitoring ${paramsRef.current.symbolName}`
              } for simulated trade setup. Real capital safe!`
            );
          } else if (selectedStrategyRef.current.id === 'smc_structure_confluence' && armedPending) {
            setBotStatusMessage(
              `[${vCountPrefix}Candle: ${secondInCandle}s/60s | $${currentStake.toFixed(2)}${
                step > 0 ? ` (Step ${step})` : ''
              }${pauseIndicator}]: ${armedPending.type} (${armedPending.direction.toUpperCase()} @ ${armedPending.level.toFixed(2)}) detected on ${armedPending.symbolName || armedPending.symbol}. Waiting for breaking candle to close before entry...`
            );
          } else if (isMulti) {
            setBotStatusMessage(
              `[${vCountPrefix}Candle: ${secondInCandle}s/60s | $${currentStake.toFixed(2)}${
                step > 0 ? ` (Step ${step})` : ''
              }${pauseIndicator}]: Multi-Market Active: Scanning ${activeCount} Volatilities for BOS/CHoCH candle-close breakout...`
            );
          } else {
            setBotStatusMessage(
              `[${vCountPrefix}Candle: ${secondInCandle}s/60s | $${currentStake.toFixed(2)}${
                step > 0 ? ` (Step ${step})` : ''
              }${pauseIndicator}]: Monitoring ${paramsRef.current.symbolName}. High: ${highStr} | Low: ${lowStr} | Price: ${quoteStr}`
            );
          }
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [settleOpenTrade, calculateCurrentStake, getTradeTargetSettleSec]);

  /**
   * Direct Client-Side Deriv Authentication Fallback
   * Enables 100% full authentication even on static deployments (Vercel, Netlify, GitHub Pages)
   * where a backend Express proxy server is not running.
   */
  const authorizeTokenDirectly = useCallback(async (
    token: string,
    requestedAppId: string,
    preferredAccountId?: string,
    preferVirtual?: boolean
  ): Promise<{
    account: DerivAccount;
    status: DerivUserStatus;
    otpWsUrl?: string;
  }> => {
    if (!token.startsWith('DEMO') && !isPlausibleDerivToken(token)) {
      throw new Error(
        'Invalid API token format. Deriv API tokens are alphanumeric without spaces. Please check your token or use Free Demo mode.'
      );
    }

    if (token.startsWith('pat_')) {
      const candidates = [requestedAppId, '33IM5dIMuFaBupAhk042L', '1089'].filter(Boolean);
      let accounts: any[] = [];
      let successfulAppId: string = requestedAppId || '33IM5dIMuFaBupAhk042L';
      let lastError = '';

      for (const patAppId of candidates) {
        try {
          const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            headers: {
              Authorization: `Bearer ${token}`,
              'Deriv-App-ID': patAppId,
            },
          });
          const contentType = response.headers.get('content-type') || '';
          const rawText = await response.text();
          if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
            const json = JSON.parse(rawText);
            if (response.ok && Array.isArray(json?.data) && json.data.length > 0) {
              accounts = json.data;
              successfulAppId = patAppId;
              break;
            } else if (json?.message || json?.error) {
              lastError = json.message || json.error;
            }
          }
        } catch (err: any) {
          lastError = err?.message || 'Direct connection to Deriv API failed';
        }
      }

      if (accounts.length === 0) {
        throw new Error(
          lastError || 'Unable to authenticate Deriv PAT token. Please verify your token permissions on Deriv.com.'
        );
      }

      // Honor user's previously selected accountId or Demo/Virtual preference before defaulting to Real
      const selected =
        (preferredAccountId ? accounts.find((a: any) => a.account_id === preferredAccountId) : null) ||
        (preferVirtual === true
          ? accounts.find((a: any) => a.account_type === 'demo' || String(a.account_id).startsWith('DOT') || String(a.account_id).startsWith('VRTC'))
          : null) ||
        accounts.find((a: any) => a.account_type === 'real' || !String(a.account_id).startsWith('DOT')) ||
        accounts.find((a: any) => a.account_type === 'demo') ||
        accounts[0];
      let otpWsUrl: string | undefined;

      try {
        const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(selected.account_id)}/otp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Deriv-App-ID': successfulAppId,
            'Content-Type': 'application/json',
          },
        });
        const otpRaw = await otpRes.text();
        if (otpRaw.trim().startsWith('{')) {
          const otpJson = JSON.parse(otpRaw);
          otpWsUrl = otpJson?.data?.url || otpJson?.url;
        }
      } catch {
        // OTP optional; standard websocket can still be used
      }

      const authStatus: DerivUserStatus = {
        status: ['authenticated', 'options_api_active'],
        riskClassification: 'low',
        promptClientToAuthenticate: 0,
        authentication: {
          document: { status: 'verified' },
          identity: { status: 'verified' },
        },
      };

      const account: DerivAccount = {
        loginid: selected.account_id,
        currency: selected.currency || 'USD',
        balance: Number(selected.balance || 0),
        isVirtual: selected.account_type === 'demo',
        fullname: selected.account_type === 'demo' ? `Deriv Demo (${selected.account_id})` : `Deriv Real (${selected.account_id})`,
        email: 'tradevoult@gmail.com',
        token,
        appId: successfulAppId,
        scopes: ['read', 'trade', 'options'],
        accountList: accounts.map((a: any) => ({
          loginid: a.account_id,
          balance: Number(a.balance),
          currency: a.currency,
          is_virtual: a.account_type === 'demo' ? 1 : 0,
          account_type: a.account_type,
        })),
        status: authStatus,
      };

      return { account, status: authStatus, otpWsUrl };
    } else {
      // Standard Deriv WebSocket Token authorization with multi-endpoint fallback
      const candidateEndpoints = [
        `wss://ws.derivws.com/websockets/v3?app_id=1089&l=EN&brand=deriv`,
        `wss://ws.binaryws.com/websockets/v3?app_id=1089&l=EN&brand=deriv`,
        `wss://blue.derivws.com/websockets/v3?app_id=1089&l=EN&brand=deriv`,
      ];

      let lastWsError = 'Could not open WebSocket connection to Deriv';

      for (const endpoint of candidateEndpoints) {
        try {
          const result = await new Promise<{ account: DerivAccount; status: DerivUserStatus }>((resolve, reject) => {
            let socket: WebSocket | null = null;
            let timer: NodeJS.Timeout | null = null;
            let isSettled = false;

            const cleanup = () => {
              if (timer) clearTimeout(timer);
              if (socket) {
                try {
                  socket.onopen = null;
                  socket.onmessage = null;
                  socket.onerror = null;
                  socket.close();
                } catch {}
              }
            };

            try {
              socket = new WebSocket(endpoint);
            } catch (err: any) {
              reject(err);
              return;
            }

            timer = setTimeout(() => {
              if (isSettled) return;
              isSettled = true;
              cleanup();
              reject(new Error('Deriv WebSocket authorization timed out after 7 seconds'));
            }, 7000);

            socket.onopen = () => {
              if (isSettled || !socket) return;
              try {
                socket.send(JSON.stringify({ authorize: token, req_id: 1 }));
              } catch (err) {
                if (isSettled) return;
                isSettled = true;
                cleanup();
                reject(err);
              }
            };

            socket.onmessage = (event) => {
              if (isSettled) return;
              try {
                const res = JSON.parse(event.data.toString());
                if (res.req_id === 1) {
                  isSettled = true;
                  cleanup();
                  if (res.error) {
                    const errObj = new Error(res.error.message || 'Deriv token authorization failed');
                    (errObj as any).isTokenRejected = true;
                    reject(errObj);
                    return;
                  }
                  const auth = res.authorize;
                  const authStatus: DerivUserStatus = {
                    status: ['authenticated'],
                    riskClassification: 'low',
                    promptClientToAuthenticate: 0,
                  };
                  let resolvedLoginId = auth.loginid;
                  let resolvedIsVirtual = Boolean(auth.is_virtual);
                  let resolvedBalance = Number(auth.balance || 0);
                  let resolvedCurrency = auth.currency || 'USD';
                  if (Array.isArray(auth.account_list) && auth.account_list.length > 0) {
                    const matched =
                      (preferredAccountId ? auth.account_list.find((a: any) => a.loginid === preferredAccountId) : null) ||
                      (preferVirtual === true ? auth.account_list.find((a: any) => Boolean(a.is_virtual) || a.loginid?.startsWith('VRTC')) : null);
                    if (matched) {
                      resolvedLoginId = matched.loginid;
                      resolvedIsVirtual = Boolean(matched.is_virtual || matched.loginid?.startsWith('VRTC'));
                      if (typeof matched.balance === 'number') resolvedBalance = matched.balance;
                      if (matched.currency) resolvedCurrency = matched.currency;
                    }
                  }
                  const account: DerivAccount = {
                    loginid: resolvedLoginId,
                    currency: resolvedCurrency,
                    balance: resolvedBalance,
                    isVirtual: resolvedIsVirtual,
                    fullname: resolvedIsVirtual ? `Deriv Demo (${resolvedLoginId})` : (auth.fullname || auth.email || resolvedLoginId),
                    email: auth.email || '',
                    token,
                    appId: '1089',
                    scopes: auth.scopes,
                    accountList: auth.account_list,
                    status: authStatus,
                  };
                  resolve({ account, status: authStatus });
                }
              } catch (e) {
                if (isSettled) return;
                isSettled = true;
                cleanup();
                reject(e);
              }
            };

            socket.onerror = () => {
              if (isSettled) return;
              isSettled = true;
              cleanup();
              reject(new Error('Could not open WebSocket connection to ' + endpoint));
            };
          });

          return result;
        } catch (endpointErr: any) {
          lastWsError = endpointErr?.message || 'WebSocket connection error';
          // If the token was explicitly rejected by Deriv (e.g. InvalidToken), do NOT try other endpoints
          if ((endpointErr as any)?.isTokenRejected || /invalid token|token is invalid|expired/i.test(lastWsError)) {
            throw new Error(lastWsError || 'Your Deriv API token is invalid or expired. Please check your token or use Demo mode.');
          }
          continue;
        }
      }

      throw new Error(
        'Unable to establish WebSocket connection to Deriv. Please check your network connection or click "Use Free Demo Account" to trade immediately.'
      );
    }
  }, []);

  // Connect to Deriv WebSocket and fetch user status
  const handleConnect = useCallback(
    async (rawToken: string, newAppId: string, preferredAccountId?: string, preferVirtual?: boolean) => {
      setConnectionError(undefined);
      const cleanToken = (rawToken || '').trim().replace(/^["']|["']$/g, '').trim();
      const existingSession = autoRecoveryStorage.loadActiveSession();
      const targetAccountId =
        preferredAccountId ||
        (existingSession && existingSession.token === cleanToken ? existingSession.accountId : undefined);
      const targetIsVirtual =
        typeof preferVirtual === 'boolean'
          ? preferVirtual
          : (existingSession && existingSession.token === cleanToken ? Boolean(existingSession.isVirtual) : false);

      const isPat = cleanToken.startsWith('pat_');
      const candidateApp = (newAppId || '').trim();
      const resolvedAppId = isPat
        ? (candidateApp && candidateApp !== '1089' ? candidateApp : '33IM5dIMuFaBupAhk042L')
        : (candidateApp || '1089');
      setAppId(resolvedAppId);
      setConnectionState('authorizing');
      setBotStatusMessage('Connecting to Deriv WebSocket and authorizing API token...');

      // If test demo token
      if (cleanToken.startsWith('DEMO_') || cleanToken === 'DEMO') {
        const savedSession = existingSession;
        const savedMart = autoRecoveryStorage.loadMartingaleState();
        const demoId = targetAccountId || (savedSession && savedSession.accountId) || ('VRTC' + Math.floor(1000000 + Math.random() * 9000000));
        const savedStartingBal =
          autoRecoveryStorage.loadAccountStartingBalance(demoId) ||
          autoRecoveryStorage.loadStartingBalance() ||
          (savedMart?.startingBalance && savedMart.startingBalance > 0 ? savedMart.startingBalance : 0);
        const existingTrades = autoRecoveryStorage.loadAccountTradeRecords(demoId);
        const fallbackTrades = existingTrades.length > 0 ? existingTrades : autoRecoveryStorage.loadTradeRecords();
        const hasExistingHistory = fallbackTrades.filter(t => t.status === 'won' || t.status === 'lost').length > 0;
        const effectiveBal = typeof savedSession?.balance === 'number'
          ? savedSession.balance
          : (savedMart?.startingBalance && savedMart.startingBalance > 0 ? savedMart.startingBalance : 10000.0);
        const effectiveStartingBal = (hasExistingHistory && savedStartingBal > 0)
          ? savedStartingBal
          : effectiveBal;

        const demoAccount: DerivAccount = {
          loginid: demoId,
          currency: 'USD',
          balance: effectiveBal,
          isVirtual: true,
          fullname: `Demo Virtual Trader (${demoId})`,
          email: 'demo@deriv.com',
          token: cleanToken,
          appId: resolvedAppId,
          status: {
            status: ['authenticated', 'allow_document_upload'],
            riskClassification: 'low',
            promptClientToAuthenticate: 0,
          },
        };
        sessionAuthRef.current = { token: cleanToken };
        accountRef.current = demoAccount;
        startingBalanceRef.current = effectiveStartingBal;
        currentBalanceRef.current = effectiveBal;
        setAccount(demoAccount);
        setStartingBalance(effectiveStartingBal);
        setCurrentBalance(effectiveBal);
        autoRecoveryStorage.saveStartingBalance(effectiveStartingBal);
        autoRecoveryStorage.saveAccountStartingBalance(demoId, effectiveStartingBal);
        setCurrency('USD');
        setConnectionState('authorized');
        setIsLoginModalOpen(false);
        setIsRestoringSession(false);
        setBotStatusMessage(`Logged in with Demo Virtual Account (${demoId}). Balance: $${effectiveBal.toFixed(2)} USD`);

        autoRecoveryStorage.saveActiveSession({
          token: cleanToken,
          appId: resolvedAppId,
          accountId: demoId,
          isVirtual: true,
          balance: effectiveBal,
          currency: 'USD',
        });

        // Check if resuming or auto-restarting trading from network glitch or reload
        const glitchState = autoRecoveryStorage.getGlitchReloadState();
        const shouldAutoRestart =
          (glitchState && glitchState.isPending && glitchState.shouldResumeAutoTrading) ||
          autoRecoveryStorage.loadAutoTradingState() ||
          isAutoTradingRef.current;

        if (glitchState && glitchState.isPending) {
          autoRecoveryStorage.clearGlitchReloadState();
          setNetworkRestoredNotification('Network reconnected! Session restored and trading continuing.');
          setTimeout(() => setNetworkRestoredNotification(null), 6000);
        }

        if (shouldAutoRestart) {
          setIsAutoTrading(true);
          isAutoTradingRef.current = true;
          autoRecoveryStorage.saveAutoTradingState(true);
          const currentStep = currentMartingaleStepRef.current;
          const currentStake = calculateCurrentStake();
          setBotStatusMessage(
            `[Auto-Restarted]: Auto-trading resumed from where it stopped. Preserved Martingale Step ${currentStep} ($${currentStake.toFixed(2)} stake).`
          );
        }

        // Reconcile and settle any in-flight trade that was running before reload
        reconcileRunningTradeAfterReloadRef.current();

        derivWs.setAppId(resolvedAppId);
        derivWs.setAccountId(demoId);
        derivWs.connect('DEMO', resolvedAppId);
        derivWs.subscribeTicks(params.symbol);
        derivWs.subscribeCandles(params.symbol, 60, 120);
        fetchCandlesForMarket(params.symbol);
        return;
      }

      try {
        sessionAuthRef.current = { token: cleanToken };

        let liveAccount: DerivAccount | null = null;
        let authStatus: DerivUserStatus | null = null;
        let authAppId = resolvedAppId;
        let otpWsUrl: string | undefined = undefined;

        // 1. First attempt: Authenticate via backend /api/authorize gateway
        let backendOk = false;
        try {
          const res = await fetch('/api/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: cleanToken,
              appId: resolvedAppId,
              accountId: targetAccountId,
              isVirtual: targetIsVirtual,
            }),
          });

          const contentType = res.headers.get('content-type') || '';
          const rawText = await res.text();
          if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
            const data = JSON.parse(rawText);
            if (res.ok && data?.account) {
              backendOk = true;
              const authAccount = data.account;
              authStatus = data.status;
              otpWsUrl = authAccount.otpWsUrl;
              authAppId = authAccount.appId || resolvedAppId;

              liveAccount = {
                loginid: authAccount.loginid,
                currency: authAccount.currency || 'USD',
                balance: Number(authAccount.balance || 0),
                isVirtual: Boolean(authAccount.isVirtual),
                fullname: authAccount.fullname || authAccount.email || authAccount.loginid,
                email: authAccount.email || '',
                token: cleanToken,
                appId: authAppId,
                scopes: authAccount.scopes,
                accountList: authAccount.accountList,
                status: authStatus || undefined,
              };
            } else if (!res.ok && data?.error) {
              const authErr: any = new Error(data.error);
              if (data.code === 'INVALID_OR_EXPIRED_TOKEN' || data.code === 'INVALID_TOKEN_FORMAT' || res.status === 401) {
                authErr.isTokenRejected = true;
              }
              throw authErr;
            }
          }
        } catch (backendErr: any) {
          if (backendErr?.isTokenRejected) {
            throw backendErr;
          }
          const bMsg = backendErr?.message || '';
          if (bMsg && !bMsg.includes('Unexpected token') && !bMsg.includes('is not valid JSON')) {
            console.warn('[Backend Auth Gateway Warning]:', bMsg);
          }
        }

        // 2. Direct client-side Deriv authorization fallback:
        // Automatically kicks in if deployed on static host (Vercel, Netlify, GitHub Pages) without an active backend container
        if (!backendOk || !liveAccount) {
          console.log('[Auth Gateway]: Backend gateway returned non-JSON / 404. Falling back to direct Deriv API...');
          const directResult = await authorizeTokenDirectly(cleanToken, resolvedAppId, targetAccountId, targetIsVirtual);
          liveAccount = directResult.account;
          authStatus = directResult.status;
          otpWsUrl = directResult.otpWsUrl;
          authAppId = directResult.account.appId || resolvedAppId;
        }

        // Restore per-account trade history & starting balance without wiping across refresh
        const savedAccountTrades = autoRecoveryStorage.loadAccountTradeRecords(liveAccount.loginid);
        const activeTradesList = tradeRecordsRef.current.length > 0
          ? tradeRecordsRef.current
          : (savedAccountTrades.length > 0 ? savedAccountTrades : autoRecoveryStorage.loadTradeRecords());
        if (savedAccountTrades.length > 0 && tradeRecordsRef.current.length === 0) {
          setTradeRecords(savedAccountTrades);
        }
        const savedStartingBal =
          autoRecoveryStorage.loadAccountStartingBalance(liveAccount.loginid) ||
          autoRecoveryStorage.loadStartingBalance();
        const hasExistingHistory = activeTradesList.filter(t => t.status === 'won' || t.status === 'lost').length > 0;
        const effectiveStartingBal = (hasExistingHistory && savedStartingBal > 0)
          ? savedStartingBal
          : liveAccount.balance;

        accountRef.current = liveAccount;
        startingBalanceRef.current = effectiveStartingBal;
        currentBalanceRef.current = liveAccount.balance;
        setAccount(liveAccount);
        setStartingBalance(effectiveStartingBal);
        setCurrentBalance(liveAccount.balance);
        autoRecoveryStorage.saveStartingBalance(effectiveStartingBal);
        autoRecoveryStorage.saveAccountStartingBalance(liveAccount.loginid, effectiveStartingBal);
        setCurrency(liveAccount.currency);
        setConnectionState('authorized');
        setIsLoginModalOpen(false);
        setIsRestoringSession(false);
        setConnectionError(undefined);

        autoRecoveryStorage.saveActiveSession({
          token: cleanToken,
          appId: authAppId,
          accountId: liveAccount.loginid,
          isVirtual: Boolean(liveAccount.isVirtual),
          balance: liveAccount.balance,
          currency: liveAccount.currency,
          fullname: liveAccount.fullname,
        });

        // Check if resuming or auto-restarting trading from network glitch or reload
        const glitchState = autoRecoveryStorage.getGlitchReloadState();
        const shouldAutoRestart =
          (glitchState && glitchState.isPending && glitchState.shouldResumeAutoTrading) ||
          autoRecoveryStorage.loadAutoTradingState() ||
          isAutoTradingRef.current;

        if (glitchState && glitchState.isPending) {
          autoRecoveryStorage.clearGlitchReloadState();
          setNetworkRestoredNotification('Network reconnected! Session restored and trading continuing.');
          setTimeout(() => setNetworkRestoredNotification(null), 6000);
        }

        if (shouldAutoRestart) {
          setIsAutoTrading(true);
          isAutoTradingRef.current = true;
          autoRecoveryStorage.saveAutoTradingState(true);
          const currentStep = currentMartingaleStepRef.current;
          const currentStake = calculateCurrentStake();
          setBotStatusMessage(
            `[Auto-Restarted]: Auto-trading resumed from where it stopped. Preserved Martingale Step ${currentStep} ($${currentStake.toFixed(2)} stake).`
          );
        }

        const statusLabel = authStatus?.status?.includes('authenticated')
          ? 'Verified'
          : authStatus?.riskClassification
          ? `Risk: ${authStatus.riskClassification}`
          : 'Active';

        setBotStatusMessage(
          `Connected to Deriv account ${liveAccount.loginid}! Status: ${statusLabel} | Balance: ${liveAccount.balance.toFixed(2)} ${liveAccount.currency}`
        );

        // 3. Connect client WebSocket directly for real-time live trading and ticks
        derivWs.setAppId(authAppId);
        derivWs.setAccountId(liveAccount.loginid);
        derivWs.connect(cleanToken, authAppId, otpWsUrl);
        derivWs.subscribeTicks(params.symbol);
        derivWs.subscribeCandles(params.symbol, 60, 120);
        fetchCandlesForMarket(params.symbol);

        // Reconcile and settle any in-flight running trade from before reload
        reconcileRunningTradeAfterReloadRef.current();
      } catch (err: any) {
        setIsRestoringSession(false);
        sessionAuthRef.current = null;
        derivWs.disconnect(false);
        derivWs.subscribeTicks(params.symbol);
        derivWs.subscribeCandles(params.symbol, 60, 120);
        setConnectionState('error');
        const rawMsg = err.message || 'Unable to authenticate with Deriv WebSocket.';
        const cleanMsg = rawMsg
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const msg = /Unexpected token.*JSON|The page could not be found/i.test(cleanMsg)
          ? 'Connecting directly to Deriv API... Please click Connect again.'
          : /502|bad gateway|cloudflare|api\.derivws\.com/i.test(cleanMsg)
          ? 'Deriv Options API server (api.derivws.com) returned 502 Bad Gateway. Deriv servers are experiencing temporary service disruption. Please try again shortly or use the Free Demo mode.'
          : /WebSocket connection error|Could not open WebSocket|Could not establish WebSocket/i.test(cleanMsg)
          ? 'Could not connect to Deriv WebSocket gateway. Please check your internet connection, verify your API token, or click "Use Free Demo Account" to continue testing immediately.'
          : cleanMsg;
        setConnectionError(msg);
        setBotStatusMessage(`Authentication notice: ${msg}`);

        // Only clear saved active session when the token was explicitly rejected/invalid/expired;
        // transient network errors keep the user's selected Demo/Real session intact for next refresh.
        const isRejectedToken = Boolean(
          (err as any)?.isTokenRejected ||
          /invalid[\s_]?token|token is invalid|invalid_or_expired_token|invalid_token_format|expired/i.test(cleanMsg)
        );
        if (isRejectedToken) {
          autoRecoveryStorage.clearActiveSession();
        }

        // Open LoginModal so user can easily enter a valid token or switch to Demo mode
        setIsLoginModalOpen(true);
      }
    },
    [params.symbol, authorizeTokenDirectly]
  );

  handleConnectRef.current = handleConnect;

  // Switch between Demo and Real accounts seamlessly
  const handleSwitchAccount = useCallback(
    async (newAccountId: string) => {
      const session = sessionAuthRef.current;
      if (!session || !session.token) return;
      const cleanToken = session.token;
      setBotStatusMessage(`Switching to account ${newAccountId}...`);

      try {
        const isPat = cleanToken.startsWith('pat_');
        const effectiveAppId = isPat ? (appId && appId !== '1089' ? appId : '33IM5dIMuFaBupAhk042L') : appId;

        // 1. Immediately locate the target account in our existing account list
        const targetAcc = (accountRef.current?.accountList || []).find(
          (a: any) => a.loginid === newAccountId
        );
        const isDemoAccount = Boolean(
          targetAcc?.is_virtual ||
          targetAcc?.account_type === 'demo' ||
          newAccountId.startsWith('VRTC') ||
          newAccountId.startsWith('DOT')
        );
        const targetCurr = targetAcc?.currency || 'USD';

        // Initial known balance for the target account (Demo defaults to 10,000, Real defaults to targetAcc.balance)
        const initialBal = (targetAcc && typeof targetAcc.balance === 'number' && !isNaN(targetAcc.balance))
          ? Number(targetAcc.balance)
          : (isDemoAccount ? 10000.0 : 0.0);

        // Save outgoing account's trade history & starting balance before switching
        const prevAccId = accountRef.current?.loginid;
        if (prevAccId && prevAccId !== newAccountId) {
          autoRecoveryStorage.saveAccountTradeRecords(prevAccId, tradeRecordsRef.current);
          if (startingBalanceRef.current > 0) {
            autoRecoveryStorage.saveAccountStartingBalance(prevAccId, startingBalanceRef.current);
          }
        }

        // Load target account's persisted trade history instead of wiping it
        const targetTrades = autoRecoveryStorage.loadAccountTradeRecords(newAccountId);
        const targetHasSettled = targetTrades.some((t) => t.status === 'won' || t.status === 'lost');
        const savedTargetStartBal = autoRecoveryStorage.loadAccountStartingBalance(newAccountId);
        const effectiveTargetStartBal = (targetHasSettled && savedTargetStartBal > 0)
          ? savedTargetStartBal
          : initialBal;

        // 2. Instantly update UI states (Starting balance, Current balance, Trade history, and Account)
        setCurrentBalance(initialBal);
        setStartingBalance(effectiveTargetStartBal);
        currentBalanceRef.current = initialBal;
        startingBalanceRef.current = effectiveTargetStartBal;
        autoRecoveryStorage.saveStartingBalance(effectiveTargetStartBal);
        autoRecoveryStorage.saveAccountStartingBalance(newAccountId, effectiveTargetStartBal);
        setTradeRecords(targetTrades);
        tradeRecordsRef.current = targetTrades;
        autoRecoveryStorage.saveTradeRecords(targetTrades);
        handledContractIdsRef.current.clear();
        settledContractOutcomesRef.current.clear();
        targetTrades.forEach((t) => {
          const cid = Number(t.contractId);
          if (!isNaN(cid) && cid > 0 && (t.status === 'won' || t.status === 'lost')) {
            settledContractOutcomesRef.current.set(cid, t.status);
            handledContractIdsRef.current.add(cid);
          }
        });
        autoTraderStartPnlOffsetRef.current = 0;
        autoRecoveryStorage.saveAutoTraderPnlBaseline(0);
        setCurrency(targetCurr);

        const nextFullName = isDemoAccount ? `Deriv Demo (${newAccountId})` : `Deriv Real (${newAccountId})`;
        setAccount((prev) => {
          if (!prev) return null;
          const updatedList = (prev.accountList || []).map((a: any) =>
            a.loginid === newAccountId ? { ...a, balance: initialBal, currency: targetCurr } : a
          );
          const updated: DerivAccount = {
            ...prev,
            loginid: newAccountId,
            balance: initialBal,
            currency: targetCurr,
            isVirtual: isDemoAccount,
            fullname: nextFullName,
            accountList: updatedList,
          };
          accountRef.current = updated;
          return updated;
        });

        setBotStatusMessage(`Switched to account ${newAccountId}. Balance: $${initialBal.toFixed(2)} ${targetCurr}`);

        autoRecoveryStorage.saveActiveSession({
          token: cleanToken,
          appId: effectiveAppId,
          accountId: newAccountId,
          isVirtual: isDemoAccount,
          balance: initialBal,
          currency: targetCurr,
          fullname: nextFullName,
        });

        derivWs.setAccountId(newAccountId);

        // Asynchronously hydrate full IndexedDB history for this account if >1000 trades exist
        autoRecoveryStorage.loadAccountTradeRecordsAsync(newAccountId).then((idbTrades) => {
          if (accountRef.current?.loginid === newAccountId && idbTrades.length > targetTrades.length) {
            setTradeRecords(idbTrades);
            tradeRecordsRef.current = idbTrades;
          }
        }).catch(() => {});

        // 3. Connect live WebSocket feed & fetch verified balance in the background
        if (isPat) {
          try {
            const otpRes = await fetch('/api/otp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: cleanToken, accountId: newAccountId, appId: effectiveAppId }),
            });
            const contentType = otpRes.headers.get('content-type') || '';
            const rawText = await otpRes.text();
            if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
              const otpData = JSON.parse(rawText);
              if (otpData?.url) {
                derivWs.connect(cleanToken, effectiveAppId, otpData.url);
              }
            } else {
              // Direct OTP fetch fallback
              const directOtpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(newAccountId)}/otp`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${cleanToken}`,
                  'Deriv-App-ID': effectiveAppId,
                  'Content-Type': 'application/json',
                },
              });
              const directRaw = await directOtpRes.text();
              if (directRaw.trim().startsWith('{')) {
                const directJson = JSON.parse(directRaw);
                const url = directJson?.data?.url || directJson?.url;
                if (url) derivWs.connect(cleanToken, effectiveAppId, url);
              }
            }
          } catch {}

          // Refresh live account balance from backend or direct Deriv Options API
          let fetchedBal: number | undefined;
          let fetchedCurr: string = targetCurr;
          try {
            const balRes = await fetch('/api/account/balance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: cleanToken, accountId: newAccountId, appId: effectiveAppId }),
            });
            const contentType = balRes.headers.get('content-type') || '';
            const rawText = await balRes.text();
            if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
              const balData = JSON.parse(rawText);
              if (balData?.balance?.balance !== undefined) {
                fetchedBal = Number(balData.balance.balance);
                if (balData.balance.currency) fetchedCurr = balData.balance.currency;
              }
            }
          } catch {}

          if (typeof fetchedBal !== 'number') {
            try {
              const directAccRes = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
                headers: {
                  Authorization: `Bearer ${cleanToken}`,
                  'Deriv-App-ID': effectiveAppId,
                },
              });
              if (directAccRes.ok) {
                const dData = await directAccRes.json();
                const list = dData?.data || [];
                const m = list.find((a: any) => a.account_id === newAccountId);
                if (m && typeof m.balance === 'number') {
                  fetchedBal = Number(m.balance);
                  if (m.currency) fetchedCurr = m.currency;
                }
              }
            } catch {}
          }

          if (typeof fetchedBal === 'number') {
            setCurrentBalance(fetchedBal);
            currentBalanceRef.current = fetchedBal;
            if (!targetHasSettled) {
              setStartingBalance(fetchedBal);
              startingBalanceRef.current = fetchedBal;
              autoRecoveryStorage.saveStartingBalance(fetchedBal);
              autoRecoveryStorage.saveAccountStartingBalance(newAccountId, fetchedBal);
            }
            if (fetchedCurr) setCurrency(fetchedCurr);
            setAccount((prev) => {
              if (!prev || prev.loginid !== newAccountId) return prev;
              const updatedList = (prev.accountList || []).map((a: any) =>
                a.loginid === newAccountId ? { ...a, balance: fetchedBal!, currency: fetchedCurr } : a
              );
              const updated: DerivAccount = {
                ...prev,
                balance: fetchedBal!,
                currency: fetchedCurr,
                accountList: updatedList,
              };
              accountRef.current = updated;
              return updated;
            });
            setBotStatusMessage(`Switched to account ${newAccountId}. Balance: $${fetchedBal.toFixed(2)} ${fetchedCurr}`);
          }
        } else {
          derivWs.connect(cleanToken, effectiveAppId);
        }
      } catch (err: any) {
        setBotStatusMessage(`Failed to switch account: ${err.message || 'Error switching account'}`);
      }
    },
    [appId]
  );

  // Handle Disconnect / Logout
  const handleDisconnect = useCallback(() => {
    const activeAccId = accountRef.current?.loginid;
    setIsAutoTrading(false);
    isAutoTradingRef.current = false;
    setAutoTraderStartedAt(null);
    autoTraderStartedAtRef.current = null;
    setAutoTraderStoppedElapsedMs(null);
    autoRecoveryStorage.saveAutoTraderTimer(null, null);
    sessionAuthRef.current = null;
    derivWs.disconnect();
    setAccount(null);
    accountRef.current = null;
    setConnectionState('disconnected');
    setIsRestoringSession(false);
    setStartingBalance(0);
    setCurrentBalance(0);
    setTradeRecords([]);
    setCorrectedLossItems([]);
    autoTraderStartPnlOffsetRef.current = 0;
    autoRecoveryStorage.saveAutoTraderPnlBaseline(0);
    autoRecoveryStorage.clearActiveSession();
    autoRecoveryStorage.clearGlitchReloadState();
    autoRecoveryStorage.saveAutoTradingState(false);
    autoRecoveryStorage.clearTradeRecords();
    if (activeAccId) {
      autoRecoveryStorage.clearAccountTradeRecords(activeAccId);
      autoRecoveryStorage.clearAccountStartingBalance(activeAccId);
    }
    autoRecoveryStorage.clearCorrectedLossItems();
    setBotStatusMessage('Disconnected from Deriv. Session cleared.');
  }, []);

  // Synchronize balance
  const handleSyncBalance = useCallback(async () => {
    const session = sessionAuthRef.current;
    if (!session || session.token.startsWith('DEMO')) return;
    try {
      const res = await fetch('/api/account/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token }),
      });
      const data = await res.json();
      if (res.ok && data.balance) {
        const bal = Number(data.balance.balance);
        setCurrentBalance(bal);
        if (data.balance.currency) setCurrency(data.balance.currency);
        setBotStatusMessage(`Balance updated: ${bal.toFixed(2)} ${data.balance.currency || 'USD'}`);
      }
    } catch {
      // ignore
    }
  }, []);

  // Clear all trade history (only triggered manually by user)
  const handleClearTradeHistory = useCallback(() => {
    const activeAccId = accountRef.current?.loginid;
    // Retain currently running active contract if one is open so live monitoring remains intact
    const openTrades = tradeRecordsRef.current.filter((t) => t.status === 'open');
    setTradeRecords(openTrades);
    tradeRecordsRef.current = openTrades;
    if (openTrades.length === 0) {
      autoRecoveryStorage.clearTradeRecords();
      if (activeAccId) autoRecoveryStorage.clearAccountTradeRecords(activeAccId);
    } else {
      autoRecoveryStorage.saveTradeRecords(openTrades);
      if (activeAccId) autoRecoveryStorage.saveAccountTradeRecords(activeAccId, openTrades);
    }
    handledContractIdsRef.current.clear();
    settledContractOutcomesRef.current.clear();
    autoTraderStartPnlOffsetRef.current = 0;
    autoRecoveryStorage.saveAutoTraderPnlBaseline(0);

    // Reset starting balance and P&L baseline only when user explicitly decides to delete trade history
    const freshStartBal = currentBalanceRef.current > 0 ? currentBalanceRef.current : 0;
    setStartingBalance(freshStartBal);
    startingBalanceRef.current = freshStartBal;
    autoRecoveryStorage.saveStartingBalance(freshStartBal);
    if (activeAccId && freshStartBal > 0) {
      autoRecoveryStorage.saveAccountStartingBalance(activeAccId, freshStartBal);
    }
    setCorrectedLossItems([]);
    autoRecoveryStorage.clearCorrectedLossItems();

    setBotStatusMessage('[TRADE HISTORY CLEARED]: All past trade records removed and P&L reset to $0.00.');
  }, []);

  const handleTradeCompletedRef = useRef(handleTradeCompleted);
  handleTradeCompletedRef.current = handleTradeCompleted;

  // Reconcile and settle any in-flight running trade after browser auto-refresh or reload
  const reconcileRunningTradeAfterReload = useCallback(async () => {
    // 1. Synchronously gather ALL running in-flight trades across all storages
    const allCandidates: TradeRecord[] = [];
    const now = Date.now();
    const curSec = Math.floor(now / 1000);
    const curCandle = curSec - (curSec % 60);

    const isRunning = (t?: TradeRecord | null) =>
      Boolean(t && t.status === 'open' && t.contractId);

    const multiFromStorage = autoRecoveryStorage.loadActiveTrades();
    if (Array.isArray(multiFromStorage)) {
      multiFromStorage.forEach((t) => {
        if (isRunning(t) && !allCandidates.some((x) => x.contractId === t.contractId)) allCandidates.push(t);
      });
    }
    const singleFromStorage = autoRecoveryStorage.loadActiveTrade();
    if (singleFromStorage && isRunning(singleFromStorage) && !allCandidates.some((x) => x.contractId === singleFromStorage.contractId)) {
      allCandidates.push(singleFromStorage);
    }
    const openFromHistory = tradeRecordsRef.current.filter((t) => isRunning(t));
    openFromHistory.forEach((t) => {
      if (!allCandidates.some((x) => x.contractId === t.contractId)) allCandidates.push(t);
    });
    for (const t of activeTradesRef.current.values()) {
      if (isRunning(t) && !allCandidates.some((x) => x.contractId === t.contractId)) allCandidates.push(t);
    }

    if (allCandidates.length === 0) return;

    // 2. IMMEDIATELY (synchronously before any async network await) register and lock all running trades!
    let minRemaining = 59;
    for (const t of allCandidates) {
      if (t.symbol) {
        activeTradesRef.current.set(t.symbol, t);
        marketLastExecutedCandleEpochRef.current[t.symbol] = curCandle;
      }
      const cId = Number(t.contractId);
      if (cId > 0 && !isTradeRecordVirtual(t)) {
        derivWs.subscribeProposalOpenContract(cId);
      }
      const rem = Math.max(0, getTradeTargetSettleSec(t) - curSec);
      if (rem < minRemaining) minRemaining = rem;
    }

    if (!activeTradeRef.current && allCandidates.length > 0) {
      activeTradeRef.current = allCandidates[0];
    }
    setActiveTrades(Array.from(activeTradesRef.current.values()));
    setActiveTradeCountdown(minRemaining);
    autoRecoveryStorage.saveActiveTrades(Array.from(activeTradesRef.current.values()));

    // 3. For any trade that is STILL RUNNING (< candle :59s settlement target), maintain its position!
    const nowSecReconcile = Math.floor(Date.now() / 1000);
    const stillRunning = allCandidates.filter((t) => nowSecReconcile < getTradeTargetSettleSec(t));

    if (stillRunning.length > 0) {
      const msgs = stillRunning.map((t) => {
        const rem = Math.max(0, getTradeTargetSettleSec(t) - nowSecReconcile);
        return `#${t.contractId} on ${t.symbolName || t.symbol} (${rem}s remaining)`;
      });
      setBotStatusMessage(
        `[Trade In-Flight Resumed]: Position maintained: ${msgs.join(', ')}. Monitoring running position without opening duplicate trades.`
      );
    }

    // 4. For any trade that EXPIRED during glitch (>= candle :59s settlement target), settle it
    const expiredTrades = allCandidates.filter((t) => nowSecReconcile >= getTradeTargetSettleSec(t));

    for (const runningTrade of expiredTrades) {
      const cId = Number(runningTrade.contractId);
      if (isNaN(cId) || cId <= 0) continue;
      if (settledContractOutcomesRef.current.get(cId) === 'won') continue;

      if (isTradeRecordVirtual(runningTrade) || runningTrade.isVirtualTrade) {
        settleOpenTrade(runningTrade);
        continue;
      }

      setBotStatusMessage(`[Glitch Recovery]: In-flight trade #${cId} found. Fetching exit digit and settlement status from Deriv...`);

      const savedSession = autoRecoveryStorage.loadActiveSession();
      const tokenToUse = savedSession?.token || sessionAuthRef.current?.token || 'DEMO';
      const accountId = savedSession?.accountId || accountRef.current?.loginid;
      const appIdToUse = savedSession?.appId || appId;

      try {
        const detailsRes = await fetch('/api/contract/details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: tokenToUse,
            contractId: cId,
            accountId,
            appId: appIdToUse,
          }),
        });

        if (detailsRes.ok) {
          const details = await detailsRes.json();
          const nowSecDetail = Math.floor(Date.now() / 1000);
          const targetSettleSec = getTradeTargetSettleSec(runningTrade);
          const isExpired = details.is_expired === 1 || details.status === 'won' || details.status === 'lost' || nowSecDetail >= targetSettleSec;

          if (!isExpired && details.status === 'open') {
            activeTradesRef.current.set(runningTrade.symbol!, runningTrade);
            setActiveTrades(Array.from(activeTradesRef.current.values()));
            activeTradeRef.current = runningTrade;
            const remainingSec = Math.max(0, targetSettleSec - nowSecDetail);
            setActiveTradeCountdown(remainingSec);
            derivWs.subscribeProposalOpenContract(cId);
            setBotStatusMessage(
              `[Trade In-Flight Resumed]: Monitoring Trade #${cId} (${remainingSec}s remaining). Auto-settling at 59s.`
            );
            continue;
          }

          // Contract is finished: extract exit spot, exit digit, and calculate win/loss
          const entrySpot = Number(details.entry_spot ?? runningTrade.entrySpot ?? 100);
          const exitQuote = Number(details.exit_tick ?? details.current_spot ?? entrySpot);
          const exitDigit = parseInt(exitQuote.toFixed(2).slice(-1), 10);

          let won = false;
          if (details.status === 'won') {
            won = true;
          } else if (details.status === 'lost') {
            won = false;
          } else if (typeof details.profit === 'number' && details.profit > 0) {
            won = true;
          } else if (runningTrade.contractType === 'CALL') {
            won = exitQuote > entrySpot;
          } else if (runningTrade.contractType === 'PUT') {
            won = exitQuote < entrySpot;
          } else if (runningTrade.contractType === 'DIGITEVEN') {
            won = exitDigit % 2 === 0;
          } else if (runningTrade.contractType === 'DIGITODD') {
            won = exitDigit % 2 !== 0;
          } else {
            won = exitQuote > entrySpot;
          }

          const stake = Number(runningTrade.stake || 1);
          const payout = Number(details.payout || runningTrade.payout || (stake * 1.84));
          const profit = won ? Number((payout - stake).toFixed(2)) : -stake;

          const isVirtual = isTradeRecordVirtual(runningTrade);
          const settledRecord: TradeRecord = {
            ...runningTrade,
            id: runningTrade.id && runningTrade.id.startsWith('VIRTUAL-')
              ? runningTrade.id
              : (isVirtual ? `VIRTUAL-${cId}` : (runningTrade.id || String(cId))),
            contractId: cId,
            exitSpot: exitQuote,
            exitBarrier: exitQuote.toFixed(2),
            sellTime: Date.now(),
            payout: payout,
            profit: profit,
            status: won ? 'won' : 'lost',
            settleTimeRemaining: 0,
            settleTriggered: true,
            isVirtualTrade: isVirtual,
          };

          handleTradeCompletedRef.current(settledRecord);
          if (runningTrade.symbol) {
            activeTradesRef.current.delete(runningTrade.symbol);
          }
          setActiveTrades(Array.from(activeTradesRef.current.values()));
          autoRecoveryStorage.saveActiveTrades(Array.from(activeTradesRef.current.values()));
          if (activeTradeRef.current?.contractId === runningTrade.contractId) {
            autoRecoveryStorage.clearActiveTrade();
          }

          setBotStatusMessage(
            `[Glitch Recovery Settled]: Trade #${cId} settled as ${won ? 'WON' : 'LOST'} (Exit: ${exitQuote.toFixed(2)}, Exit Digit: ${exitDigit}, PnL: ${profit >= 0 ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`}). ${won ? 'Martingale reset to base stake.' : 'Martingale applied.'} Market analysis continuing...`
          );
        }
      } catch (err) {
        console.warn('Failed to reconcile in-flight trade:', err);
      }
    }
  }, [appId, getTradeTargetSettleSec, settleOpenTrade]);

  const reconcileRunningTradeAfterReloadRef = useRef(reconcileRunningTradeAfterReload);
  reconcileRunningTradeAfterReloadRef.current = reconcileRunningTradeAfterReload;

  // Full auto-recovery function when network is restored from a glitch:
  // Re-syncs candles, recalculates SMC indicators, reconciles balances and open contracts,
  // and resumes auto-trading from where it stopped without resetting the Martingale progression.
  const handleFullNetworkRecovery = useCallback(
    async (sourceMsg?: string) => {
      setIsNetworkGlitch(false);
      isNetworkGlitchRef.current = false;
      const notice = sourceMsg || 'Network restored! Re-syncing candles, SMC indicators, and account balance...';
      setNetworkRestoredNotification(notice);
      setTimeout(() => setNetworkRestoredNotification(null), 5000);

      const curSymbol = paramsRef.current.symbol;

      // 1. Re-subscribe to fresh historical 1m candles and ticks directly from Deriv WebSocket
      derivWs.subscribeTicks(curSymbol);
      derivWs.subscribeCandles(curSymbol, 60, 120);
      fetchCandlesForMarket(curSymbol);

      // 2. If multi-market enabled, refresh candles & SMC for all selected volatilities directly from Deriv
      if (multiMarketEnabledRef.current) {
        derivWs.subscribeMultiMarkets(selectedMarketsRef.current);
      }

      // 3. Synchronize account balance
      const session = sessionAuthRef.current;
      if (session && !session.token.startsWith('DEMO')) {
        try {
          const balRes = await fetch('/api/account/balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, appId }),
          });
          const balData = await balRes.json();
          if (balData.balance) {
            const newBal = Number(balData.balance.balance);
            setCurrentBalance(newBal);
          }
        } catch {}
      }

      // 4. Settle expired in-flight trades if needed, maintain and resubscribe running positions
      const nowSecRecovery = Math.floor(Date.now() / 1000);
      const currentTrades = Array.from(activeTradesRef.current.values());
      for (const openTrade of currentTrades) {
        if (openTrade && openTrade.status === 'open') {
          if (nowSecRecovery >= getTradeTargetSettleSec(openTrade)) {
            settleOpenTrade(openTrade);
          } else {
            if (openTrade.contractId) derivWs.subscribeProposalOpenContract(Number(openTrade.contractId));
          }
        }
      }
      if (currentTrades.length === 0 && activeTradeRef.current && activeTradeRef.current.status === 'open') {
        if (nowSecRecovery >= getTradeTargetSettleSec(activeTradeRef.current)) {
          settleOpenTrade(activeTradeRef.current);
        } else {
          if (activeTradeRef.current.contractId) derivWs.subscribeProposalOpenContract(Number(activeTradeRef.current.contractId));
        }
      }

      // 5. Seamlessly resume auto-trading without resetting Martingale!
      if (isAutoTradingRef.current) {
        const currentStake = calculateCurrentStake();
        const step = currentMartingaleStepRef.current;
        setBotStatusMessage(
          `[Network Restored]: Resumed live feeds & SMC calculations. Auto-trading active at Step ${step} ($${currentStake.toFixed(2)} stake).`
        );
      } else {
        setBotStatusMessage('[Network Restored]: Market feeds, candles, and SMC indicator readings resumed successfully.');
      }
    },
    [appId, calculateCurrentStake, settleOpenTrade, getTradeTargetSettleSec]
  );

  const handleFullNetworkRecoveryRef = useRef(handleFullNetworkRecovery);
  handleFullNetworkRecoveryRef.current = handleFullNetworkRecovery;

  const cancelGlitchCountdown = useCallback((reason?: string) => {
    setIsNetworkGlitch(false);
    isNetworkGlitchRef.current = false;
    if (reason) {
      setBotStatusMessage(`[Market Active]: ${reason}`);
    }
  }, []);
  const cancelGlitchCountdownRef = useRef(cancelGlitchCountdown);
  cancelGlitchCountdownRef.current = cancelGlitchCountdown;

  // Handle backend auto-refresh without browser reload or countdown session:
  // "Instead of auto refreshing the browser, you're just going to do the auto refresh in the back end.
  // Stop auto refreshing the browser, stop that auto refreshing session, stop it. Don't even show it."
  const lastBackendRefreshTimeRef = useRef<number>(0);

  const handleBackendAutoRefresh = useCallback((reason?: string) => {
    const now = Date.now();
    if (now - lastBackendRefreshTimeRef.current < 500) {
      return;
    }
    lastBackendRefreshTimeRef.current = now;

    const activeSession = autoRecoveryStorage.loadActiveSession() || (accountRef.current ? {
      token: accountRef.current.token,
      appId: accountRef.current.appId || appId,
      accountId: accountRef.current.loginid,
      isVirtual: accountRef.current.isVirtual,
      balance: currentBalanceRef.current,
      currency: currency,
    } : null);

    // 1. Silently save recovery snapshot to autoRecoveryStorage in case of offline session
    autoRecoveryStorage.saveFullSnapshot({
      params: paramsRef.current,
      strategyId: selectedStrategyRef.current.id,
      isAutoTrading: isAutoTradingRef.current,
      currentMartingaleStep: currentMartingaleStepRef.current,
      cycleLossCount: cycleLossCountRef.current,
      isPausedAwaitingSignal: isPausedAwaitingSignalRef.current,
      recoveryLockedMarket: recoveryLockedMarketRef.current,
      startingBalance: startingBalanceRef.current,
      accumulatedLoss: accumulatedLossRef.current,
      currentPhase: currentPhaseRef.current,
      isInVirtualCount: isInVirtualCountRef.current,
      virtualCountLosses: virtualCountLossesRef.current,
      trades: tradeRecordsRef.current,
      activeTrade: activeTradeRef.current,
      activeTrades: Array.from(activeTradesRef.current.values()),
      session: activeSession,
      multiMarketMaximized: autoRecoveryStorage.loadMultiMarketMaximized(),
      reason: reason || 'Background reconnect triggered.',
    });

    // 2. Perform backend auto-reconnect without browser reload or countdown session
    setBotStatusMessage('[Backend Auto-Refresh]: System disconnected. Reconnecting gateway & restoring live feeds immediately...');
    derivWs.reconnectBackend(reason);

    // If connection does not become authorized within 2.5s, trigger handleConnect to guarantee full session restore
    if (activeSession && activeSession.token) {
      if (reconnectSessionTimerRef.current) clearTimeout(reconnectSessionTimerRef.current);
      reconnectSessionTimerRef.current = setTimeout(() => {
        if (connectionStateRef.current !== 'authorized') {
          console.log('[Auto-Recovery]: Auto-reconnecting active session in backend...');
          handleConnectRef.current(
            activeSession.token,
            activeSession.appId || appId,
            activeSession.accountId,
            activeSession.isVirtual
          ).catch(() => {});
        }
      }, 2500);
    }

    // 3. Immediately re-fetch candles & restore all functionalities
    const currentSymbol = paramsRef.current.symbol;
    fetchCandlesForMarket(currentSymbol);
    if (multiMarketEnabledRef.current) {
      derivWs.subscribeMultiMarkets(selectedMarketsRef.current);
    }

    // 4. Settle expired in-flight trades if needed, maintain and resubscribe running positions
    const nowSecRefresh = Math.floor(Date.now() / 1000);
    const runningTrades = Array.from(activeTradesRef.current.values());
    for (const openTrade of runningTrades) {
      if (openTrade && openTrade.status === 'open') {
        if (nowSecRefresh >= getTradeTargetSettleSec(openTrade)) {
          settleOpenTrade(openTrade);
        } else {
          if (openTrade.contractId) derivWs.subscribeProposalOpenContract(Number(openTrade.contractId));
        }
      }
    }
    if (runningTrades.length === 0 && activeTradeRef.current && activeTradeRef.current.status === 'open') {
      if (nowSecRefresh >= getTradeTargetSettleSec(activeTradeRef.current)) {
        settleOpenTrade(activeTradeRef.current);
      } else {
        if (activeTradeRef.current.contractId) derivWs.subscribeProposalOpenContract(Number(activeTradeRef.current.contractId));
      }
    }

    // 5. If auto-trading was active, seamlessly ensure trading continues without freezing
    if (isAutoTradingRef.current) {
      setIsAutoTrading(true);
      const step = currentMartingaleStepRef.current;
      const currentStake = calculateCurrentStake();
      setBotStatusMessage(
        `[Backend Reconnected]: Live market feeds & SMC signals resumed. Auto-trading active at Step ${step} ($${currentStake.toFixed(2)}).`
      );
    } else {
      setBotStatusMessage('[Backend Reconnected]: Live market feeds & SMC indicator readings active.');
    }
  }, [appId, currency, calculateCurrentStake, settleOpenTrade, getTradeTargetSettleSec]);

  const handleBackendAutoRefreshRef = useRef(handleBackendAutoRefresh);
  handleBackendAutoRefreshRef.current = handleBackendAutoRefresh;

  const handleManualRefreshBrowser = useCallback(() => {
    // Reconnect connection in the backend without reloading the browser page
    handleBackendAutoRefresh('Manual connection reconnect requested.');
    fetchCandlesForMarket(paramsRef.current.symbol);
  }, [handleBackendAutoRefresh]);

  const handleManualRetryNetwork = useCallback(() => {
    setBotStatusMessage('Searching for network connection and reconnecting gateway in background...');
    derivWs.reconnectBackend('Manual connection reconnect triggered.');
    fetchCandlesForMarket(paramsRef.current.symbol);
  }, []);

  const mountTimeRef = useRef<number>(Date.now());
  const isBlinkRefreshingRef = useRef<boolean>(false);

  /**
   * Immediately auto-refreshes quick in the blink of an eye upon network glitch,
   * showing that the network is disconnected and preserving all trading settings.
   */
  const triggerInstantGlitchBlinkRefresh = useCallback((reason?: string) => {
    if (isBlinkRefreshingRef.current) return;
    isBlinkRefreshingRef.current = true;

    // 1. Immediately show that the network is disconnected and that is all
    setNetworkSignal({
      level: 'none',
      bars: 0,
      latencyMs: 0,
      speedMbps: 0,
      speedText: '0.0 Mbps',
      jitterMs: 0,
      isOnline: false,
      statusText: 'DISCONNECTED',
      lastChecked: Date.now(),
      isBeeping: false,
    });
    setConnectionState('disconnected');
    setBotStatusMessage('[Network Disconnected]: Auto-refreshing in the blink of an eye to reconnect...');

    // 2. Silently save every single setting, trading parameter, Martingale progression, trades, balance & session
    const currentMultiMarketMaximized = autoRecoveryStorage.loadMultiMarketMaximized();
    autoRecoveryStorage.saveFullSnapshot({
      params: paramsRef.current,
      strategyId: selectedStrategyRef.current.id,
      isAutoTrading: isAutoTradingRef.current,
      currentMartingaleStep: currentMartingaleStepRef.current,
      cycleLossCount: cycleLossCountRef.current,
      isPausedAwaitingSignal: isPausedAwaitingSignalRef.current,
      recoveryLockedMarket: recoveryLockedMarketRef.current,
      startingBalance: startingBalanceRef.current,
      accumulatedLoss: accumulatedLossRef.current,
      currentPhase: currentPhaseRef.current,
      isInVirtualCount: isInVirtualCountRef.current,
      virtualCountLosses: virtualCountLossesRef.current,
      trades: tradeRecordsRef.current,
      activeTrade: activeTradeRef.current,
      activeTrades: Array.from(activeTradesRef.current.values()),
      session: autoRecoveryStorage.loadActiveSession() || (accountRef.current ? {
        token: accountRef.current.token,
        appId: accountRef.current.appId || appId,
        accountId: accountRef.current.loginid,
        isVirtual: accountRef.current.isVirtual,
        balance: currentBalanceRef.current,
        currency: currency,
      } : null),
      multiMarketMaximized: currentMultiMarketMaximized,
      reason: reason || 'Network glitch detected: auto-refreshing quick in the blink of an eye.',
    });

    try {
      localStorage.setItem('deriv_multi_market_enabled', String(multiMarketEnabledRef.current));
      localStorage.setItem('deriv_multi_market_symbols', JSON.stringify(selectedMarketsRef.current));
      localStorage.setItem('deriv_multimarket_maximized', String(currentMultiMarketMaximized));
    } catch {}

    // 3. Auto-refresh quick in the blink of an eye (350ms)
    setTimeout(() => {
      window.location.reload();
    }, 350);
  }, [appId, currency]);

  const triggerInstantGlitchBlinkRefreshRef = useRef(triggerInstantGlitchBlinkRefresh);
  triggerInstantGlitchBlinkRefreshRef.current = triggerInstantGlitchBlinkRefresh;

  // Continuous real-time network speed calculation & Disconnect Listener
  useEffect(() => {
    const unsubSignal = networkEngine.subscribe((sig) => {
      setNetworkSignal(sig);
    });

    const unsubDisconnect = networkEngine.onDisconnect((reason) => {
      // User requested: "If the system is disconnected, it should apply a back-end refresh immediately."
      handleBackendAutoRefreshRef.current(reason || 'NetworkEngine disconnected: applying backend refresh immediately');
    });

    return () => {
      unsubSignal();
      unsubDisconnect();
    };
  }, []);

  // Network Watchdog:
  // User requested: "If the system is disconnected, it should apply a back-end refresh immediately."
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      const timeSinceMount = (Date.now() - mountTimeRef.current) / 1000;
      if (timeSinceMount < 4.0) return; // Allow initial mount and socket handshake to complete

      const silentSec = (Date.now() - lastCandleDataTimeRef.current) / 1000;
      const isInternetOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const isUnresponsive = connectionState === 'disconnected' || connectionState === 'error';
      const isSignalDisconnected = networkSignal.bars === 0 || !networkSignal.isOnline;

      // User requested: "If the system is disconnected, it should apply a back-end refresh immediately."
      if (isUnresponsive || isSignalDisconnected || isInternetOffline || (silentSec >= 20.0 && !derivWs.getIsSimulated())) {
        handleBackendAutoRefreshRef.current(
          isInternetOffline
            ? 'Internet offline: applying backend refresh immediately'
            : isUnresponsive
            ? 'Gateway disconnected: applying backend refresh immediately'
            : isSignalDisconnected
            ? 'Signal lost: applying backend refresh immediately'
            : `Feed silent for ${Math.floor(silentSec)}s: applying backend refresh immediately`
        );
        return;
      }

      // If feed is mildly lagging on a poor network (8-19s), softly re-request candles and ticks in background WITHOUT refreshing
      if (silentSec >= 8.0 && !isInternetOffline) {
        derivWs.subscribeTicks(paramsRef.current.symbol);
        fetchCandlesForMarket(paramsRef.current.symbol);
      }
    }, 1500);

    const handleOffline = () => {
      handleBackendAutoRefreshRef.current('Internet offline: applying backend refresh immediately');
    };
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(watchdogInterval);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connectionState, networkSignal]);

  // Set up WebSocket event listeners for live market price ticks and account updates
  useEffect(() => {
    derivWs.setHandlers({
      onSignalStrength: (sig) => {
        setNetworkSignal(sig);
      },
      onConnectionChange: (state, error) => {
        setConnectionState(state);
        if (state === 'authorized' || state === 'connected') {
          setIsNetworkGlitch(false);
          isNetworkGlitchRef.current = false;
          if (state === 'authorized') {
            setIsLoginModalOpen(false);
            setConnectionError(undefined);
          }
          // Fetch latest candles so chart is immediately fresh
          fetchCandlesForMarket(paramsRef.current.symbol);
          reconcileRunningTradeAfterReloadRef.current();

          // Resubscribe all running in-flight trades to proposal_open_contract
          for (const t of activeTradesRef.current.values()) {
            if (t && t.contractId && t.status === 'open') {
              derivWs.subscribeProposalOpenContract(Number(t.contractId));
            }
          }

          // If auto-trading was running, seamlessly resume trading in the background
          if (isAutoTradingRef.current) {
            const currentStake = calculateCurrentStake();
            const step = currentMartingaleStepRef.current;
            setBotStatusMessage(
              `[Backend Reconnected]: Live market feeds & SMC signals resumed. Auto-trading active at Step ${step} ($${currentStake.toFixed(2)}).`
            );
            if (selectedStrategyRef.current.id === 'continuous_trade') {
              checkAndExecuteContinuousTradeRef.current();
            } else if (selectedStrategyRef.current.id === 'smc_structure_confluence') {
              checkAndExecuteSmcBreakRef.current();
            }
          } else {
            setBotStatusMessage('[Backend Reconnected]: Live market feeds and SMC indicator readings active.');
          }
        } else if (state === 'connecting') {
          setBotStatusMessage('Connecting to Deriv WebSocket gateway in background...');
        } else if (state === 'disconnected') {
          setBotStatusMessage('[Disconnected]: Applying back-end refresh immediately...');
          // User request: "If the system is disconnected, it should apply a back-end refresh immediately."
          handleBackendAutoRefreshRef.current('WebSocket disconnected: applying back-end refresh immediately');
        } else if (state === 'error') {
          // Do not leak background market feed or tick socket reconnections into LoginModal connectionError
          setBotStatusMessage(`[Connection error: ${error || 'Unknown'}]: Applying back-end refresh immediately...`);
          // User request: "If the system is disconnected, it should apply a back-end refresh immediately."
          handleBackendAutoRefreshRef.current(`Connection error: ${error || 'unknown'}`);
        }
      },
      onNetworkGlitch: (isGlitch, message) => {
        if (isGlitch) {
          setIsNetworkGlitch(true);
          isNetworkGlitchRef.current = true;
          handleBackendAutoRefreshRef.current(message);
        } else {
          setIsNetworkGlitch(false);
          isNetworkGlitchRef.current = false;
        }
      },
      onAccount: (acc) => {
        const prevAcc = accountRef.current;
        // Never allow background fallback authorizations to overwrite the user's currently selected accountId / Demo selection
        if (prevAcc && prevAcc.loginid && acc.loginid && prevAcc.loginid !== acc.loginid) {
          setAccount((prev) => {
            if (!prev) return acc;
            const updated: DerivAccount = {
              ...prev,
              accountList: (prev.accountList && prev.accountList.length > 0) ? prev.accountList : acc.accountList,
            };
            accountRef.current = updated;
            return updated;
          });
          return;
        }
        setAccount((prev) => {
          const merged = { ...(prev || {}), ...acc } as DerivAccount;
          accountRef.current = merged;
          return merged;
        });
        if (acc.currency) setCurrency(acc.currency);
        if (typeof acc.balance === 'number') {
          setCurrentBalance(acc.balance);
          currentBalanceRef.current = acc.balance;
        }
      },
      onAccountStatus: (status) => {
        setAccount((prev) => (prev ? { ...prev, status } : null));
        const statusLabel = status?.status?.includes('authenticated')
          ? 'Verified'
          : status?.riskClassification
          ? `Risk: ${status.riskClassification}`
          : 'Active';
        setBotStatusMessage((prev) => `${prev} [Status: ${statusLabel}]`);
      },
      onBalance: (bal, curr) => {
        setCurrentBalance(bal);
        currentBalanceRef.current = bal;
        if (curr) setCurrency(curr);
        setAccount((prev) => {
          if (!prev) return null;
          const updatedAccountList = (prev.accountList || []).map((a: any) =>
            a.loginid === prev.loginid ? { ...a, balance: bal, currency: curr || a.currency } : a
          );
          const updated: DerivAccount = {
            ...prev,
            balance: bal,
            currency: curr || prev.currency,
            accountList: updatedAccountList,
          };
          accountRef.current = updated;
          return updated;
        });

        // When switching accounts or at start of session before any trades are settled,
        // synchronize startingBalance with the live account balance so starting and current match
        const completedTrades = tradeRecordsRef.current.filter(
          (t) => t.status === 'won' || t.status === 'lost'
        );
        if (completedTrades.length === 0) {
          setStartingBalance(bal);
          startingBalanceRef.current = bal;
          autoRecoveryStorage.saveStartingBalance(bal);
          if (accountRef.current?.loginid) {
            autoRecoveryStorage.saveAccountStartingBalance(accountRef.current.loginid, bal);
          }
        }
      },
      onTick: (tick) => {
        lastCandleDataTimeRef.current = Date.now();
        if (isNetworkGlitchRef.current) {
          cancelGlitchCountdownRef.current('Live candlestick prices updating.');
        }
        networkEngine.recordTickReceived();
        inBuiltSearcher.stopSearching();
        const tickSym = tick.symbol || paramsRef.current.symbol;
        marketTicksRef.current[tickSym] = tick;

        // If it matches currently selected main chart symbol, update main ticks & candles
        if (tickSym === paramsRef.current.symbol) {
          setTicks((prev) => {
            const updated = [...prev, tick];
            return updated.length > 50 ? updated.slice(-50) : updated;
          });

          setCandles((prev) => {
            const tickMinute = tick.epoch - (tick.epoch % 60);
            if (prev.length === 0) {
              // Wait for onCandles to deliver the full 120 standard Deriv historical bars
              return prev;
            }
            const lastCandle = prev[prev.length - 1];
            if (lastCandle.epoch === tickMinute) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...lastCandle,
                high: Math.max(lastCandle.high, tick.quote),
                low: Math.min(lastCandle.low, tick.quote),
                close: tick.quote,
              };
              candlesRef.current = updated;
              return updated;
            } else if (tickMinute > lastCandle.epoch) {
              const newCandle: CandleData = {
                epoch: tickMinute,
                open: tick.quote,
                high: tick.quote,
                low: tick.quote,
                close: tick.quote,
              };
              const updated = [...prev, newCandle];
              const trimmed = updated.length > 180 ? updated.slice(-180) : updated;
              candlesRef.current = trimmed;
              return trimmed;
            }
            return prev;
          });
        }

        // Also update background market candles for this symbol
        const prevSymCandles = marketCandlesRef.current[tickSym] || [];
        const tickMinute = tick.epoch - (tick.epoch % 60);
        if (prevSymCandles.length === 0) {
          initializeMarketCandlesIfEmpty(tickSym);
        } else {
          const lastC = prevSymCandles[prevSymCandles.length - 1];
          if (lastC.epoch === tickMinute) {
            const updated = [...prevSymCandles];
            updated[updated.length - 1] = {
              ...lastC,
              high: Math.max(lastC.high, tick.quote),
              low: Math.min(lastC.low, tick.quote),
              close: tick.quote,
            };
            marketCandlesRef.current[tickSym] = updated;
          } else if (tickMinute > lastC.epoch) {
            const newC: CandleData = {
              epoch: tickMinute,
              open: tick.quote,
              high: tick.quote,
              low: tick.quote,
              close: tick.quote,
            };
            const updated = [...prevSymCandles, newC];
            marketCandlesRef.current[tickSym] = updated.length > 180 ? updated.slice(-180) : updated;
          }
        }

        // Calculate SMC for this symbol if active using user's selected swing point
        const symCandles = tickSym === paramsRef.current.symbol ? candlesRef.current : marketCandlesRef.current[tickSym];
        if (symCandles && symCandles.length >= 10) {
          marketSmcRef.current[tickSym] = calculateSMC(symCandles, smcConfigRef.current);
        }

        if (isAutoTradingRef.current) {
          if (selectedStrategyRef.current.id === 'continuous_trade') {
            checkAndExecuteContinuousTradeRef.current();
          } else if (selectedStrategyRef.current.id === 'smc_structure_confluence') {
            checkAndExecuteSmcBreakRef.current();
          }
        }
      },
      onCandles: (newCandles, sym) => {
        lastCandleDataTimeRef.current = Date.now();
        if (isNetworkGlitchRef.current) {
          cancelGlitchCountdownRef.current('Live candlestick bars updating.');
        }
        const targetSym = sym || paramsRef.current.symbol;
        marketCandlesRef.current[targetSym] = newCandles;
        if (newCandles.length >= 10) {
          marketSmcRef.current[targetSym] = calculateSMC(newCandles, smcConfigRef.current);
        }

        if (targetSym === paramsRef.current.symbol) {
          candlesRef.current = newCandles;
          setCandles(newCandles);
          setIsLoadingCandles(false);
        }

        if (isAutoTradingRef.current) {
          if (selectedStrategyRef.current.id === 'continuous_trade') {
            checkAndExecuteContinuousTradeRef.current();
          } else if (selectedStrategyRef.current.id === 'smc_structure_confluence') {
            checkAndExecuteSmcBreakRef.current();
          }
        }
      },
      onOhlc: (ohlc) => {
        lastCandleDataTimeRef.current = Date.now();
        if (isNetworkGlitchRef.current) {
          cancelGlitchCountdownRef.current('Live candlestick OHLC updating.');
        }
        const sym = ohlc.symbol || paramsRef.current.symbol;
        const ohlcTime = ohlc.open_time || (ohlc.epoch - (ohlc.epoch % 60));

        // Update background market candles
        const prevSymCandles = marketCandlesRef.current[sym] || [];
        if (prevSymCandles.length > 0) {
          const last = prevSymCandles[prevSymCandles.length - 1];
          if (last.epoch === ohlcTime) {
            const updated = [...prevSymCandles];
            updated[updated.length - 1] = {
              epoch: ohlcTime,
              open: ohlc.open,
              high: Math.max(last.high, ohlc.high),
              low: Math.min(last.low, ohlc.low),
              close: ohlc.close,
            };
            marketCandlesRef.current[sym] = updated;
          } else if (ohlcTime > last.epoch) {
            const updated = [
              ...prevSymCandles,
              {
                epoch: ohlcTime,
                open: ohlc.open,
                high: ohlc.high,
                low: ohlc.low,
                close: ohlc.close,
              },
            ];
            marketCandlesRef.current[sym] = updated.length > 180 ? updated.slice(-180) : updated;
          }
          if (marketCandlesRef.current[sym].length >= 10) {
            marketSmcRef.current[sym] = calculateSMC(marketCandlesRef.current[sym], smcConfigRef.current);
          }
        }

        if (sym === paramsRef.current.symbol) {
          setCandles((prev) => {
            if (prev.length === 0) {
              return [
                {
                  epoch: ohlcTime,
                  open: ohlc.open,
                  high: ohlc.high,
                  low: ohlc.low,
                  close: ohlc.close,
                },
              ];
            }
            const last = prev[prev.length - 1];
            if (last.epoch === ohlcTime) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                epoch: ohlcTime,
                open: ohlc.open,
                high: Math.max(last.high, ohlc.high),
                low: Math.min(last.low, ohlc.low),
                close: ohlc.close,
              };
              return updated;
            } else if (ohlcTime > last.epoch) {
              const updated = [
                ...prev,
                {
                  epoch: ohlcTime,
                  open: ohlc.open,
                  high: ohlc.high,
                  low: ohlc.low,
                  close: ohlc.close,
                },
              ];
              return updated.length > 180 ? updated.slice(-180) : updated;
            }
            return prev;
          });
        }

        if (isAutoTradingRef.current) {
          if (selectedStrategyRef.current.id === 'continuous_trade') {
            checkAndExecuteContinuousTradeRef.current();
          } else if (selectedStrategyRef.current.id === 'smc_structure_confluence') {
            checkAndExecuteSmcBreakRef.current();
          }
        }
      },
      onProfitTable: () => {
        // Intentionally no-op: never populate past account history or unrelated trades
      },
      onTradeUpdate: (trade) => {
        const cId = Number(trade.contractId);
        if (!cId || isNaN(cId)) return;

        // ONLY process if this trade is a contract belonging to our active session / trade history
        const isOurTrade =
          Number(activeTradeRef.current?.contractId) === cId ||
          Array.from(activeTradesRef.current.values()).some((t) => Number(t.contractId) === cId) ||
          tradeRecordsRef.current.some((t) => Number(t.contractId) === cId);
        if (!isOurTrade) {
          return;
        }

        if (trade.status !== 'open') {
          handleTradeCompletedRef.current({ ...trade, contractId: cId });
        } else {
          // If contract is already handled/settled, ignore any 'open' packets
          if (handledContractIdsRef.current.has(cId) || settledContractOutcomesRef.current.has(cId)) {
            return;
          }
          setTradeRecords((prev) => {
            const index = prev.findIndex((t) => Number(t.contractId) === cId);
            if (index >= 0) {
              const original = prev[index];
              // Never revert an already settled contract back to 'open'
              if (original.status !== 'open' || handledContractIdsRef.current.has(cId) || settledContractOutcomesRef.current.has(cId)) {
                return prev;
              }
              const resolvedSymbol = original.symbol || trade.symbol;
              const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === resolvedSymbol);
              const resolvedSymbolName = original.symbolName || mDef?.name || trade.symbolName || resolvedSymbol;
              const recordIsVirtual = isTradeRecordVirtual(original) || isTradeRecordVirtual(trade);
              const finalId = original.id && original.id.startsWith('VIRTUAL-')
                ? original.id
                : (recordIsVirtual ? `VIRTUAL-${cId}` : (trade.id || String(cId)));
              const updated = [...prev];
              // Preserve local purchaseTime so client/Deriv server clock differences never trigger immediate settlement
              const preservedPurchaseTime =
                original.purchaseTime && original.purchaseTime > 0
                  ? original.purchaseTime
                  : Date.now();
              updated[index] = {
                ...original,
                ...trade,
                id: finalId,
                status: 'open',
                profit: 0,
                exitSpot: undefined,
                exitBarrier: undefined,
                isVirtualTrade: recordIsVirtual,
                contractId: cId,
                symbol: resolvedSymbol,
                symbolName: resolvedSymbolName,
                purchaseTime: preservedPurchaseTime,
                sellTime: undefined,
              };
              tradeRecordsRef.current = updated;
              return updated;
            }
            if (handledContractIdsRef.current.has(cId) || settledContractOutcomesRef.current.has(cId)) {
              return prev;
            }
            const isVirt = isTradeRecordVirtual(trade);
            const properId = trade.id && trade.id.startsWith('VIRTUAL-')
              ? trade.id
              : (isVirt ? `VIRTUAL-${cId}` : (trade.id || String(cId)));
            const mDef = VOLATILITY_MARKETS.find((m) => m.symbol === trade.symbol);
            const resolvedTrade: TradeRecord = {
              ...trade,
              id: properId,
              contractId: cId,
              status: 'open',
              profit: 0,
              exitSpot: undefined,
              exitBarrier: undefined,
              isVirtualTrade: isVirt,
              symbolName: trade.symbolName || mDef?.name || trade.symbol,
              purchaseTime: Date.now(),
              sellTime: undefined,
            };
            const next = [resolvedTrade, ...prev];
            tradeRecordsRef.current = next;
            return next;
          });
        }
      },
    });

    // Hydrate full up-to-5,000 trade history from IndexedDB on mount without resetting
    const savedSession = autoRecoveryStorage.loadActiveSession();
    (savedSession?.accountId
      ? autoRecoveryStorage.loadAccountTradeRecordsAsync(savedSession.accountId)
      : autoRecoveryStorage.loadTradeRecordsAsync()
    ).then((idbTrades) => {
      if (Array.isArray(idbTrades) && idbTrades.length > tradeRecordsRef.current.length) {
        setTradeRecords(idbTrades);
        tradeRecordsRef.current = idbTrades;
      }
    }).catch(() => {});

    // Check if user has an active persistent session from previous login
    let hasSavedSession = false;
    let restoreWatchdogTimer: NodeJS.Timeout | null = null;
    if (savedSession && savedSession.token) {
      const isPlausible = savedSession.token.startsWith('DEMO') || isPlausibleDerivToken(savedSession.token);
      if (!isPlausible) {
        autoRecoveryStorage.clearActiveSession();
      } else {
        hasSavedSession = true;
        setConnectionState('connecting');
        setIsRestoringSession(true);
        setBotStatusMessage(`Restoring session for ${savedSession.accountId || 'Deriv account'}...`);
        handleConnectRef.current(
          savedSession.token,
          savedSession.appId || appId,
          savedSession.accountId,
          savedSession.isVirtual
        ).catch((err) => {
          console.warn('Session restore failed:', err);
          setIsRestoringSession(false);
          setConnectionState('disconnected');
          setIsLoginModalOpen(true);
        }).finally(() => {
          if (restoreWatchdogTimer) {
            clearTimeout(restoreWatchdogTimer);
            restoreWatchdogTimer = null;
          }
        });

        // Watchdog: If session restoration hangs longer than 15 seconds, cleanly exit loading overlay without wiping Demo selection
        restoreWatchdogTimer = setTimeout(() => {
          setIsRestoringSession((currentRestoring) => {
            if (currentRestoring) {
              console.warn('Session restore timed out after 15s.');
              setConnectionState('disconnected');
              setIsLoginModalOpen(true);
              return false;
            }
            return false;
          });
        }, 15000);
      }
    }

    if (!hasSavedSession) {
      setIsRestoringSession(false);
      // Start public market data stream immediately on mount
      derivWs.connect('', appId);
      derivWs.subscribeTicks(paramsRef.current.symbol);
      derivWs.subscribeCandles(paramsRef.current.symbol, 60, 120);
      fetchCandlesForMarket(paramsRef.current.symbol);

      // Check if resuming or auto-restarting trading from network glitch reload
      const glitchState = autoRecoveryStorage.getGlitchReloadState();
      const shouldAutoRestart =
        (glitchState && glitchState.isPending && glitchState.shouldResumeAutoTrading) ||
        autoRecoveryStorage.loadAutoTradingState() ||
        isAutoTradingRef.current;

      if (glitchState && glitchState.isPending) {
        autoRecoveryStorage.clearGlitchReloadState();
      }

      if (shouldAutoRestart) {
        setIsAutoTrading(true);
        isAutoTradingRef.current = true;
        autoRecoveryStorage.saveAutoTradingState(true);
        setBotStatusMessage('[Auto-Restarted]: Trading active and candlestick charts updating.');
      }

      // Reconcile and settle any in-flight running trade if starting in public demo mode
      reconcileRunningTradeAfterReloadRef.current();
    }

    return () => {
      if (restoreWatchdogTimer) clearTimeout(restoreWatchdogTimer);
      derivWs.disconnect(false);
    };
  }, [appId]);

  // Ensure market candles are loaded directly from Deriv for background scanned markets
  const initializeMarketCandlesIfEmpty = useCallback((symbol: string) => {
    const existing = marketCandlesRef.current[symbol];
    if (!existing || existing.length < 10) {
      derivWs.requestHistoricalCandles(symbol, 60, 120);
    }
  }, []);

  // Fetch standard 1-minute historical candles directly from Deriv WebSocket and REST fallback
  const fetchCandlesForMarket = useCallback((sym: string) => {
    setIsLoadingCandles(true);
    derivWs.subscribeCandles(sym, 60, 120);

    // Fast HTTP fallback so candles appear instantaneously
    fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&granularity=60&count=120`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.candles) && data.candles.length > 0) {
          lastCandleDataTimeRef.current = Date.now();
          if (isNetworkGlitchRef.current) {
            cancelGlitchCountdownRef.current('Market candles loaded & live.');
          }
          candlesRef.current = data.candles;
          setCandles(data.candles);
          setIsLoadingCandles(false);
          // Calculate initial SMC structures immediately
          if (data.candles.length >= 10) {
            marketSmcRef.current[sym] = calculateSMC(data.candles, smcConfigRef.current);
          }
        }
      })
      .catch(() => {
        // WebSocket subscription will deliver candles
      });
  }, []);

  // When symbol changes, re-subscribe to ticks and 1m candles
  useEffect(() => {
    setTicks([]);
    derivWs.subscribeTicks(params.symbol);
    fetchCandlesForMarket(params.symbol);
  }, [params.symbol, fetchCandlesForMarket]);

  // Maintain multi-market subscriptions if multi-market mode is enabled
  useEffect(() => {
    if (multiMarketEnabled) {
      derivWs.subscribeMultiMarkets(selectedMarkets);
      selectedMarkets.forEach((sym) => {
        initializeMarketCandlesIfEmpty(sym);
      });
    }
  }, [multiMarketEnabled, selectedMarkets, initializeMarketCandlesIfEmpty]);

  // Multi-Market Handlers
  const handleToggleMultiMarket = useCallback((enabled: boolean) => {
    setMultiMarketEnabled(enabled);
    multiMarketEnabledRef.current = enabled;
    try {
      localStorage.setItem('deriv_multi_market_enabled', String(enabled));
    } catch {}

    if (enabled) {
      derivWs.subscribeMultiMarkets(selectedMarketsRef.current);
      for (const sym of selectedMarketsRef.current) {
        initializeMarketCandlesIfEmpty(sym);
      }
      setBotStatusMessage(`Multi-Market Scanner ENABLED for ${selectedMarketsRef.current.length} volatilities.`);
    } else {
      derivWs.subscribeMultiMarkets([]);
      derivWs.subscribeTicks(paramsRef.current.symbol);
      derivWs.subscribeCandles(paramsRef.current.symbol, 60, 120);
      setBotStatusMessage(`Multi-Market Scanner DISABLED. Reverted to single market: ${paramsRef.current.symbolName}.`);
    }
  }, [initializeMarketCandlesIfEmpty]);

  const handleToggleSelectMarket = useCallback((symbol: string) => {
    setSelectedMarkets((prev) => {
      const exists = prev.includes(symbol);
      let updated: string[];
      if (exists) {
        if (prev.length <= 1) return prev; // Keep at least one
        updated = prev.filter((s) => s !== symbol);
      } else {
        updated = [...prev, symbol];
      }
      selectedMarketsRef.current = updated;
      try {
        localStorage.setItem('deriv_multi_market_symbols', JSON.stringify(updated));
      } catch {}

      if (multiMarketEnabledRef.current) {
        derivWs.subscribeMultiMarkets(updated);
        if (!exists) {
          initializeMarketCandlesIfEmpty(symbol);
        }
      }
      return updated;
    });
  }, [initializeMarketCandlesIfEmpty]);

  const handleSelectAllMarkets = useCallback((symbols: string[]) => {
    setSelectedMarkets(symbols);
    selectedMarketsRef.current = symbols;
    try {
      localStorage.setItem('deriv_multi_market_symbols', JSON.stringify(symbols));
    } catch {}
    if (multiMarketEnabledRef.current) {
      derivWs.subscribeMultiMarkets(symbols);
      for (const sym of symbols) {
        initializeMarketCandlesIfEmpty(sym);
      }
    }
  }, [initializeMarketCandlesIfEmpty]);

  const handleClearAllMarkets = useCallback(() => {
    const fallback = [paramsRef.current.symbol || 'R_10'];
    setSelectedMarkets(fallback);
    selectedMarketsRef.current = fallback;
    try {
      localStorage.setItem('deriv_multi_market_symbols', JSON.stringify(fallback));
    } catch {}
    if (multiMarketEnabledRef.current) {
      derivWs.subscribeMultiMarkets(fallback);
    }
  }, []);

  // Market Selection Handler
  const handleSelectMarket = useCallback((market: MarketDefinition) => {
    setParams((prev) => ({
      ...prev,
      symbol: market.symbol,
      symbolName: market.name,
    }));
    setTicks([]);
    setCandles([]);
    const nowSec = Math.floor(Date.now() / 1000);
    const currCandle = nowSec - (nowSec % 60);
    autoTraderStartCandleEpochRef.current = currCandle;
    minNextSignalCandleEpochRef.current = currCandle;
    lastExecutedCandleEpochRef.current = currCandle;
    pendingStructureBreakRef.current = null;
    marketPendingBreaksRef.current = {};
    lastExecutedCandleMinuteRef.current = 0;
    derivWs.subscribeTicks(market.symbol);
    derivWs.subscribeCandles(market.symbol, 60, 120);
    fetchCandlesForMarket(market.symbol);
    setBotStatusMessage(`Switched market to ${market.name} (${market.symbol}). 1-minute candlestick data loading...`);
  }, [fetchCandlesForMarket]);

  // Toggle Auto-Trading
  const handleToggleAutoTrading = async () => {
    if (!isAutoTrading) {
      // Immediately start the system timer upon clicking Start
      const clickedStartMs = Date.now();
      setAutoTraderStartedAt(clickedStartMs);
      autoTraderStartedAtRef.current = clickedStartMs;
      setAutoTraderStoppedElapsedMs(null);
      autoRecoveryStorage.saveAutoTraderTimer(clickedStartMs, null);

      if (connectionState !== 'authorized' && !sessionAuthRef.current) {
        await handleConnect('DEMO', appId);
      }

      // Snapshot current cumulative P&L as the run baseline so Take Profit / Stop Loss
      // accurately enforce user-configured TP/SL even with persistent multi-session trade history
      const baselinePnl = computeRealCumulativePnl(tradeRecordsRef.current);
      autoTraderStartPnlOffsetRef.current = baselinePnl;
      autoRecoveryStorage.saveAutoTraderPnlBaseline(baselinePnl);

      setIsAutoTrading(true);
      isAutoTradingRef.current = true;
      autoRecoveryStorage.saveAutoTradingState(true);
      if (!activeTradeRef.current?.isVirtualTrade && !isInVirtualHookRef.current && !isInVirtualSwitchRef.current) {
        setIsInVirtualHook(false);
        isInVirtualHookRef.current = false;
        setVirtualHookLossCount(0);
        virtualHookLossCountRef.current = 0;
        setIsInVirtualSwitch(false);
        isInVirtualSwitchRef.current = false;
        setVirtualSwitchLossCount(0);
        virtualSwitchLossCountRef.current = 0;
        setRealConsecutiveLosses(0);
        realConsecutiveLossesRef.current = 0;
      }
      if (paramsRef.current.virtualCountEnabled) {
        const hasOpenTrade = Boolean(activeTradeRef.current && activeTradeRef.current.status === 'open');
        if (hasOpenTrade && activeTradeRef.current) {
          const openIsVirtual = isTradeRecordVirtual(activeTradeRef.current);
          setIsInVirtualCount(openIsVirtual);
          isInVirtualCountRef.current = openIsVirtual;
        } else {
          const hasActiveRealRecovery =
            currentMartingaleStepRef.current > 0 ||
            accumulatedLossRef.current > 0 ||
            currentModeRef.current > 0 ||
            modeAccumulatedLossRef.current > 0.01;
          if (!hasActiveRealRecovery) {
            setIsInVirtualCount(true);
            isInVirtualCountRef.current = true;
            setVirtualCountLosses(0);
            virtualCountLossesRef.current = 0;
            autoRecoveryStorage.saveMartingaleState({
              isInVirtualCount: true,
              virtualCountLosses: 0,
            });
          }
        }
      }
      pendingStructureBreakRef.current = null;
      marketPendingBreaksRef.current = {};
      lastExecutedCandleMinuteRef.current = 0;
      lastExecutedCandleEpochRef.current = 0;
      minNextSignalCandleEpochRef.current = 0;
      continuousCandleEpochTradedRef.current = {};
      isExecutingTradeRef.current = false;
      isTradePendingRef.current = false;

      const nowSec = Math.floor(Date.now() / 1000);
      autoTraderStartTimeRef.current = nowSec;
      const candlesList = candlesRef.current;
      const currentCandleEpoch =
        candlesList.length > 0 ? candlesList[candlesList.length - 1].epoch : nowSec - (nowSec % 60);
      autoTraderStartCandleEpochRef.current = currentCandleEpoch;

      // Mark all pre-existing structures as historical so they are never traded
      const existingStructures = latestSmcResultRef.current?.structures || [];
      tradedStructureIdsRef.current = new Set(existingStructures.map((s) => s.id));

      // Also mark background markets' existing structures as historical
      Object.keys(marketSmcRef.current).forEach((sym) => {
        const bgSmc = marketSmcRef.current[sym];
        (bgSmc?.structures || []).forEach((s) => tradedStructureIdsRef.current.add(s.id));
      });

      // Also mark current swing levels as already passed if price is already outside them across all scanned markets
      const marketsToCheck = multiMarketEnabledRef.current
        ? selectedMarketsRef.current
        : [paramsRef.current.symbol];

      marketsToCheck.forEach((sym) => {
        const bgSmc = sym === paramsRef.current.symbol ? latestSmcResultRef.current : marketSmcRef.current[sym];
        const q =
          sym === paramsRef.current.symbol && ticksRef.current.length > 0
            ? ticksRef.current[ticksRef.current.length - 1].quote
            : marketTicksRef.current[sym]?.quote;

        if (bgSmc && q !== undefined && q !== null) {
          if (bgSmc.activeSwingHigh && q >= bgSmc.activeSwingHigh.price) {
            tradedStructureIdsRef.current.add(
              `${sym}-swing-high-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`
            );
            tradedStructureIdsRef.current.add(
              `live-break-high-${sym}-${bgSmc.activeSwingHigh.time}-${bgSmc.activeSwingHigh.price.toFixed(4)}`
            );
          }
          if (bgSmc.activeSwingLow && q <= bgSmc.activeSwingLow.price) {
            tradedStructureIdsRef.current.add(
              `${sym}-swing-low-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`
            );
            tradedStructureIdsRef.current.add(
              `live-break-low-${sym}-${bgSmc.activeSwingLow.time}-${bgSmc.activeSwingLow.price.toFixed(4)}`
            );
          }
        }
      });

      setCycleLossCount(0);
      cycleLossCountRef.current = 0;
      setIsPausedAwaitingSignal(false);
      isPausedAwaitingSignalRef.current = false;

      const currentStake = calculateCurrentStake();
      const step = currentMartingaleStepRef.current;

      // If continuous trade strategy is selected
      if (selectedStrategy.id === 'continuous_trade') {
        const sym = params.symbol;
        const currentChochDir = getLatestChochDirection(sym);
        continuousDirectionRef.current[sym] = currentChochDir;
        const actionLabel = currentChochDir === 'CALL' ? 'BUY (Rise)' : 'SELL (Fall)';
        const chochLabel = currentChochDir === 'CALL' ? 'Bullish CHoCH' : 'Bearish CHoCH';
        const secondInCandle = nowSec % 60;
        const secTo58 = secondInCandle <= 58 ? 58 - secondInCandle : 60 - secondInCandle + 58;

        if (multiMarketEnabledRef.current) {
          derivWs.subscribeMultiMarkets(selectedMarketsRef.current);
          for (const s of selectedMarketsRef.current) {
            initializeMarketCandlesIfEmpty(s);
            continuousDirectionRef.current[s] = getLatestChochDirection(s);
          }
        }

        setBotStatusMessage(
          `[Continuous Trade Started | $${currentStake.toFixed(2)}${
            step > 0 ? ` (Martingale Step ${step})` : ''
          }]: Detected ${chochLabel} on ${params.symbolName} -> Continuous ${actionLabel} at 58s of every candle (settles at 59s). Next entry in ${secTo58}s...`
        );
        checkAndExecuteContinuousTradeRef.current();
      } else if (multiMarketEnabledRef.current) {
        derivWs.subscribeMultiMarkets(selectedMarketsRef.current);
        const count = selectedMarketsRef.current.length;

        for (const sym of selectedMarketsRef.current) {
          initializeMarketCandlesIfEmpty(sym);
        }

        setBotStatusMessage(
          `[Multi-Market Auto-Trader Started | $${currentStake.toFixed(2)}${
            step > 0 ? ` (Martingale Step ${step})` : ''
          }]: Scanning ${count} Volatilities for Break of Structure / CHoCH breakouts...`
        );
      } else if (selectedStrategy.id === 'smc_structure_confluence') {
        const chartSmc = latestSmcResultRef.current;
        const chartTicks = ticksRef.current;
        const chartQuote = chartTicks.length > 0 ? chartTicks[chartTicks.length - 1].quote : null;
        const highStr = chartSmc?.activeSwingHigh ? chartSmc.activeSwingHigh.price.toFixed(2) : 'Scanning';
        const lowStr = chartSmc?.activeSwingLow ? chartSmc.activeSwingLow.price.toFixed(2) : 'Scanning';
        const quoteStr = chartQuote !== null ? chartQuote.toFixed(2) : '...';

        setBotStatusMessage(
          `[Auto-Trader Started | $${currentStake.toFixed(2)}${
            step > 0 ? ` (Martingale Step ${step})` : ''
          }]: Active levels on ${params.symbolName}: Swing High ${highStr} | Swing Low ${lowStr} (Price: ${quoteStr}). Waiting for BOS/CHoCH breakout...`
        );
      } else {
        setBotStatusMessage(`Auto-Trader started with ${selectedStrategy.name}. Stake: $${currentStake.toFixed(2)}.`);
        evaluateAndTriggerAutoStrategy();
      }
    } else {
      const elapsed = autoTraderStartedAtRef.current
        ? Math.max(0, Date.now() - autoTraderStartedAtRef.current)
        : null;
      setAutoTraderStartedAt(null);
      autoTraderStartedAtRef.current = null;
      setAutoTraderStoppedElapsedMs(elapsed);
      autoRecoveryStorage.saveAutoTraderTimer(null, elapsed);

      setIsAutoTrading(false);
      isAutoTradingRef.current = false;
      autoRecoveryStorage.saveAutoTradingState(false);
      pendingStructureBreakRef.current = null;
      marketPendingBreaksRef.current = {};
      setRecoveryLockedMarket(null);
      recoveryLockedMarketRef.current = null;
      setBotStatusMessage('Auto-Trader paused by user.');
    }
  };

  // Reset Martingale & Auto Martingale (Global & all Individual Multi-Markets)
  const handleResetMartingale = () => {
    setCurrentMartingaleStep(0);
    currentMartingaleStepRef.current = 0;
    setAccumulatedLoss(0);
    accumulatedLossRef.current = 0;
    setCycleLossCount(0);
    cycleLossCountRef.current = 0;
    setCurrentPhase(1);
    currentPhaseRef.current = 1;
    setIsPausedAwaitingSignal(false);
    isPausedAwaitingSignalRef.current = false;
    setRecoveryLockedMarket(null);
    recoveryLockedMarketRef.current = null;
    pausedFromMarketRef.current = null;
    setCurrentMode(0);
    currentModeRef.current = 0;
    setDefaultModeLossCount(0);
    defaultModeLossCountRef.current = 0;
    setInModeLossCount(0);
    inModeLossCountRef.current = 0;
    setModeFirstStake(0);
    modeFirstStakeRef.current = 0;
    setModeAccumulatedLoss(0);
    modeAccumulatedLossRef.current = 0;
    setIsInVirtualHook(false);
    isInVirtualHookRef.current = false;
    setVirtualHookLossCount(0);
    virtualHookLossCountRef.current = 0;
    setIsInVirtualSwitch(false);
    isInVirtualSwitchRef.current = false;
    setVirtualSwitchLossCount(0);
    virtualSwitchLossCountRef.current = 0;
    setVirtualSwitchStageProfit(0);
    virtualSwitchStageProfitRef.current = 0;
    setRealConsecutiveLosses(0);
    realConsecutiveLossesRef.current = 0;
    const countEnabled = paramsRef.current.virtualCountEnabled ?? false;
    setIsInVirtualCount(countEnabled);
    isInVirtualCountRef.current = countEnabled;
    setVirtualCountLosses(0);
    virtualCountLossesRef.current = 0;

    // Reset all Individual Multi-Market independent Martingales as well
    setMarketMartingaleStates({});
    marketMartingaleStatesRef.current = {};
    marketMinNextSignalCandleEpochRef.current = {};
    marketLastExecutedCandleEpochRef.current = {};
    marketPendingBreaksRef.current = {};
    pendingStructureBreakRef.current = null;
    autoRecoveryStorage.clearMarketMartingaleStates();

    autoRecoveryStorage.saveMartingaleState({
      currentMartingaleStep: 0,
      cycleLossCount: 0,
      isPausedAwaitingSignal: false,
      recoveryLockedMarket: null,
      startingBalance: startingBalanceRef.current,
      accumulatedLoss: 0,
      currentPhase: 1,
      currentMode: 0,
      defaultModeLossCount: 0,
      inModeLossCount: 0,
      modeFirstStake: 0,
      modeAccumulatedLoss: 0,
      isInVirtualHook: false,
      virtualHookLossCount: 0,
      isInVirtualSwitch: false,
      virtualSwitchLossCount: 0,
      realConsecutiveLosses: 0,
      isInVirtualCount: countEnabled,
      virtualCountLosses: 0,
    });

    setBotStatusMessage(
      `All Martingales reset! All markets will trade from the base first stake ($${paramsRef.current.stake.toFixed(2)}) on next confirmed signal.`
    );
  };

  const handleUnlockMarkets = useCallback(() => {
    setRecoveryLockedMarket(null);
    recoveryLockedMarketRef.current = null;
    autoRecoveryStorage.saveMartingaleState({
      currentMartingaleStep: currentMartingaleStepRef.current,
      cycleLossCount: cycleLossCountRef.current,
      isPausedAwaitingSignal: isPausedAwaitingSignalRef.current,
      recoveryLockedMarket: null,
      startingBalance: startingBalanceRef.current,
      accumulatedLoss: accumulatedLossRef.current,
      currentPhase: currentPhaseRef.current,
    });
    setBotStatusMessage('All volatilities freed: scanning and analyzing all selected markets for next signal.');
  }, []);

  const calculatedStake = calculateCurrentStake();



  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans overflow-x-hidden selection:bg-[#ff444f]/30 selection:text-white">
      {/* Top Header Navigation */}
      <Header
        connectionState={connectionState}
        connectionError={connectionError}
        account={account}
        currentBalance={currentBalance}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onDisconnect={handleDisconnect}
        onRefreshData={handleSyncBalance}
        onSwitchAccount={handleSwitchAccount}
        signalState={networkSignal}
        countdownSeconds={undefined}
        isGlitch={networkSignal.bars === 0 || !networkSignal.isOnline || connectionState === 'disconnected'}
        onReconnect={() => {
          handleBackendAutoRefresh('User clicked reconnect in header');
        }}
        onSimulateGlitch={() => {
          handleBackendAutoRefresh('Manual Test: Network glitch triggered.');
        }}
      />

      {/* Main Trading Terminal Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* Network Glitch Auto-Searching & Recovery Banner */}
        <NetworkGlitchBanner
          isGlitch={isNetworkGlitch}
          glitchMessage={networkGlitchMessage}
          countdownSeconds={networkGlitchCountdown}
          onRefreshNow={handleManualRefreshBrowser}
          onRetryNow={handleManualRetryNetwork}
          restoredMessage={networkRestoredNotification}
          isAutoTrading={isAutoTrading}
          currentMartingaleStep={currentMartingaleStep}
          currentStake={calculatedStake}
          signalState={networkSignal}
        />

        {/* Virtual Switch Escalation Notification Banner */}
        {virtualSwitchEscalationNotice && (
          <div
            id="virtual-switch-escalation-banner"
            role="alert"
            className="rounded-xl border border-emerald-500/60 bg-gradient-to-r from-emerald-950/90 via-zinc-900 to-purple-950/90 p-3 sm:p-4 shadow-lg shadow-emerald-950/40 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-300"
          >
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Virtual Switch Escalation
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Take Profit Hit
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-zinc-100 font-medium mt-0.5 break-words">
                  {virtualSwitchEscalationNotice}
                </p>
              </div>
            </div>
            <button
              onClick={() => setVirtualSwitchEscalationNotice(null)}
              className="px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700/80 rounded-lg border border-zinc-700 transition-colors shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Account Balances (Starting Balance, Current Balance, P&L, Win Rate) */}
        <BalanceCards stats={balanceStats} currency={currency} isVirtual={account?.isVirtual} />

        {/* Deriv Verified Settlement & Corrected Loss Counter Alert Box */}
        <CorrectedLossAlertBox
          items={correctedLossItems}
          currency={currency}
          nextCalculatedStake={calculatedStake}
          currentMartingaleStep={currentMartingaleStep}
          onDismissItem={(id) => {
            setCorrectedLossItems((prev) => {
              const updated = prev.filter((item) => item.id !== id);
              autoRecoveryStorage.saveCorrectedLossItems(updated);
              correctedLossItemsRef.current = updated;
              return updated;
            });
          }}
          onClearAll={() => {
            setCorrectedLossItems([]);
            autoRecoveryStorage.clearCorrectedLossItems();
            correctedLossItemsRef.current = [];
          }}
        />

        {/* Real-time Active Trade Feedback Banner with Entry/Exit Barriers and 59s settlement */}
        {activeTrades.length > 0 && (
          <ActiveTradeBanner
            activeTrades={activeTrades}
            activeTrade={activeTrades[0]}
            currentQuote={
              activeTrades[0].symbol === params.symbol && ticks.length > 0
                ? ticks[ticks.length - 1].quote
                : (marketTicksRef.current[activeTrades[0].symbol]?.quote ?? activeTrades[0].entrySpot)
            }
            marketQuotes={Object.fromEntries(
              Object.entries(marketTicksRef.current).map(([k, v]) => [k, v.quote])
            )}
            secondsRemaining={activeTradeCountdown}
            isVirtualSystemEnabled={Boolean(params.virtualHookEnabled || params.virtualSwitchEnabled || params.virtualCountEnabled)}
          />
        )}

        {/* 2. Interactive Lightweight 1-Minute Candlestick Chart with Market Selection */}
        <LightweightCandleChart
          symbol={params.symbol}
          symbolName={params.symbolName}
          onSelectMarket={handleSelectMarket}
          candles={candles}
          latestTick={ticks.length > 0 ? ticks[ticks.length - 1] : null}
          entrySpot={tradeRecords.length > 0 && tradeRecords[0].status === 'open' ? tradeRecords[0].entrySpot : undefined}
          contractType={params.contractType}
          onRefreshCandles={() => fetchCandlesForMarket(params.symbol)}
          isLoadingCandles={isLoadingCandles}
          smcConfig={smcConfig}
          onSmcConfigChange={handleUpdateSmcConfig}
          onSmcUpdate={(res) => {
            latestSmcResultRef.current = res;
            if (isAutoTradingRef.current) {
              if (selectedStrategyRef.current.id === 'continuous_trade') {
                checkAndExecuteContinuousTradeRef.current(res);
              } else if (selectedStrategyRef.current.id === 'smc_structure_confluence') {
                checkAndExecuteSmcBreakRef.current(res);
              }
            }
          }}
        />

        {/* 3. Trading Section: Strategy list, Martingale parameters (stake, multiplier, take profit, stop loss, max multiplier) & Multi-Market Scanner */}
        <TradingSection
          params={params}
          onUpdateParams={(newParams) => {
            setParams((prev) => {
              const updated = { ...prev, ...newParams };
              autoRecoveryStorage.saveTradingParams(updated);
              return updated;
            });
            if (newParams.virtualHookEnabled === false) {
              setIsInVirtualHook(false);
              isInVirtualHookRef.current = false;
              setVirtualHookLossCount(0);
              virtualHookLossCountRef.current = 0;
              setRealConsecutiveLosses(0);
              realConsecutiveLossesRef.current = 0;
            }
            if (newParams.virtualSwitchEnabled === false) {
              setIsInVirtualSwitch(false);
              isInVirtualSwitchRef.current = false;
              setVirtualSwitchLossCount(0);
              virtualSwitchLossCountRef.current = 0;
              setRealConsecutiveLosses(0);
              realConsecutiveLossesRef.current = 0;
            }
            if (newParams.virtualCountEnabled === true) {
              setIsInVirtualCount(true);
              isInVirtualCountRef.current = true;
              setVirtualCountLosses(0);
              virtualCountLossesRef.current = 0;
            } else if (newParams.virtualCountEnabled === false) {
              setIsInVirtualCount(false);
              isInVirtualCountRef.current = false;
              setVirtualCountLosses(0);
              virtualCountLossesRef.current = 0;
            } else if (
              typeof newParams.virtualCountThreshold === 'number' &&
              paramsRef.current.virtualCountEnabled &&
              isInVirtualCountRef.current &&
              virtualCountLossesRef.current >= Math.max(1, newParams.virtualCountThreshold)
            ) {
              setIsInVirtualCount(false);
              isInVirtualCountRef.current = false;
            }

            autoRecoveryStorage.saveMartingaleState({
              currentMartingaleStep: currentMartingaleStepRef.current,
              accumulatedLoss: accumulatedLossRef.current,
              startingBalance: startingBalanceRef.current,
              currentPhase: currentPhaseRef.current,
              isInVirtualHook: newParams.virtualHookEnabled === false ? false : isInVirtualHookRef.current,
              virtualHookLossCount: newParams.virtualHookEnabled === false ? 0 : virtualHookLossCountRef.current,
              isInVirtualSwitch: newParams.virtualSwitchEnabled === false ? false : isInVirtualSwitchRef.current,
              virtualSwitchLossCount: newParams.virtualSwitchEnabled === false ? 0 : virtualSwitchLossCountRef.current,
              realConsecutiveLosses: (newParams.virtualHookEnabled === false || newParams.virtualSwitchEnabled === false) ? 0 : realConsecutiveLossesRef.current,
              isInVirtualCount: newParams.virtualCountEnabled === false ? false : isInVirtualCountRef.current,
              virtualCountLosses: newParams.virtualCountEnabled === false ? 0 : virtualCountLossesRef.current,
            });
          }}
          selectedStrategy={selectedStrategy}
          onSelectStrategy={(strat) => {
            setSelectedStrategy(strat);
            setParams((prev) => ({
              ...prev,
              contractType: strat.defaultContractType,
              duration: strat.recommendedDuration,
              multiplier: strat.recommendedMultiplier,
            }));
          }}
          isAutoTrading={isAutoTrading}
          onToggleAutoTrading={handleToggleAutoTrading}
          onManualTrade={async (type) => {
            if (connectionState !== 'authorized' && !sessionAuthRef.current) {
              await handleConnect('DEMO', appId);
            }
            executeTrade(type);
          }}
          currentMartingaleStep={currentMartingaleStep}
          currentCalculatedStake={calculatedStake}
          onResetMartingale={handleResetMartingale}
          isTradePending={isTradePending}
          currency={currency}
          botStatusMessage={botStatusMessage}
          isAuthorized={connectionState === 'authorized'}
          isPausedAwaitingSignal={isPausedAwaitingSignal}
          cycleLossCount={cycleLossCount}
          currentPhase={currentPhase}
          multiMarketEnabled={multiMarketEnabled}
          onToggleMultiMarket={handleToggleMultiMarket}
          selectedMarkets={selectedMarkets}
          onToggleMarket={handleToggleSelectMarket}
          onSelectAllMarkets={handleSelectAllMarkets}
          onClearAllMarkets={handleClearAllMarkets}
          marketScanStatus={marketScanStatus}
          activeTradeSymbol={tradeRecords.length > 0 && tradeRecords[0].status === 'open' ? tradeRecords[0].symbol : undefined}
          recoveryLockedMarket={recoveryLockedMarket}
          onUnlockMarkets={handleUnlockMarkets}
          accumulatedLoss={accumulatedLoss}
          currentMode={currentMode}
          defaultModeLossCount={defaultModeLossCount}
          inModeLossCount={inModeLossCount}
          modeFirstStake={modeFirstStake}
          modeAccumulatedLoss={modeAccumulatedLoss}
          isInVirtualHook={isInVirtualHook}
          virtualHookLossCount={virtualHookLossCount}
          realConsecutiveLosses={realConsecutiveLosses}
          isInVirtualSwitch={isInVirtualSwitch}
          currentVirtualSwitchStage={currentVirtualSwitchStage}
          virtualSwitchStageProfit={virtualSwitchStageProfit}
          isInVirtualCount={isInVirtualCount}
          virtualCountLosses={virtualCountLosses}
          individualMultiMarketEnabled={individualMultiMarketEnabled}
          onToggleIndividualMultiMarket={handleToggleIndividualMultiMarket}
          marketMartingaleStates={marketMartingaleStates}
          onResetAllMarketMartingales={handleResetAllMarketMartingales}
          activeTradeSymbols={activeTrades.map((t) => t.symbol)}
          onViewChart={(sym, name) => {
            const m = VOLATILITY_MARKETS.find((x) => x.symbol === sym) || {
              symbol: sym,
              name,
              shortName: sym,
              category: 'standard',
              minStake: 0.35,
              basePrice: 1000,
            };
            handleSelectMarket(m as MarketDefinition);
          }}
        />

        {/* 4. Trade History Table */}
        <TradeHistoryTable
          trades={tradeRecords}
          currency={currency}
          onRefresh={handleSyncBalance}
          onClearHistory={handleClearTradeHistory}
          isVirtualSystemEnabled={Boolean(params.virtualHookEnabled || params.virtualSwitchEnabled || params.virtualCountEnabled)}
          isAutoTrading={isAutoTrading}
          autoTraderStartedAt={autoTraderStartedAt}
          autoTraderStoppedElapsedMs={autoTraderStoppedElapsedMs}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Deriv WebSocket API Terminal &bull; App ID: {appId}</span>
          <span className="text-[11px] text-zinc-600">
            Automated Risk Management &bull; Martingale Multiplier Protection &bull; Live Deriv ws3 feed
          </span>
        </div>
      </footer>

      {/* PAT Token Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onConnect={handleConnect}
        connectionState={connectionState}
        connectionError={connectionError}
        defaultAppId={appId}
      />
    </div>
  );
}
