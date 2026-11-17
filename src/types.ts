export type ConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authorizing'
  | 'authorized'
  | 'error';

export type SignalLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'none';

export interface NetworkSignalState {
  level: SignalLevel;
  bars: 0 | 1 | 2 | 3 | 4;
  latencyMs: number;
  speedMbps: number;
  speedText: string;
  jitterMs: number;
  isOnline: boolean;
  statusText: string;
  lastChecked: number;
  isBeeping: boolean;
}

export interface DerivUserStatus {
  status?: string[];
  riskClassification?: string;
  promptClientToAuthenticate?: number;
  currencyConfig?: Record<string, any>;
  p2pStatus?: string;
  authentication?: {
    document?: { status?: string };
    identity?: { status?: string };
    needsVerification?: boolean;
  };
}

export interface DerivAccount {
  loginid: string;
  currency: string;
  balance: number;
  isVirtual: boolean;
  fullname: string;
  email: string;
  token: string;
  appId: string;
  scopes?: string[];
  status?: DerivUserStatus;
  accountList?: Array<{
    loginid: string;
    currency: string;
    is_virtual: number;
    balance?: number;
    account_type?: string;
  }>;
}

export interface BalanceStats {
  startingBalance: number;
  currentBalance: number;
  netProfitLoss: number;
  netProfitLossPercentage: number;
  grossProfit?: number;
  grossLoss?: number;
  totalTrades: number;
  wonTrades: number;
  lostTrades: number;
  winRate: number;
  virtualStats?: {
    totalTrades: number;
    wonTrades: number;
    lostTrades: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    netProfitLoss: number;
  };
}

export interface InInterModeConfig {
  inModeMartingale: number;
  interModeMartingale: number;
}

export const DEFAULT_IN_INTER_MODES: InInterModeConfig[] = [
  { inModeMartingale: 1.4, interModeMartingale: 1.5 }, // Mode 1
  { inModeMartingale: 1.6, interModeMartingale: 1.7 }, // Mode 2
  { inModeMartingale: 1.6, interModeMartingale: 1.7 }, // Mode 3
  { inModeMartingale: 1.7, interModeMartingale: 1.8 }, // Mode 4
  { inModeMartingale: 1.7, interModeMartingale: 1.8 }, // Mode 5
  { inModeMartingale: 1.8, interModeMartingale: 1.9 }, // Mode 6
  { inModeMartingale: 1.8, interModeMartingale: 1.9 }, // Mode 7
  { inModeMartingale: 1.9, interModeMartingale: 2.0 }, // Mode 8
  { inModeMartingale: 1.9, interModeMartingale: 2.0 }, // Mode 9
  { inModeMartingale: 2.0, interModeMartingale: 2.1 }, // Mode 10
];

export interface TradeParameters {
  stake: number;
  multiplier: number; // Martingale multiplier per loss
  takeProfit: number; // In currency units (e.g., $10)
  stopLoss: number; // In currency units (e.g., $10)
  maxMultiplier: number; // Maximum martingale multiplier cap / max consecutive martingale losses (e.g. 5)
  maxMartingaleAction?: 'stop' | 'reset'; // Action on reaching max martingale losses: 'stop' auto-trading or 'reset' to default stake
  symbol: string;
  symbolName: string;
  contractType: 'CALL' | 'PUT';
  duration: number; // Expiry duration (default 1)
  durationUnit: 'm' | 's' | 't'; // Default 'm' (1 minute expiry)
  settleAtSecond?: number; // Settle trade at 59 seconds
  pauseTradeEnabled?: boolean; // Enable/disable pause trade on consecutive losses
  pauseLossThreshold?: number; // Number of consecutive losses before pausing to await new signal (e.g. 3)
  autoMartingaleEnabled?: boolean; // Enable/disable Auto Martingale (exact 83% loss recovery)
  autoMartingalePayoutPercent?: number; // Deriv payout percentage for Auto Martingale (default 83%)
  inInterModeEnabled?: boolean; // Enable/disable In-Mode and Inter-Mode Martingale
  consecutivesToSwitchMode?: number; // Number of consecutive losses to switch to mode from default (e.g. 3)
  modesConfig?: InInterModeConfig[]; // 10 modes configuration (Mode 1 to Mode 10)
  virtualHookEnabled?: boolean; // Enable/disable Virtual Hook protection
  virtualHookLossThreshold?: number; // Number of consecutive real losses before switching to virtual hook (default: 1)
  virtualHookVirtualStake?: number; // Simulated stake for virtual hook trades (default: 0.35)
  virtualSwitchEnabled?: boolean; // Enable/disable Virtual Switch feature
  virtualSwitchBoxes?: number[]; // Boxes active for Virtual Switch (e.g. [1, 2, 3], up to 5)
  virtualSwitchTakeProfit?: number; // Defined take profit per stage before escalating to next box (default: 1.0)
  virtualCountEnabled?: boolean; // Enable/disable Virtual Count feature
  virtualCountThreshold?: number; // Number of consecutive virtual losses before switching to real account (default: 3)
  individualMultiMarketEnabled?: boolean; // Enable/disable Individual Multi-Market with independent Martingale per market
  maxConcurrentTrades?: number; // Maximum number of trades at a time in individual multi-market mode (default: 1)
}

export interface MarketMartingaleState {
  symbol: string;
  currentMartingaleStep: number;
  accumulatedLoss: number;
  cycleLossCount: number;
  isPausedAwaitingSignal: boolean;
  currentPhase?: number;
  lastTradeDirection?: 'CALL' | 'PUT';
  lastLossStake?: number;
  updatedAt?: number;
}

export interface TradingStrategy {
  id: string;
  name: string;
  category: 'Rise / Fall' | 'Martingale' | 'Trend' | 'Manual';
  description: string;
  badge: string;
  defaultContractType: 'CALL' | 'PUT';
  recommendedDuration: number;
  recommendedMultiplier: number;
}

export interface TradeRecord {
  id: string;
  contractId: number;
  transactionId?: number;
  symbol: string;
  symbolName: string;
  contractType: string;
  stake: number;
  payout: number;
  profit: number;
  currentSpot?: number; // Latest real-time spot price of this contract from Deriv
  currentProfit?: number; // Latest real-time unrealized profit/loss from Deriv
  status: 'won' | 'lost' | 'open';
  purchaseTime: number;
  sellTime?: number;
  entrySpot?: number;
  exitSpot?: number;
  entryBarrier?: number | string;
  exitBarrier?: number | string;
  longcode?: string;
  shortcode?: string;
  barrier?: string;
  settleTimeRemaining?: number;
  settleTriggered?: boolean;
  isVirtualTrade?: boolean; // True if executed under Virtual Hook simulation
  durationMinutes?: number; // Trade expiry in minutes selected by user (default 1)
}

export interface MarketTick {
  epoch: number;
  quote: number;
  symbol: string;
  ask?: number;
  bid?: number;
}

export interface MarketSymbol {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
}

export interface CandleData {
  epoch: number; // UTC unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OhlcData {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  open_time?: number;
  granularity?: number;
  symbol?: string;
}

export interface MultiMarketScanItem {
  symbol: string;
  name: string;
  shortName: string;
  category: 'standard' | '1s' | 'step' | 'jump';
  lastQuote?: number;
  trend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  activeSwingHigh?: number;
  activeSwingLow?: number;
  armedBreak?: {
    type: 'BOS' | 'CHoCH';
    direction: 'bullish' | 'bearish';
    level: number;
    candleEpoch: number;
  } | null;
  status: 'scanning' | 'armed' | 'trading' | 'idle';
  candleRemaining: number;
}

export interface CorrectedLossItem {
  id: string;
  contractId: number;
  symbol: string;
  symbolName: string;
  lossAmount: number;
  entryBarrier?: string | number;
  exitBarrier?: string | number;
  localSettledOutcome: 'won';
  derivConfirmedOutcome: 'lost';
  timestamp: number;
  status: 'pending_recovery' | 'recovered';
  recoveryStep: number;
  recoveryStake: number;
  recoveredAt?: number;
  recoveredContractId?: number;
}

