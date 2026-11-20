import { CorrectedLossItem, TradeParameters, TradeRecord, normalizeModesConfig, MarketMartingaleState } from '../types';

const STORAGE_KEY_SESSION = 'deriv_active_session';
const STORAGE_KEY_PARAMS = 'deriv_persisted_trading_params';
const STORAGE_KEY_STRATEGY = 'deriv_persisted_strategy_id';
const STORAGE_KEY_AUTOTRADING = 'deriv_persisted_auto_trading';
const STORAGE_KEY_MARTINGALE = 'deriv_persisted_martingale_state';
const STORAGE_KEY_TRADE_HISTORY = 'deriv_persisted_trade_history';
const STORAGE_KEY_ACTIVE_TRADE = 'deriv_persisted_active_trade';
const STORAGE_KEY_GLITCH_STATE = 'deriv_glitch_reload_state';
const STORAGE_KEY_STARTING_BALANCE = 'deriv_persisted_starting_balance';
const STORAGE_KEY_CORRECTED_LOSSES = 'deriv_corrected_loss_items';
const STORAGE_KEY_MULTIMARKET_MAXIMIZED = 'deriv_multimarket_maximized';
const STORAGE_KEY_ININTERMODE_MAXIMIZED = 'deriv_inintermode_maximized';
const STORAGE_KEY_INDIVIDUAL_MARTINGALE = 'deriv_individual_market_martingale';
const STORAGE_KEY_ACTIVE_TRADES = 'deriv_persisted_active_trades';
const STORAGE_KEY_VIRTUAL_COUNT_MINIMIZED = 'deriv_virtual_count_minimized';
const STORAGE_KEY_VIRTUAL_SWITCH_MINIMIZED = 'deriv_virtual_switch_minimized';
const STORAGE_KEY_AUTOTRADER_PNL_BASELINE = 'deriv_autotrader_pnl_baseline';
const STORAGE_KEY_ACCOUNT_HISTORY_PREFIX = 'deriv_account_trade_history_';
const STORAGE_KEY_ACCOUNT_START_BAL_PREFIX = 'deriv_account_starting_bal_';
const STORAGE_KEY_AUTOTRADER_STARTED_AT = 'deriv_autotrader_started_at';
const STORAGE_KEY_AUTOTRADER_STOPPED_ELAPSED = 'deriv_autotrader_stopped_elapsed_ms';

// IndexedDB Constants for high-capacity (up to 5,000+ trades) persistence
const IDB_DATABASE_NAME = 'deriv_bot_db';
const IDB_VERSION = 1;
const IDB_STORE_TRADES = 'trade_records';
const IDB_KEY_TRADES = 'history';

function openTradeDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE_TRADES)) {
          db.createObjectStore(IDB_STORE_TRADES);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getTradesFromIDB(key: string = IDB_KEY_TRADES): Promise<TradeRecord[] | null> {
  const db = await openTradeDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_TRADES, 'readonly');
      const store = tx.objectStore(IDB_STORE_TRADES);
      const req = store.get(key);
      req.onsuccess = () => {
        if (Array.isArray(req.result)) {
          resolve(req.result as TradeRecord[]);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveTradesToIDB(trades: TradeRecord[], key: string = IDB_KEY_TRADES): Promise<void> {
  const db = await openTradeDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_TRADES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_TRADES);
      // Store up to 5,000 trades as requested
      store.put(trades.slice(0, 5000), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearTradesFromIDB(key: string = IDB_KEY_TRADES): Promise<void> {
  const db = await openTradeDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_TRADES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_TRADES);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export interface PersistedMartingaleState {
  currentMartingaleStep: number;
  cycleLossCount: number;
  isPausedAwaitingSignal: boolean;
  recoveryLockedMarket: { symbol: string; symbolName: string } | null;
  startingBalance: number;
  accumulatedLoss?: number;
  currentPhase?: number;
  currentMode?: number;
  maxModeReached?: number;
  defaultModeLossCount?: number;
  inModeLossCount?: number;
  modeFirstStake?: number;
  modeAccumulatedLoss?: number;
  isInVirtualHook?: boolean;
  virtualHookLossCount?: number;
  isInVirtualSwitch?: boolean;
  currentVirtualSwitchStage?: number;
  virtualSwitchStageProfit?: number;
  virtualSwitchLossCount?: number;
  realConsecutiveLosses?: number;
  isInVirtualCount?: boolean;
  virtualCountLosses?: number;
}

export interface PersistedSession {
  token: string;
  appId?: string;
  accountId?: string;
  isVirtual?: boolean;
  balance?: number;
  currency?: string;
  fullname?: string;
  savedAt?: number;
}

export interface GlitchReloadState {
  isPending: boolean;
  shouldResumeAutoTrading: boolean;
  reason: string;
  timestamp: number;
}

export const autoRecoveryStorage = {
  // Save & Load active user session
  saveActiveSession(session: PersistedSession): void {
    try {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify({ ...session, savedAt: Date.now() }));
    } catch (e) {
      console.warn('Failed to save session to localStorage', e);
    }
  },

  loadActiveSession(): PersistedSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === 'string' && parsed.token.length > 0) {
        const cleanTok = parsed.token.trim().replace(/^["']|["']$/g, '').trim();
        // Check for Demo token or plausible Deriv token (alphanumeric, no whitespace, 8-128 chars)
        if (cleanTok.startsWith('DEMO') || (!/\s/.test(cleanTok) && cleanTok.length >= 8 && cleanTok.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(cleanTok))) {
          return { ...parsed, token: cleanTok };
        }
        // If stored session token is invalid text (e.g. prompt sentence), clean it out
        localStorage.removeItem(STORAGE_KEY_SESSION);
        return null;
      }
      return null;
    } catch {
      return null;
    }
  },

  clearActiveSession(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {}
  },

  // Save & Load trading parameters
  saveTradingParams(params: TradeParameters): void {
    try {
      localStorage.setItem(STORAGE_KEY_PARAMS, JSON.stringify(params));
    } catch (e) {
      console.warn('Failed to save trading params', e);
    }
  },

  loadTradingParams(): TradeParameters | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PARAMS);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.stake === 'number' && typeof parsed.multiplier === 'number') {
        return {
          ...parsed,
          takeProfit: typeof parsed.takeProfit === 'number' && !isNaN(parsed.takeProfit) ? parsed.takeProfit : 10.0,
          stopLoss: typeof parsed.stopLoss === 'number' && !isNaN(parsed.stopLoss) ? parsed.stopLoss : 10.0,
          autoMartingaleEnabled: parsed.autoMartingaleEnabled ?? true,
          autoMartingalePayoutPercent: parsed.autoMartingalePayoutPercent ?? 83,
          maxMartingaleAction: parsed.maxMartingaleAction ?? 'stop',
          maxMultiplier: parsed.maxMultiplier ?? 5,
          inInterModeEnabled: parsed.inInterModeEnabled ?? false,
          consecutivesToSwitchMode: parsed.consecutivesToSwitchMode ?? 3,
          modesConfig: normalizeModesConfig(parsed.modesConfig),
          virtualHookEnabled: parsed.virtualHookEnabled ?? false,
          virtualHookLossThreshold: parsed.virtualHookLossThreshold ?? 1,
          virtualHookVirtualStake: parsed.virtualHookVirtualStake ?? (parsed.stake ?? 0.35),
          virtualSwitchEnabled: parsed.virtualSwitchEnabled ?? false,
          virtualSwitchBoxes: Array.isArray(parsed.virtualSwitchBoxes) && parsed.virtualSwitchBoxes.length > 0
            ? parsed.virtualSwitchBoxes
            : [1, 2, 3],
          virtualSwitchTakeProfit: parsed.virtualSwitchTakeProfit ?? 0.5,
          virtualCountEnabled: parsed.virtualCountEnabled ?? false,
          virtualCountThreshold: parsed.virtualCountThreshold ?? 3,
          pauseTradeEnabled: parsed.pauseTradeEnabled ?? true,
          pauseLossThreshold: parsed.pauseLossThreshold ?? 2,
          individualMultiMarketEnabled: parsed.individualMultiMarketEnabled ?? false,
          maxConcurrentTrades: parsed.maxConcurrentTrades ? Math.max(1, Math.min(10, Number(parsed.maxConcurrentTrades))) : 1,
        } as TradeParameters;
      }
      return null;
    } catch {
      return null;
    }
  },

  // Save & Load selected strategy ID
  saveStrategyId(strategyId: string): void {
    try {
      localStorage.setItem(STORAGE_KEY_STRATEGY, strategyId);
    } catch {}
  },

  loadStrategyId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_STRATEGY);
    } catch {
      return null;
    }
  },

  // Save & Load auto trading state
  saveAutoTradingState(isAutoTrading: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY_AUTOTRADING, String(isAutoTrading));
    } catch {}
  },

  loadAutoTradingState(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY_AUTOTRADING) === 'true';
    } catch {
      return false;
    }
  },

  saveAutoTraderTimer(startedAt: number | null, stoppedElapsedMs: number | null): void {
    try {
      if (startedAt !== null && Number.isFinite(startedAt)) {
        localStorage.setItem(STORAGE_KEY_AUTOTRADER_STARTED_AT, String(startedAt));
      } else {
        localStorage.removeItem(STORAGE_KEY_AUTOTRADER_STARTED_AT);
      }
      if (stoppedElapsedMs !== null && Number.isFinite(stoppedElapsedMs)) {
        localStorage.setItem(STORAGE_KEY_AUTOTRADER_STOPPED_ELAPSED, String(stoppedElapsedMs));
      } else {
        localStorage.removeItem(STORAGE_KEY_AUTOTRADER_STOPPED_ELAPSED);
      }
    } catch {}
  },

  loadAutoTraderTimer(): { startedAt: number | null; stoppedElapsedMs: number | null } {
    try {
      const rawStart = localStorage.getItem(STORAGE_KEY_AUTOTRADER_STARTED_AT);
      const rawStopped = localStorage.getItem(STORAGE_KEY_AUTOTRADER_STOPPED_ELAPSED);
      const parsedStart = rawStart ? Number(rawStart) : NaN;
      const parsedStopped = rawStopped ? Number(rawStopped) : NaN;
      return {
        startedAt: Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : null,
        stoppedElapsedMs: Number.isFinite(parsedStopped) && parsedStopped >= 0 ? parsedStopped : null,
      };
    } catch {
      return { startedAt: null, stoppedElapsedMs: null };
    }
  },

  // Save & Load Martingale & Cycle progression
  saveMartingaleState(state: Partial<PersistedMartingaleState>): void {
    try {
      const existing = this.loadMartingaleState() || {};
      const merged = { ...existing, ...state };
      localStorage.setItem(STORAGE_KEY_MARTINGALE, JSON.stringify(merged));
    } catch (e) {
      console.warn('Failed to save martingale state', e);
    }
  },

  loadMartingaleState(): PersistedMartingaleState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MARTINGALE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.currentMartingaleStep === 'number') {
        return parsed as PersistedMartingaleState;
      }
      return null;
    } catch {
      return null;
    }
  },

  // Save & Load trade history dashboard records (supports up to 5,000 trades)
  // Save & Load trade history dashboard records (supports up to 5,000 trades)
  saveTradeRecords(trades: TradeRecord[]): void {
    const sanitized = trades.map((t) => {
      const isVirtual = Boolean(
        t.isVirtualTrade === true ||
        (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) ||
        String(t.contractId).startsWith('VIRTUAL-')
      );
      const properId = isVirtual
        ? (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-') ? t.id : `VIRTUAL-${t.contractId}`)
        : (t.id || String(t.contractId));
      return {
        ...t,
        id: properId,
        isVirtualTrade: isVirtual,
      };
    });

    // 1. Asynchronously persist full list to IndexedDB (no 5MB localStorage quota bottleneck)
    saveTradesToIDB(sanitized).catch(() => {});

    // 2. Synchronous cache in localStorage for instant bootstrapping
    try {
      const trimmed = sanitized.slice(0, 1000);
      localStorage.setItem(STORAGE_KEY_TRADE_HISTORY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Failed to save 1,000 trade records to localStorage, attempting compact fallback', e);
      try {
        const fallback = sanitized.slice(0, 200);
        localStorage.setItem(STORAGE_KEY_TRADE_HISTORY, JSON.stringify(fallback));
      } catch (err) {
        console.warn('Fallback trade storage error', err);
      }
    }
  },

  async saveTradeRecordsAsync(trades: TradeRecord[]): Promise<void> {
    this.saveTradeRecords(trades);
    await saveTradesToIDB(trades);
  },

  loadTradeRecords(): TradeRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TRADE_HISTORY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const now = Date.now();
        return (parsed as TradeRecord[]).map((t) => {
          const isVirtual = Boolean(
            t.isVirtualTrade === true ||
            (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) ||
            String(t.contractId).startsWith('VIRTUAL-')
          );
          const properId = isVirtual
            ? (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-') ? t.id : `VIRTUAL-${t.contractId}`)
            : (t.id || String(t.contractId));
          const isStuckOpen = t.status === 'open' && (now - (t.purchaseTime || 0)) > 60000;
          const status = isStuckOpen ? (t.profit && t.profit > 0 ? 'won' : 'lost') : t.status;
          const profit = isStuckOpen ? (t.profit !== undefined ? t.profit : -Number(t.stake || 0.35)) : t.profit;
          const exitBarrier = isStuckOpen && (!t.exitBarrier || t.exitBarrier === 'Running...')
            ? (t.exitSpot !== undefined ? String(t.exitSpot) : (t.entryBarrier ? String(t.entryBarrier) : '---'))
            : t.exitBarrier;
          return {
            ...t,
            id: properId,
            status,
            profit,
            exitBarrier,
            isVirtualTrade: isVirtual,
          };
        });
      }
      return [];
    } catch {
      return [];
    }
  },

  async loadTradeRecordsAsync(): Promise<TradeRecord[]> {
    try {
      const idbTrades = await getTradesFromIDB();
      if (Array.isArray(idbTrades) && idbTrades.length > 0) {
        const now = Date.now();
        return idbTrades.map((t) => {
          const isVirtual = Boolean(
            t.isVirtualTrade === true ||
            (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) ||
            String(t.contractId).startsWith('VIRTUAL-')
          );
          const properId = isVirtual
            ? (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-') ? t.id : `VIRTUAL-${t.contractId}`)
            : (t.id || String(t.contractId));
          const isStuckOpen = t.status === 'open' && (now - (t.purchaseTime || 0)) > 60000;
          const status = isStuckOpen ? (t.profit && t.profit > 0 ? 'won' : 'lost') : t.status;
          const profit = isStuckOpen ? (t.profit !== undefined ? t.profit : -Number(t.stake || 0.35)) : t.profit;
          const exitBarrier = isStuckOpen && (!t.exitBarrier || t.exitBarrier === 'Running...')
            ? (t.exitSpot !== undefined ? String(t.exitSpot) : (t.entryBarrier ? String(t.entryBarrier) : '---'))
            : t.exitBarrier;
          return {
            ...t,
            id: properId,
            status,
            profit,
            exitBarrier,
            isVirtualTrade: isVirtual,
          };
        });
      }
      // If IndexedDB is empty, check localStorage
      const localTrades = this.loadTradeRecords();
      if (localTrades.length > 0) {
        // Backfill IndexedDB with localStorage trades for future hydration
        saveTradesToIDB(localTrades).catch(() => {});
      }
      return localTrades;
    } catch (e) {
      console.warn('Failed to load trade records from IndexedDB, falling back to localStorage', e);
      return this.loadTradeRecords();
    }
  },

  clearTradeRecords(): void {
    clearTradesFromIDB().catch(() => {});
    try {
      localStorage.removeItem(STORAGE_KEY_TRADE_HISTORY);
    } catch (e) {
      console.warn('Failed to clear trade records', e);
    }
  },

  async clearTradeRecordsAsync(): Promise<void> {
    this.clearTradeRecords();
    await clearTradesFromIDB();
  },

  // Per-account isolated trade history (so switching Real <-> Demo preserves each account's history)
  saveAccountTradeRecords(accountId: string, trades: TradeRecord[]): void {
    if (!accountId) return;
    const sanitized = trades.map((t) => {
      const isVirtual = Boolean(
        t.isVirtualTrade === true ||
        (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) ||
        String(t.contractId).startsWith('VIRTUAL-')
      );
      const properId = isVirtual
        ? (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-') ? t.id : `VIRTUAL-${t.contractId}`)
        : (t.id || String(t.contractId));
      return {
        ...t,
        id: properId,
        isVirtualTrade: isVirtual,
      };
    });
    saveTradesToIDB(sanitized, `${IDB_KEY_TRADES}_${accountId}`).catch(() => {});
    try {
      localStorage.setItem(`${STORAGE_KEY_ACCOUNT_HISTORY_PREFIX}${accountId}`, JSON.stringify(sanitized.slice(0, 1000)));
    } catch {
      try {
        localStorage.setItem(`${STORAGE_KEY_ACCOUNT_HISTORY_PREFIX}${accountId}`, JSON.stringify(sanitized.slice(0, 200)));
      } catch {}
    }
  },

  loadAccountTradeRecords(accountId: string): TradeRecord[] {
    if (!accountId) return [];
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_ACCOUNT_HISTORY_PREFIX}${accountId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const now = Date.now();
        return (parsed as TradeRecord[]).map((t) => {
          const isVirtual = Boolean(
            t.isVirtualTrade === true ||
            (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) ||
            String(t.contractId).startsWith('VIRTUAL-')
          );
          const properId = isVirtual
            ? (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-') ? t.id : `VIRTUAL-${t.contractId}`)
            : (t.id || String(t.contractId));
          const isStuckOpen = t.status === 'open' && (now - (t.purchaseTime || 0)) > 60000;
          const status = isStuckOpen ? (t.profit && t.profit > 0 ? 'won' : 'lost') : t.status;
          const profit = isStuckOpen ? (t.profit !== undefined ? t.profit : -Number(t.stake || 0.35)) : t.profit;
          const exitBarrier = isStuckOpen && (!t.exitBarrier || t.exitBarrier === 'Running...')
            ? (t.exitSpot !== undefined ? String(t.exitSpot) : (t.entryBarrier ? String(t.entryBarrier) : '---'))
            : t.exitBarrier;
          return {
            ...t,
            id: properId,
            status,
            profit,
            exitBarrier,
            isVirtualTrade: isVirtual,
          };
        });
      }
      return [];
    } catch {
      return [];
    }
  },

  async loadAccountTradeRecordsAsync(accountId: string): Promise<TradeRecord[]> {
    if (!accountId) return [];
    try {
      const idbTrades = await getTradesFromIDB(`${IDB_KEY_TRADES}_${accountId}`);
      if (Array.isArray(idbTrades) && idbTrades.length > 0) {
        const now = Date.now();
        return idbTrades.map((t) => {
          const isVirtual = Boolean(
            t.isVirtualTrade === true ||
            (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) ||
            String(t.contractId).startsWith('VIRTUAL-')
          );
          const properId = isVirtual
            ? (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-') ? t.id : `VIRTUAL-${t.contractId}`)
            : (t.id || String(t.contractId));
          const isStuckOpen = t.status === 'open' && (now - (t.purchaseTime || 0)) > 60000;
          const status = isStuckOpen ? (t.profit && t.profit > 0 ? 'won' : 'lost') : t.status;
          const profit = isStuckOpen ? (t.profit !== undefined ? t.profit : -Number(t.stake || 0.35)) : t.profit;
          const exitBarrier = isStuckOpen && (!t.exitBarrier || t.exitBarrier === 'Running...')
            ? (t.exitSpot !== undefined ? String(t.exitSpot) : (t.entryBarrier ? String(t.entryBarrier) : '---'))
            : t.exitBarrier;
          return {
            ...t,
            id: properId,
            status,
            profit,
            exitBarrier,
            isVirtualTrade: isVirtual,
          };
        });
      }
    } catch {}
    return this.loadAccountTradeRecords(accountId);
  },

  clearAccountTradeRecords(accountId: string): void {
    if (!accountId) return;
    clearTradesFromIDB(`${IDB_KEY_TRADES}_${accountId}`).catch(() => {});
    try {
      localStorage.removeItem(`${STORAGE_KEY_ACCOUNT_HISTORY_PREFIX}${accountId}`);
    } catch {}
  },

  // Save & Load active in-flight trade
  saveActiveTrade(trade: TradeRecord | null): void {
    try {
      if (trade && trade.status === 'open') {
        localStorage.setItem(STORAGE_KEY_ACTIVE_TRADE, JSON.stringify(trade));
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_TRADE);
      }
    } catch (e) {
      console.warn('Failed to save active trade', e);
    }
  },

  loadActiveTrade(): TradeRecord | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_TRADE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.contractId === 'number' && parsed.status === 'open') {
        return parsed as TradeRecord;
      }
      return null;
    } catch {
      return null;
    }
  },

  clearActiveTrade(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_TRADE);
    } catch {}
  },

  // Save & Load multiple concurrent active trades (Individual Multi-Market)
  saveActiveTrades(trades: TradeRecord[]): void {
    try {
      const openOnly = (trades || []).filter((t) => t && t.status === 'open');
      if (openOnly.length > 0) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(openOnly));
        // Keep single active trade storage in sync as well
        this.saveActiveTrade(openOnly[0]);
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_TRADES);
        this.clearActiveTrade();
      }
    } catch (e) {
      console.warn('Failed to save active trades', e);
    }
  },

  loadActiveTrades(): TradeRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_TRADES);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((t) => t && typeof t.contractId === 'number' && t.status === 'open') as TradeRecord[];
      }
      return [];
    } catch {
      return [];
    }
  },

  clearActiveTrades(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_TRADES);
      this.clearActiveTrade();
    } catch {}
  },

  // Network Glitch Reload State Flag
  setGlitchReloadState(state: GlitchReloadState): void {
    try {
      localStorage.setItem(STORAGE_KEY_GLITCH_STATE, JSON.stringify(state));
    } catch {}
  },

  getGlitchReloadState(): GlitchReloadState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_GLITCH_STATE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.isPending) {
        return parsed as GlitchReloadState;
      }
      return null;
    } catch {
      return null;
    }
  },

  clearGlitchReloadState(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_GLITCH_STATE);
    } catch {}
  },

  // Take a full snapshot of everything before browser auto-refresh
  saveFullSnapshot(snapshot: {
    params: TradeParameters;
    strategyId: string;
    isAutoTrading: boolean;
    currentMartingaleStep: number;
    cycleLossCount: number;
    isPausedAwaitingSignal: boolean;
    recoveryLockedMarket: { symbol: string; symbolName: string } | null;
    startingBalance: number;
    accumulatedLoss?: number;
    currentPhase?: number;
    isInVirtualCount?: boolean;
    virtualCountLosses?: number;
    trades: TradeRecord[];
    activeTrade?: TradeRecord | null;
    activeTrades?: TradeRecord[];
    session?: PersistedSession | null;
    multiMarketMaximized?: boolean;
    reason?: string;
  }): void {
    this.saveTradingParams(snapshot.params);
    this.saveStrategyId(snapshot.strategyId);
    this.saveAutoTradingState(snapshot.isAutoTrading);
    if (typeof snapshot.multiMarketMaximized === 'boolean') {
      this.saveMultiMarketMaximized(snapshot.multiMarketMaximized);
    }
    this.saveMartingaleState({
      currentMartingaleStep: snapshot.currentMartingaleStep,
      cycleLossCount: snapshot.cycleLossCount,
      isPausedAwaitingSignal: snapshot.isPausedAwaitingSignal,
      recoveryLockedMarket: snapshot.recoveryLockedMarket,
      startingBalance: snapshot.startingBalance,
      accumulatedLoss: snapshot.accumulatedLoss,
      currentPhase: snapshot.currentPhase,
      ...(typeof snapshot.isInVirtualCount === 'boolean' ? { isInVirtualCount: snapshot.isInVirtualCount } : {}),
      ...(typeof snapshot.virtualCountLosses === 'number' ? { virtualCountLosses: snapshot.virtualCountLosses } : {}),
    });
    this.saveTradeRecords(snapshot.trades);
    this.saveActiveTrade(snapshot.activeTrade ?? null);
    const activeList = snapshot.activeTrades || (snapshot.activeTrade ? [snapshot.activeTrade] : []);
    this.saveActiveTrades(activeList);

    if (snapshot.session) {
      this.saveActiveSession(snapshot.session);
    }

    if (snapshot.startingBalance > 0) {
      this.saveStartingBalance(snapshot.startingBalance);
    }

    this.setGlitchReloadState({
      isPending: true,
      shouldResumeAutoTrading: snapshot.isAutoTrading,
      reason: snapshot.reason || 'Background gateway reconnect snapshot saved.',
      timestamp: Date.now(),
    });
  },

  // Save & Load Multi-Market section minimized/maximized state
  saveMultiMarketMaximized(isMax: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY_MULTIMARKET_MAXIMIZED, String(isMax));
    } catch (e) {
      console.warn('Failed to save multi-market maximized state', e);
    }
  },

  loadMultiMarketMaximized(): boolean {
    try {
      const val = localStorage.getItem(STORAGE_KEY_MULTIMARKET_MAXIMIZED);
      if (val !== null) {
        return val === 'true';
      }
    } catch {}
    return true; // Default to true if user has never changed it
  },

  // Save & Load In-Inter Mode section minimized/maximized state
  saveInInterModeMaximized(isMax: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY_ININTERMODE_MAXIMIZED, String(isMax));
    } catch (e) {
      console.warn('Failed to save in-inter-mode maximized state', e);
    }
  },

  loadInInterModeMaximized(): boolean {
    try {
      const val = localStorage.getItem(STORAGE_KEY_ININTERMODE_MAXIMIZED);
      if (val !== null) {
        return val === 'true';
      }
    } catch {}
    return false; // Default to false if user has never changed it
  },

  // Save & Load Virtual Count section minimized state
  saveVirtualCountMinimized(isMin: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY_VIRTUAL_COUNT_MINIMIZED, String(isMin));
    } catch (e) {
      console.warn('Failed to save virtual count minimized state', e);
    }
  },

  loadVirtualCountMinimized(): boolean {
    try {
      const val = localStorage.getItem(STORAGE_KEY_VIRTUAL_COUNT_MINIMIZED);
      if (val !== null) {
        return val === 'true';
      }
    } catch {}
    return false; // Default: expanded
  },

  // Save & Load Virtual Switch section minimized state
  saveVirtualSwitchMinimized(isMin: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY_VIRTUAL_SWITCH_MINIMIZED, String(isMin));
    } catch (e) {
      console.warn('Failed to save virtual switch minimized state', e);
    }
  },

  loadVirtualSwitchMinimized(): boolean {
    try {
      const val = localStorage.getItem(STORAGE_KEY_VIRTUAL_SWITCH_MINIMIZED);
      if (val !== null) {
        return val === 'true';
      }
    } catch {}
    return false; // Default: expanded
  },

  // Save & Load persistent starting balance for PnL tracking
  saveStartingBalance(bal: number): void {
    try {
      if (bal > 0) {
        localStorage.setItem(STORAGE_KEY_STARTING_BALANCE, String(bal));
      }
    } catch (e) {
      console.warn('Failed to save starting balance', e);
    }
  },

  loadStartingBalance(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STARTING_BALANCE);
      if (!raw) return 0;
      const num = Number(raw);
      return !isNaN(num) && num > 0 ? num : 0;
    } catch {
      return 0;
    }
  },

  clearStartingBalance(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_STARTING_BALANCE);
    } catch {}
  },

  // Save & Load Deriv Corrected Loss items for visual alert and recovery tracking
  saveCorrectedLossItems(items: CorrectedLossItem[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_CORRECTED_LOSSES, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to save corrected loss items', e);
    }
  },

  loadCorrectedLossItems(): CorrectedLossItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CORRECTED_LOSSES);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  clearCorrectedLossItems(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_CORRECTED_LOSSES);
    } catch {}
  },

  // Save & Load Individual Multi-Market independent Martingale states
  saveMarketMartingaleStates(states: Record<string, MarketMartingaleState>): void {
    try {
      localStorage.setItem(STORAGE_KEY_INDIVIDUAL_MARTINGALE, JSON.stringify(states));
    } catch (e) {
      console.warn('Failed to save individual market martingale states', e);
    }
  },

  loadMarketMartingaleStates(): Record<string, MarketMartingaleState> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_INDIVIDUAL_MARTINGALE);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, MarketMartingaleState>;
      }
      return {};
    } catch {
      return {};
    }
  },

  clearMarketMartingaleStates(): void {
    try {
      localStorage.removeItem(STORAGE_KEY_INDIVIDUAL_MARTINGALE);
    } catch {}
  },

  // Per-account starting balance persistence
  saveAccountStartingBalance(accountId: string, bal: number): void {
    if (!accountId || !(bal > 0)) return;
    try {
      localStorage.setItem(`${STORAGE_KEY_ACCOUNT_START_BAL_PREFIX}${accountId}`, String(bal));
    } catch {}
  },

  loadAccountStartingBalance(accountId: string): number {
    if (!accountId) return 0;
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_ACCOUNT_START_BAL_PREFIX}${accountId}`);
      if (!raw) return 0;
      const num = Number(raw);
      return !isNaN(num) && num > 0 ? num : 0;
    } catch {
      return 0;
    }
  },

  clearAccountStartingBalance(accountId: string): void {
    if (!accountId) return;
    try {
      localStorage.removeItem(`${STORAGE_KEY_ACCOUNT_START_BAL_PREFIX}${accountId}`);
    } catch {}
  },

  // Auto Trader session P&L baseline for accurate Take Profit / Stop Loss evaluation
  saveAutoTraderPnlBaseline(offset: number): void {
    try {
      localStorage.setItem(STORAGE_KEY_AUTOTRADER_PNL_BASELINE, String(Number(offset) || 0));
    } catch {}
  },

  loadAutoTraderPnlBaseline(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_AUTOTRADER_PNL_BASELINE);
      if (!raw) return 0;
      const num = Number(raw);
      return !isNaN(num) ? num : 0;
    } catch {
      return 0;
    }
  },
};
