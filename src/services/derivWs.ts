import { ConnectionState, DerivAccount, DerivUserStatus, MarketTick, TradeRecord, CandleData, OhlcData, NetworkSignalState, SignalLevel } from '../types';
import { VOLATILITY_MARKETS } from '../data/markets';
import { networkEngine } from './networkEngine';
import { inBuiltSearcher } from './inBuiltReconnectionSearcher';

export type DerivWsEventHandler = {
  onConnectionChange?: (state: ConnectionState, error?: string) => void;
  onNetworkGlitch?: (isGlitch: boolean, message?: string) => void;
  onSignalStrength?: (signal: NetworkSignalState) => void;
  onAccount?: (account: DerivAccount) => void;
  onAccountStatus?: (status: DerivUserStatus) => void;
  onBalance?: (balance: number, currency: string) => void;
  onTick?: (tick: MarketTick) => void;
  onCandles?: (candles: CandleData[], symbol: string) => void;
  onOhlc?: (candle: OhlcData) => void;
  onProfitTable?: (trades: TradeRecord[]) => void;
  onTradeUpdate?: (trade: TradeRecord) => void;
  onBuyResult?: (result: { success: boolean; contractId?: number; error?: string }) => void;
};

// Endpoints for Deriv WebSocket gateway with fallback
const DERIV_WS_ENDPOINTS = [
  'wss://ws.derivws.com/websockets/v3',
  'wss://ws.binaryws.com/websockets/v3',
];

export class DerivWebSocketService {
  private ws: WebSocket | null = null;
  private userAppId: string = '33IM5dIMuFaBupAhk042L';
  private token: string = '';
  private pingIntervalId: any = null;
  private watchdogIntervalId: any = null;
  private handlers: DerivWsEventHandler = {};
  private currentSymbol: string = 'R_100';
  private isExplicitDisconnect: boolean = false;
  private hasInitiatedConnection: boolean = false;
  private reconnectAttempts: number = 0;
  private currentEndpointIndex: number = 0;
  private simIntervalId: any = null;
  private isSimulated: boolean = false;
  private lastSimQuote: number = 1245.5;
  private activeMarkets: string[] = ['R_100'];
  private simQuotes: Map<string, number> = new Map();
  private isPatSession: boolean = false;
  private isPatToken: boolean = false;
  private isAuthorizedWs: boolean = false;
  private customWsUrl?: string;
  private sseSource: EventSource | null = null;

  // Real-time signal strength & latency tracking
  private lastPingSentTime: number = 0;
  private currentLatencyMs: number = 45;

  // Network glitch & auto-searching state
  private isNetworkGlitch: boolean = false;
  private lastTickReceivedTime: number = Date.now();
  private reconnectTimeoutId: any = null;
  private hasInitializedWindowListeners: boolean = false;
  private messageQueue: object[] = [];
  private userAccountId: string = '';

  constructor(appId: string = '33IM5dIMuFaBupAhk042L') {
    this.userAppId = appId || '33IM5dIMuFaBupAhk042L';
    this.initNetworkListeners();
    this.startWatchdog();

    // Bind real-time networkEngine updates directly to registered handlers
    networkEngine.subscribe((sig) => {
      this.handlers.onSignalStrength?.(sig);
    });

    networkEngine.onDisconnect((reason) => {
      // Auto-refresh in the backend without browser reload or countdown session
      this.reconnectBackend(reason);
      inBuiltSearcher.startSearching(() => {
        this.handleNetworkRestored('Network restored via in-built background searcher');
      });
    });
  }

  public setAccountId(id: string): void {
    this.userAccountId = id;
  }

  private isReconnectingBackend = false;

  public scheduleReconnect(delayMs: number = 1500, reason: string = 'Auto-reconnecting gateway in backend...'): void {
    if (this.isExplicitDisconnect && !this.hasInitiatedConnection) return;
    if (this.reconnectTimeoutId) return;
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      if (!this.isExplicitDisconnect) {
        this.reconnectBackend(reason);
      }
    }, delayMs);
  }

  /**
   * Reconnect the system in the backend without auto-refreshing the browser.
   * Seamlessly re-establishes the WebSocket connection, re-authenticates the token,
   * re-subscribes to market data, and lets trading resume.
   */
  public async reconnectBackend(reason?: string): Promise<void> {
    if (this.isExplicitDisconnect && !this.hasInitiatedConnection) return;
    this.isExplicitDisconnect = false;
    if (this.isReconnectingBackend) return;
    this.isReconnectingBackend = true;

    try {
      this.handlers.onConnectionChange?.('connecting', reason || 'Applying backend refresh immediately...');

      // Notify backend endpoint asynchronously
      try {
        fetch('/api/backend-refresh', { method: 'POST' }).catch(() => {});
      } catch {}

      if (this.reconnectTimeoutId) {
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
      }
      this.stopPing();

      // If simulated/demo feed, cleanly restore simulation data stream and ticks
      if (this.isSimulated || this.token.startsWith('DEMO_') || this.token === 'DEMO') {
        this.stopSimulation();
        this.isSimulated = true;
        this.startSimulationFallback('Demo market feed reconnected in backend.');
        this.generateSimulatedCandles(this.currentSymbol, 120);
        this.lastTickReceivedTime = Date.now();
        networkEngine.reportWsConnected();
        inBuiltSearcher.stopSearching();
        this.handlers.onConnectionChange?.('connected');
        this.handlers.onConnectionChange?.('authorized');
        this.clearNetworkGlitch();
        return;
      }

      const isPat = this.isPatToken || this.isPatSession || this.token.startsWith('pat_') || Boolean(this.customWsUrl);
      if (isPat) {
        this.isPatToken = true;
        this.isPatSession = true;
      }

      // If this was an OTP PAT session, fetch a fresh single-use OTP WebSocket URL
      if (this.isPatToken && this.token) {
        if (!this.userAccountId) {
          try {
            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('deriv_alchemist_active_session') : null;
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.accountId) this.userAccountId = parsed.accountId;
            }
          } catch {}
        }

        let freshUrl: string | undefined = undefined;

        // 1. Try local server proxy /api/otp
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const otpRes = await fetch('/api/otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pat: this.token,
              accountId: this.userAccountId,
              appId: this.userAppId,
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (otpRes.ok) {
            const otpData = await otpRes.json();
            if (otpData?.url) {
              freshUrl = otpData.url;
            }
          }
        } catch {}

        // 2. Direct fallback to Deriv Options API (works seamlessly on Vercel and in preview iframe)
        if (!freshUrl && this.userAccountId) {
          const candidates = [this.userAppId, '33IM5dIMuFaBupAhk042L', '1089'].filter(Boolean);
          for (const candAppId of candidates) {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 2500);
              const directRes = await fetch(
                `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(this.userAccountId)}/otp`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Deriv-App-ID': candAppId,
                    'Content-Type': 'application/json',
                  },
                  signal: controller.signal,
                }
              );
              clearTimeout(timer);
              if (directRes.ok) {
                const directJson = await directRes.json();
                const u = directJson?.data?.url || directJson?.url;
                if (u) {
                  freshUrl = u;
                  break;
                }
              }
            } catch {}
          }
        }

        if (freshUrl) {
          this.customWsUrl = freshUrl;
        } else {
          this.customWsUrl = undefined;
        }
      }

      // Cycle endpoint
      this.currentEndpointIndex = (this.currentEndpointIndex + 1) % DERIV_WS_ENDPOINTS.length;

      // Close existing socket cleanly without triggering explicit disconnect
      this.cleanupSocket();

      // Reconnect immediately in backend
      this.connect(this.token, this.userAppId, this.customWsUrl);
    } finally {
      this.isReconnectingBackend = false;
    }
  }

  private initNetworkListeners(): void {
    if (typeof window === 'undefined' || this.hasInitializedWindowListeners) return;
    this.hasInitializedWindowListeners = true;

    window.addEventListener('online', () => {
      this.reconnectAttempts = 0;
      if (!this.isExplicitDisconnect && this.isSocketClosed()) {
        this.reconnectBackend('Internet restored: auto-reconnecting gateway in backend...');
      }
    });
  }

  public getSignalState(): NetworkSignalState {
    return networkEngine.getState();
  }

  public setSignalOverride(level: SignalLevel | null): void {
    networkEngine.setSimulationOverride(level);
  }

  public updateSignalState(latencyMs: number, isOnline: boolean, speedOverride?: number): void {
    // Continuous speed and latency calculation is powered by networkEngine
  }

  public isSocketClosed(): boolean {
    return !this.isSimulated && (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING);
  }

  public isMarketDataFlowing(): boolean {
    return (Date.now() - this.lastTickReceivedTime) < 25000;
  }

  public getSilentSec(): number {
    return (Date.now() - this.lastTickReceivedTime) / 1000;
  }

  private startWatchdog(): void {
    if (this.watchdogIntervalId) clearInterval(this.watchdogIntervalId);
    this.watchdogIntervalId = setInterval(() => {
      if (this.isExplicitDisconnect || !this.hasInitiatedConnection) return;

      const silentSec = (Date.now() - this.lastTickReceivedTime) / 1000;
      const isInternetOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const isSocketClosed = this.isSocketClosed();

      // If system is disconnected or socket closed, apply backend refresh immediately!
      if (isInternetOffline || isSocketClosed || (silentSec >= 20.0 && !this.isSimulated)) {
        networkEngine.reportWsDisconnected(
          isInternetOffline
            ? 'Internet connection dropped. Applying backend refresh immediately...'
            : isSocketClosed
            ? 'Socket closed. Applying backend refresh immediately...'
            : `Network silent for ${Math.floor(silentSec)}s. Applying backend refresh immediately...`
        );
        inBuiltSearcher.startSearching(() => {
          this.handleNetworkRestored('Network restored via in-built watchdog probe');
        });
        this.scheduleReconnect(1000, 'Disconnected detected: applying backend refresh immediately');
        return;
      }

      // If feed has a brief pause in poor network (8-19s), gently re-subscribe ticks without dropping connection
      if (silentSec >= 8.0 && !this.isSimulated && !isSocketClosed) {
        this.send({ ticks: this.currentSymbol, subscribe: 1 });
      }
    }, 1500);
  }

  public simulateNetworkGlitch(reason?: string): void {
    this.isExplicitDisconnect = false;
    networkEngine.setSimulationOverride('none');
    this.reconnectBackend(reason || 'Test backend auto-reconnection');
  }

  public setAppId(appId: string) {
    this.userAppId = appId;
  }

  public getAppId(): string {
    return this.userAppId;
  }

  // Deriv requires the `app_id` query param to be a numeric integer.
  // If the user's provided ID is an alphanumeric token (like 33IM5dIMuFaBupAhk042L),
  // we use Deriv's universal open client App ID (1089) for the WS handshake
  // and use the user's token for `authorize`.
  public getCleanNumericAppId(): string {
    const trimmed = (this.userAppId || '').trim();
    if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) > 0) {
      return trimmed;
    }
    return '1089';
  }

  public setHandlers(handlers: DerivWsEventHandler) {
    this.handlers = { ...this.handlers, ...handlers };
    // Immediately emit current signal state
    this.handlers.onSignalStrength?.(networkEngine.getState());
  }

  public triggerNetworkGlitch(reason: string): void {
    if (this.isExplicitDisconnect) return;
    this.isNetworkGlitch = false;
    this.reconnectBackend(reason);
  }

  public clearNetworkGlitch(): void {
    if (!this.isNetworkGlitch) return;
    this.isNetworkGlitch = false;
    this.handlers.onNetworkGlitch?.(false, 'Market feed active & candlestick prices moving.');
  }

  public async handleNetworkRestored(sourceMsg?: string): Promise<void> {
    if (this.isExplicitDisconnect && !this.hasInitiatedConnection) return;
    this.reconnectAttempts = 0;
    networkEngine.reportWsConnected();
    inBuiltSearcher.stopSearching();

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    await this.reconnectBackend(sourceMsg || 'Network restored: auto-reconnecting gateway in backend...');
  }

  public connect(token: string, appId?: string, customWsUrl?: string): void {
    if (appId) {
      this.userAppId = appId;
    }
    if (customWsUrl) {
      this.customWsUrl = customWsUrl;
      this.isPatSession = true;
      this.isPatToken = true;
    } else if (token.startsWith('pat_')) {
      this.customWsUrl = undefined;
      this.isPatSession = true;
      this.isPatToken = true;
    } else {
      this.customWsUrl = undefined;
      this.isPatSession = false;
      this.isPatToken = false;
    }
    this.token = token.trim();
    this.isExplicitDisconnect = false;
    this.hasInitiatedConnection = true;
    this.stopSimulation();

    // If demo token, immediately boot live market simulation
    if (this.token.startsWith('DEMO_') || this.token === 'DEMO') {
      this.isSimulated = true;
      this.startSimulationFallback('Connected to Demo Virtual Trading Feed');
      return;
    }

    // Clean up any existing socket without setting explicit disconnect flag
    this.cleanupSocket();
    this.isExplicitDisconnect = false;
    this.hasInitiatedConnection = true;
    this.handlers.onConnectionChange?.('connecting');

    // Start background SSE bridge to ensure instantaneous live ticks from Deriv
    this.startSSE(this.currentSymbol);

    const numericAppId = this.getCleanNumericAppId();
    const endpoint = DERIV_WS_ENDPOINTS[this.currentEndpointIndex % DERIV_WS_ENDPOINTS.length];
    const wsUrl = this.customWsUrl || `${endpoint}?app_id=${encodeURIComponent(numericAppId)}&l=EN&brand=deriv`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (this.reconnectTimeoutId) {
          clearTimeout(this.reconnectTimeoutId);
          this.reconnectTimeoutId = null;
        }
        this.reconnectAttempts = 0;
        this.lastTickReceivedTime = Date.now();
        networkEngine.reportWsConnected();
        inBuiltSearcher.stopSearching();
        this.handlers.onConnectionChange?.('connected');
        this.clearNetworkGlitch();
        this.startPing();

        // Flush queued messages first
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          if (msg && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify(msg));
            } catch {}
          }
        }

        // Subscribe to public market ticks and 1-minute candles immediately
        this.subscribeTicks(this.currentSymbol);
        this.subscribeCandles(this.currentSymbol, 60, 120);

        // If multi-market was active, re-subscribe to all active markets
        if (this.activeMarkets && this.activeMarkets.length > 0) {
          this.subscribeMultiMarkets(this.activeMarkets);
        }

        if (this.customWsUrl && (this.isPatSession || this.isPatToken)) {
          // Pre-authenticated OTP session for Deriv Options & PAT
          this.isAuthorizedWs = true;
          this.send({ balance: 1, subscribe: 1 });
          this.handlers.onConnectionChange?.('authorized');
          this.clearNetworkGlitch();
        } else if (this.isPatToken || this.token.startsWith('pat_')) {
          // Connected to public gateway for ticks; fetch fresh OTP URL in background without tearing down ticks
          this.handlers.onConnectionChange?.('connected');
          this.fetchPatOtpAndSwitch();
        } else if (this.token && !this.token.startsWith('DEMO')) {
          this.authorize(this.token);
        } else {
          this.handlers.onConnectionChange?.('connected');
        }
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.lastTickReceivedTime = Date.now();
        networkEngine.recordTickReceived();
        this.handleMessage(event.data);
      };

      this.ws.onerror = () => {
        this.isAuthorizedWs = false;
        networkEngine.reportWsDisconnected('WebSocket encounter: retrying...');
        this.handlers.onConnectionChange?.('error', 'WebSocket connection error');
        if (!this.isExplicitDisconnect || this.hasInitiatedConnection) {
          this.scheduleReconnect(1500, 'WebSocket error: applying backend refresh immediately');
          inBuiltSearcher.startSearching(() => {
            this.handleNetworkRestored('Network restored via in-built background probe');
          });
        }
      };

      this.ws.onclose = () => {
        this.isAuthorizedWs = false;
        this.stopPing();
        networkEngine.reportWsDisconnected('Connection closed: reconnecting...');
        if (!this.isExplicitDisconnect || this.hasInitiatedConnection) {
          this.reconnectAttempts++;
          this.currentEndpointIndex = (this.currentEndpointIndex + 1) % DERIV_WS_ENDPOINTS.length;
          this.handlers.onConnectionChange?.('disconnected', 'Connection closed');

          this.scheduleReconnect(1500, 'Connection closed: applying backend refresh immediately');
          inBuiltSearcher.startSearching(() => {
            this.handleNetworkRestored('Network restored via in-built background probe');
          });
        } else {
          this.handlers.onConnectionChange?.('disconnected');
        }
      };
    } catch {
      networkEngine.reportWsDisconnected('Socket error: retrying...');
      this.handlers.onConnectionChange?.('error', 'Socket connection error');
      if (!this.isExplicitDisconnect || this.hasInitiatedConnection) {
        this.scheduleReconnect(1500, 'Socket creation failed: applying backend refresh immediately');
        inBuiltSearcher.startSearching(() => {
          this.handleNetworkRestored('Network restored via in-built background probe');
        });
      }
    }
  }

  private startSSE(symbol: string): void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    this.stopSSE();
    try {
      this.sseSource = new EventSource(`/api/ticks/stream?symbol=${encodeURIComponent(symbol)}`);
      this.sseSource.onmessage = (event) => {
        try {
          this.handleMessage(event.data);
        } catch {
          // ignore
        }
      };
      this.sseSource.onerror = () => {
        // SSE handles reconnection automatically
      };
    } catch {
      // ignore SSE failure
    }
  }

  private stopSSE(): void {
    if (this.sseSource) {
      try {
        this.sseSource.close();
      } catch {
        // ignore
      }
      this.sseSource = null;
    }
  }

  private isFetchingOtp: boolean = false;

  private async fetchPatOtpAndSwitch(): Promise<void> {
    if (this.isFetchingOtp || !this.token || !this.isPatToken) return;
    this.isFetchingOtp = true;
    try {
      if (!this.userAccountId) {
        try {
          const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('deriv_active_session') : null;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.accountId) this.userAccountId = parsed.accountId;
          }
        } catch {}
      }

      let freshUrl: string | undefined = undefined;

      // 1. Try local server proxy /api/otp
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('/api/otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pat: this.token,
            accountId: this.userAccountId,
            appId: this.userAppId,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data?.url) freshUrl = data.url;
        }
      } catch {}

      // 2. Direct fallback to Deriv Options API
      if (!freshUrl && this.userAccountId) {
        const candidates = [this.userAppId, '33IM5dIMuFaBupAhk042L', '1089'].filter(Boolean);
        for (const candAppId of candidates) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);
            const directRes = await fetch(
              `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(this.userAccountId)}/otp`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${this.token}`,
                  'Deriv-App-ID': candAppId,
                  'Content-Type': 'application/json',
                },
                signal: controller.signal,
              }
            );
            clearTimeout(timer);
            if (directRes.ok) {
              const directJson = await directRes.json();
              const u = directJson?.data?.url || directJson?.url;
              if (u) {
                freshUrl = u;
                break;
              }
            }
          } catch {}
        }
      }

      if (freshUrl) {
        this.customWsUrl = freshUrl;
        this.cleanupSocket();
        this.connect(this.token, this.userAppId, freshUrl);
      } else {
        // If still offline, retry in 2.5s without tearing down public market ticks
        setTimeout(() => {
          this.isFetchingOtp = false;
          if (this.isPatToken && !this.customWsUrl && !this.isExplicitDisconnect) {
            this.fetchPatOtpAndSwitch();
          }
        }, 2500);
      }
    } finally {
      this.isFetchingOtp = false;
    }
  }

  private handleConnectionFailure(): void {
    this.handlers.onConnectionChange?.('connecting', 'Auto-searching and retrying Deriv WebSocket connection...');
  }

  private cleanupSocket(): void {
    this.stopPing();
    this.stopSSE();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.isAuthorizedWs = false;
  }

  public getIsSimulated(): boolean {
    return this.isSimulated;
  }

  public isConnectedAndAuthorized(): boolean {
    return Boolean(
      !this.isSimulated &&
      this.isAuthorizedWs &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.token &&
      !this.token.startsWith('DEMO')
    );
  }

  public disconnect(notifyState = true): void {
    this.isExplicitDisconnect = true;
    this.hasInitiatedConnection = false;
    this.isPatToken = false;
    this.isPatSession = false;
    this.isAuthorizedWs = false;
    this.customWsUrl = undefined;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    inBuiltSearcher.stopSearching();
    this.stopPing();
    this.stopSimulation();
    this.cleanupSocket();
    if (notifyState) {
      this.handlers.onConnectionChange?.('disconnected');
    }
  }

  public authorize(token: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.isSimulated) {
        this.mockAuthorize(token);
      }
      return;
    }
    this.handlers.onConnectionChange?.('authorizing');
    this.send({
      authorize: token,
    });
  }

  public fetchAccountStatus(): void {
    if (this.isSimulated) return;
    this.send({
      get_account_status: 1,
    });
  }

  public subscribeBalance(): void {
    if (this.isSimulated) return;
    this.send({
      balance: 1,
      subscribe: 1,
    });
  }

  public subscribeTicks(symbol: string): void {
    const symbolChanged = this.currentSymbol !== symbol;
    this.currentSymbol = symbol;
    if (this.isSimulated) {
      return;
    }
    // Forget existing ticks if any
    this.send({
      forget_all: 'ticks',
    });
    this.send({
      ticks: symbol,
      subscribe: 1,
    });
    if (symbolChanged && this.sseSource) {
      this.startSSE(symbol);
    }
  }

  public subscribeCandles(symbol: string, granularity = 60, count = 120): void {
    const symbolChanged = this.currentSymbol !== symbol;
    this.currentSymbol = symbol;
    if (this.isSimulated) {
      this.generateSimulatedCandles(symbol, count);
      return;
    }
    // Forget existing candles subscription if any
    this.send({
      forget_all: 'candles',
    });
    this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: count,
      end: 'latest',
      style: 'candles',
      granularity: granularity,
      subscribe: 1,
      req_id: 150,
    });
    if (symbolChanged && this.sseSource) {
      this.startSSE(symbol);
    }
  }

  public subscribeMultiMarkets(symbols: string[]): void {
    if (!symbols || symbols.length === 0) return;
    this.activeMarkets = [...symbols];

    if (this.isSimulated) {
      this.activeMarkets.forEach((sym) => {
        this.generateSimulatedCandles(sym, 100);
      });
      return;
    }

    // Subscribe to each market ticks (Deriv supports concurrent tick streams for up to 50 symbols)
    symbols.forEach((sym) => {
      this.send({
        ticks: sym,
        subscribe: 1,
      });
      // Fetch historical 1m candles as a one-off request (WITHOUT subscribe: 1)
      // so Deriv does not reject concurrent candle subscriptions
      this.send({
        ticks_history: sym,
        adjust_start_time: 1,
        count: 100,
        end: 'latest',
        style: 'candles',
        granularity: 60,
      });
    });
  }

  public fetchProfitTable(limit = 50): void {
    if (this.isSimulated) return;
    this.send({
      profit_table: 1,
      description: 1,
      limit: limit,
      sort: 'DESC',
    });
  }

  public buyContract(params: {
    amount: number;
    contract_type: string;
    symbol: string;
    duration: number;
    duration_unit: string;
    currency: string;
  }): void {
    if (this.isSimulated || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Simulate trade execution
      this.simulateContractPurchase(params);
      return;
    }

    if (this.isPatSession) {
      this.send({
        proposal: 1,
        underlying_symbol: params.symbol,
        contract_type: params.contract_type,
        currency: params.currency || 'USD',
        amount: params.amount,
        basis: 'stake',
        duration: params.duration,
        duration_unit: params.duration_unit || 't',
        req_id: 200,
      });
      return;
    }

    this.send({
      buy: 1,
      price: params.amount * 2, // Maximum acceptable buy price cap
      parameters: {
        amount: params.amount,
        basis: 'stake',
        contract_type: params.contract_type,
        currency: params.currency || 'USD',
        duration: params.duration,
        duration_unit: params.duration_unit || 'm',
        symbol: params.symbol,
      },
    });
  }

  public async requestProposalAndBuy(params: {
    symbol: string;
    contractType: string;
    amount: number;
    duration?: number;
    durationUnit?: string;
    currency?: string;
    timeoutMs?: number;
  }): Promise<{ proposal: any; buy: any }> {
    if (this.isSimulated) {
      const dummyId = Math.floor(100000000 + Math.random() * 900000000);
      const payout = Number((params.amount * 1.95).toFixed(2));
      const res = {
        proposal: {
          proposal: { id: `sim_prop_${dummyId}`, ask_price: params.amount, payout },
          req_id: 1,
        },
        buy: {
          buy: {
            contract_id: dummyId,
            buy_price: params.amount,
            payout,
            balance_after: Math.max(0, 10000 - params.amount),
            purchase_time: Math.floor(Date.now() / 1000),
            shortcode: `SIM_${dummyId}`,
            transaction_id: dummyId,
          },
          req_id: 2,
        },
      };
      this.simulateContractPurchase(params as any);
      return res;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket connection is not open. Reconnecting to broker...');
    }

    const socket = this.ws;
    const reqIdProp = Math.floor(200000 + Math.random() * 700000);
    const reqIdBuy = reqIdProp + 1;
    const timeout = params.timeoutMs || 8000;

    return new Promise((resolve, reject) => {
      let timer: any = null;
      let proposalReceived: any = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        socket.removeEventListener('message', messageListener);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Broker order timed out after ${timeout / 1000} seconds`));
      }, timeout);

      const messageListener = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.req_id === reqIdProp) {
            if (data.error) {
              cleanup();
              reject(new Error(data.error.message || 'Deriv proposal rejected'));
              return;
            }
            if (data.proposal && data.proposal.id) {
              proposalReceived = data;
              const propId = data.proposal.id;
              const askPrice = Number(data.proposal.ask_price || params.amount);
              socket.send(JSON.stringify({
                buy: propId,
                price: Math.max(params.amount, askPrice),
                req_id: reqIdBuy,
              }));
            }
          } else if (data.req_id === reqIdBuy) {
            cleanup();
            if (data.error) {
              reject(new Error(data.error.message || 'Deriv purchase rejected'));
              return;
            }
            if (data.buy && data.buy.contract_id) {
              this.subscribeProposalOpenContract(data.buy.contract_id);
              resolve({
                proposal: proposalReceived,
                buy: data,
              });
            } else {
              reject(new Error('Contract purchase confirmation missing from Deriv response'));
            }
          }
        } catch {
          // ignore
        }
      };

      socket.addEventListener('message', messageListener);

      const propPayload: any = {
        proposal: 1,
        contract_type: params.contractType,
        currency: params.currency || 'USD',
        amount: params.amount,
        basis: 'stake',
        duration: params.duration || 1,
        duration_unit: params.durationUnit || 'm',
        req_id: reqIdProp,
      };
      if (this.isPatSession) {
        propPayload.underlying_symbol = params.symbol;
      } else {
        propPayload.symbol = params.symbol;
      }
      socket.send(JSON.stringify(propPayload));
    });
  }

  public subscribeProposalOpenContract(contractId: number): void {
    if (this.isSimulated) return;
    this.send({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
    });
  }

  public requestContractStatus(contractId: number): void {
    if (this.isSimulated || !contractId) return;
    this.send({
      proposal_open_contract: 1,
      contract_id: contractId,
    });
  }

  public requestHistoricalCandles(symbol: string, granularity = 60, count = 120): void {
    if (this.isSimulated) {
      this.generateSimulatedCandles(symbol, count);
      return;
    }
    this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: count,
      end: 'latest',
      style: 'candles',
      granularity: granularity,
      req_id: 151,
    });
  }

  private send(data: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (err) {
        this.messageQueue.push(data);
      }
    } else {
      this.messageQueue.push(data);
    }
  }

  private startPing(): void {
    this.stopPing();
    // Deriv WebSocket heartbeat ping every 3.0s
    this.pingIntervalId = setInterval(() => {
      if (this.isExplicitDisconnect) return;

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentTime = Date.now();
        this.send({ ping: 1 });

        // Maintain poor network resilience:
        // Do NOT disconnect on short lags. Gently re-subscribe ticks at 12s, only reconnect backend at 25s
        const silentSec = (Date.now() - this.lastTickReceivedTime) / 1000;
        if (silentSec >= 12 && !this.isSimulated) {
          this.subscribeTicks(this.currentSymbol);
          if (silentSec >= 25) {
            networkEngine.reportWsDisconnected(`Market feed silent for ${Math.floor(silentSec)}s. Reconnecting in backend...`);
            this.reconnectBackend(`Market feed silent for ${Math.floor(silentSec)}s. Reconnecting gateway in background...`);
          }
        }
      } else if (!this.isSimulated && !this.isExplicitDisconnect) {
        const silentSec = (Date.now() - this.lastTickReceivedTime) / 1000;
        if (silentSec >= 10) {
          networkEngine.reportWsDisconnected('Deriv WebSocket disconnected. Reconnecting in background...');
          this.reconnectBackend('Deriv WebSocket disconnected. Reconnecting gateway in background...');
        }
      }
    }, 3000);
  }

  private stopPing(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  private handleMessage(dataStr: string): void {
    try {
      const data = JSON.parse(dataStr);
      const msgType = data.msg_type;

      if (data.error) {
        if (msgType === 'authorize') {
          const rawMsg = data.error.message || 'Authorization failed with provided token.';
          this.handlers.onConnectionChange?.('error', rawMsg);
          // Keep live tick streaming active for public charts
          this.subscribeTicks(this.currentSymbol);
        } else if (msgType === 'buy') {
          this.handlers.onBuyResult?.({
            success: false,
            error: data.error.message || 'Purchase rejected by Deriv.',
          });
        }
        return;
      }

      switch (msgType) {
        case 'ping': {
          const latency = Math.max(1, Date.now() - this.lastPingSentTime);
          this.currentLatencyMs = latency;
          this.updateSignalState(latency, true);
          break;
        }
        case 'authorize': {
          const auth = data.authorize;
          let resolvedLoginId = auth.loginid;
          let resolvedIsVirtual = Boolean(auth.is_virtual);
          let resolvedBalance = Number(auth.balance);
          let resolvedCurrency = auth.currency;

          if (this.userAccountId && Array.isArray(auth.account_list)) {
            const matched = auth.account_list.find((a: any) => a.loginid === this.userAccountId);
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
            token: this.token,
            appId: this.userAppId,
            scopes: auth.scopes,
            accountList: auth.account_list,
          };
          this.isAuthorizedWs = true;
          this.handlers.onConnectionChange?.('authorized');
          this.handlers.onAccount?.(account);
          this.handlers.onBalance?.(resolvedBalance, resolvedCurrency);

          // Immediately fetch user status from Deriv WebSocket
          this.fetchAccountStatus();
          this.subscribeBalance();
          this.subscribeTicks(this.currentSymbol);
          break;
        }

        case 'get_account_status': {
          const status = data.get_account_status;
          if (status) {
            this.handlers.onAccountStatus?.(status);
          }
          break;
        }

        case 'balance': {
          const bal = data.balance;
          if (bal && typeof bal.balance === 'number') {
            this.handlers.onBalance?.(bal.balance, bal.currency || 'USD');
          }
          break;
        }

        case 'tick': {
          const t = data.tick;
          if (t) {
            const quote = Number(t.quote);
            const epoch = Number(t.epoch);
            if (!isNaN(quote) && !isNaN(epoch)) {
              this.lastTickReceivedTime = Date.now();
              networkEngine.recordTickReceived();
              if (this.isNetworkGlitch) {
                this.clearNetworkGlitch();
              }
              this.lastSimQuote = quote;
              this.handlers.onTick?.({
                epoch,
                quote,
                symbol: t.symbol || this.currentSymbol,
                ask: t.ask ? Number(t.ask) : undefined,
                bid: t.bid ? Number(t.bid) : undefined,
              });
            }
          }
          break;
        }

        case 'candles': {
          const rawCandles = data.candles;
          if (Array.isArray(rawCandles) && rawCandles.length > 0) {
            this.lastTickReceivedTime = Date.now();
            networkEngine.recordTickReceived();
            if (this.isNetworkGlitch) {
              this.clearNetworkGlitch();
            }
            const mapped: CandleData[] = rawCandles.map((c: any) => ({
              epoch: Number(c.epoch),
              open: Number(c.open),
              high: Number(c.high),
              low: Number(c.low),
              close: Number(c.close),
            }));
            const sym = data.echo_req?.ticks_history || this.currentSymbol;
            if (mapped.length > 0) {
              this.lastSimQuote = mapped[mapped.length - 1].close;
            }
            this.handlers.onCandles?.(mapped, sym);
          }
          break;
        }

        case 'ohlc': {
          const o = data.ohlc;
          if (o && (typeof o.close === 'number' || !isNaN(Number(o.close)))) {
            const close = Number(o.close);
            this.lastSimQuote = close;
            this.handlers.onOhlc?.({
              epoch: Number(o.epoch),
              open: Number(o.open),
              high: Number(o.high),
              low: Number(o.low),
              close: close,
              open_time: o.open_time ? Number(o.open_time) : Number(o.epoch),
              granularity: o.granularity ? Number(o.granularity) : 60,
              symbol: o.symbol || this.currentSymbol,
            });
          }
          break;
        }

        case 'profit_table': {
          const pt = data.profit_table;
          if (pt && Array.isArray(pt.transactions)) {
            const records: TradeRecord[] = pt.transactions.map((tx: any) => {
              const buyPrice = Number(tx.buy_price) || 0;
              const sellPrice = Number(tx.sell_price) || 0;
              const profit = Number((sellPrice - buyPrice).toFixed(2));
              const status = profit > 0 ? 'won' : profit < 0 ? 'lost' : sellPrice > 0 ? 'won' : 'lost';

              let sym = tx.shortcode?.split('_')[1];
              if (sym === 'R' && tx.shortcode) {
                const parts = tx.shortcode.split('_');
                sym = `R_${parts[2]}`;
              }
              const marketDef = VOLATILITY_MARKETS.find((m) => m.symbol === sym);
              const symName = marketDef?.name || sym || 'Synthetic Index';

              return {
                id: String(tx.contract_id || tx.transaction_id),
                contractId: tx.contract_id,
                transactionId: tx.transaction_id,
                symbol: sym || 'SYNTHETIC',
                symbolName: symName,
                contractType: tx.shortcode?.split('_')[0] || 'CALL',
                stake: buyPrice,
                payout: sellPrice,
                profit: profit,
                status: status,
                purchaseTime: tx.purchase_time * 1000,
                sellTime: tx.sell_time ? tx.sell_time * 1000 : undefined,
                longcode: tx.longcode,
                shortcode: tx.shortcode,
              };
            });
            this.handlers.onProfitTable?.(records);
          }
          break;
        }

        case 'proposal': {
          const prop = data.proposal;
          if (prop && prop.id && data.req_id === 200) {
            this.send({
              buy: prop.id,
              price: prop.ask_price || 1,
              req_id: 201,
            });
          }
          break;
        }

        case 'buy': {
          const buyInfo = data.buy;
          if (buyInfo && buyInfo.contract_id) {
            this.handlers.onBuyResult?.({
              success: true,
              contractId: buyInfo.contract_id,
            });
            this.subscribeProposalOpenContract(buyInfo.contract_id);
          }
          break;
        }

        case 'proposal_open_contract': {
          const poc = data.proposal_open_contract;
          if (poc) {
            const hasExplicitStatus = poc.status === 'won' || poc.status === 'lost';
            const sellPrice = typeof poc.sell_price === 'number' ? Number(poc.sell_price) : 0;
            const buyPrice = typeof poc.buy_price === 'number' ? Number(poc.buy_price) : 0;
            const profit = typeof poc.profit === 'number'
              ? Number(poc.profit)
              : (sellPrice - buyPrice);

            // A contract from Deriv is genuinely finished only when status is explicitly 'won'/'lost'
            // or when is_sold is 1 with settled payout/sell_price
            let status: 'won' | 'lost' | 'open' = 'open';
            if (poc.status === 'won' || (poc.is_sold === 1 && (profit > 0 || sellPrice > buyPrice))) {
              status = 'won';
            } else if (poc.status === 'lost' || (poc.is_sold === 1 && hasExplicitStatus && profit <= 0)) {
              status = 'lost';
            } else if (poc.is_sold === 1 && !hasExplicitStatus && sellPrice === 0) {
              // Deriv intermediate packet while settlement calculation is pending:
              // Keep as 'open' to prevent flashing a temporary false loss in trade history
              status = 'open';
            } else {
              status = 'open';
            }

            const rawEntry = poc.entry_spot !== undefined && poc.entry_spot !== null
              ? Number(poc.entry_spot)
              : (poc.entry_tick !== undefined && poc.entry_tick !== null ? Number(poc.entry_tick) : undefined);
            const rawCurrent = poc.current_spot !== undefined && poc.current_spot !== null ? Number(poc.current_spot) : undefined;
            const rawExit = poc.exit_tick !== undefined && poc.exit_tick !== null
              ? Number(poc.exit_tick)
              : (poc.exit_spot !== undefined && poc.exit_spot !== null ? Number(poc.exit_spot) : rawCurrent);
            const entryBarrier = poc.barrier
              || poc.entry_tick_display_value
              || (rawEntry !== undefined ? String(rawEntry) : (poc.entry_tick !== undefined ? String(poc.entry_tick) : undefined));
            const exitBarrier = poc.exit_tick_display_value
              || (poc.exit_tick !== undefined && poc.exit_tick !== null ? String(poc.exit_tick) : undefined)
              || (poc.exit_spot !== undefined && poc.exit_spot !== null ? String(poc.exit_spot) : undefined)
              || (rawExit !== undefined ? String(rawExit) : undefined);

            const rawUnderlying = poc.underlying_symbol || poc.underlying || poc.symbol;
            let resolvedSymbol = rawUnderlying;
            if (!resolvedSymbol && poc.shortcode) {
              const parts = poc.shortcode.split('_');
              if (parts.length >= 3 && parts[1] === 'R') {
                resolvedSymbol = `R_${parts[2]}`;
              } else if (parts.length >= 2) {
                resolvedSymbol = parts[1];
              }
            }
            const marketDef = VOLATILITY_MARKETS.find((m) => m.symbol === resolvedSymbol);
            const resolvedSymbolName = poc.display_name || marketDef?.name || resolvedSymbol || this.currentSymbol;

            const record: TradeRecord = {
              id: String(poc.contract_id),
              contractId: poc.contract_id,
              transactionId: poc.transaction_ids?.buy,
              symbol: resolvedSymbol || this.currentSymbol,
              symbolName: resolvedSymbolName,
              contractType: poc.contract_type || 'CALL',
              stake: Number(poc.buy_price) || 0,
              payout: Number(poc.payout) || 0,
              profit: status === 'open' ? 0 : Number(profit.toFixed(2)),
              currentSpot: rawCurrent,
              currentProfit: Number(profit.toFixed(2)),
              status: status,
              purchaseTime: (poc.date_start || poc.purchase_time || Date.now() / 1000) * 1000,
              sellTime: status !== 'open' ? (poc.sell_spot_time ? poc.sell_spot_time * 1000 : Date.now()) : undefined,
              entrySpot: rawEntry,
              exitSpot: status === 'open' ? undefined : rawExit,
              entryBarrier: entryBarrier,
              exitBarrier: status === 'open' ? undefined : exitBarrier,
              barrier: poc.barrier || (rawEntry !== undefined ? String(rawEntry) : undefined),
              longcode: poc.longcode,
              shortcode: poc.shortcode,
            };

            this.handlers.onTradeUpdate?.(record);
          }
          break;
        }

        case 'ping':
          break;
      }
    } catch {
      // ignore parse issues
    }
  }

  // Market Simulation Fallback (Ensures user experience is never blocked)
  public startSimulationFallback(reasonMsg?: string): void {
    this.isSimulated = true;
    this.handlers.onConnectionChange?.('connected', reasonMsg);

    this.mockAuthorize(this.token || 'DEMO_USER');
    const symbolsToInit = this.activeMarkets.length > 0 ? this.activeMarkets : [this.currentSymbol];
    symbolsToInit.forEach((sym) => {
      this.generateSimulatedCandles(sym, 100);
    });

    if (this.simIntervalId) {
      clearInterval(this.simIntervalId);
      this.simIntervalId = null;
    }
    this.simIntervalId = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const minuteAligned = nowSec - (nowSec % 60);
      const symbolsToSim = this.activeMarkets.length > 0 ? this.activeMarkets : [this.currentSymbol];

      symbolsToSim.forEach((sym) => {
        let curQuote = this.simQuotes.get(sym);
        if (curQuote === undefined) {
          const mkt = VOLATILITY_MARKETS.find((m) => m.symbol === sym);
          curQuote = mkt?.basePrice || 1000;
        }

        const delta = (Math.random() - 0.49) * Math.max(0.5, curQuote * 0.001);
        curQuote = Math.max(1, Number((curQuote + delta).toFixed(4)));
        this.simQuotes.set(sym, curQuote);

        if (sym === this.currentSymbol) {
          this.lastSimQuote = curQuote;
        }

        this.handlers.onTick?.({
          epoch: nowSec,
          quote: curQuote,
          symbol: sym,
        });

        this.handlers.onOhlc?.({
          epoch: nowSec,
          open: curQuote - delta * 0.5,
          high: Math.max(curQuote, curQuote - delta * 0.5) + Math.abs(delta) * 0.3,
          low: Math.min(curQuote, curQuote - delta * 0.5) - Math.abs(delta) * 0.3,
          close: curQuote,
          open_time: minuteAligned,
          granularity: 60,
          symbol: sym,
        });
      });
    }, 1000);
  }

  private generateSimulatedCandles(symbol: string, count = 100): void {
    const nowSec = Math.floor(Date.now() / 1000);
    const minuteAligned = nowSec - (nowSec % 60);
    const mkt = VOLATILITY_MARKETS.find((m) => m.symbol === symbol);
    let currentPrice = this.simQuotes.get(symbol) || mkt?.basePrice || this.lastSimQuote || 1000;

    const candles: CandleData[] = [];
    for (let i = count; i >= 0; i--) {
      const epoch = minuteAligned - i * 60;
      const open = currentPrice;
      const change = (Math.random() - 0.49) * (currentPrice * 0.003);
      const close = Number((open + change).toFixed(4));
      const high = Number((Math.max(open, close) + Math.random() * (currentPrice * 0.0015)).toFixed(4));
      const low = Number((Math.min(open, close) - Math.random() * (currentPrice * 0.0015)).toFixed(4));
      currentPrice = close;
      candles.push({ epoch, open, high, low, close });
    }
    this.simQuotes.set(symbol, currentPrice);
    if (symbol === this.currentSymbol) {
      this.lastSimQuote = currentPrice;
    }
    this.handlers.onCandles?.(candles, symbol);
  }

  private stopSimulation(): void {
    if (this.simIntervalId) {
      clearInterval(this.simIntervalId);
      this.simIntervalId = null;
    }
    this.isSimulated = false;
  }

  private mockAuthorize(token: string): void {
    const isRealToken = Boolean(token && !token.startsWith('DEMO_') && token !== 'DEMO');
    let savedDemoBalance = 10000.0;
    let savedDemoId = '';
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('deriv_active_session') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.accountId) savedDemoId = parsed.accountId;
        if (typeof parsed?.balance === 'number' && !isNaN(parsed.balance)) {
          savedDemoBalance = parsed.balance;
        }
      }
    } catch {}

    const loginid = isRealToken
      ? (this.userAccountId && !this.userAccountId.startsWith('VRTC') && !this.userAccountId.startsWith('DOT')
          ? this.userAccountId
          : 'CR' + Math.floor(100000 + Math.random() * 900000))
      : (this.userAccountId || savedDemoId || ('VRTC' + Math.floor(1000000 + Math.random() * 9000000)));
    const effectiveBalance = isRealToken ? 10000.0 : savedDemoBalance;

    const account: DerivAccount = {
      loginid: loginid,
      currency: 'USD',
      balance: effectiveBalance,
      isVirtual: !isRealToken,
      fullname: isRealToken ? 'Deriv Trader' : 'Demo Virtual Account',
      email: isRealToken ? 'trader@deriv.com' : 'demo@deriv.com',
      token: token,
      appId: this.userAppId,
    };
    this.handlers.onConnectionChange?.('authorized');
    this.handlers.onAccount?.(account);
    this.handlers.onAccountStatus?.({
      status: ['authenticated', 'allow_document_upload'],
      riskClassification: 'low',
      promptClientToAuthenticate: 0,
      authentication: {
        document: { status: 'verified' },
        identity: { status: 'verified' },
      },
    });
    this.handlers.onBalance?.(effectiveBalance, 'USD');
  }

  private simulateContractPurchase(params: {
    amount: number;
    contract_type: string;
    symbol: string;
    duration: number;
    duration_unit: string;
    currency: string;
  }): void {
    const dummyContractId = Math.floor(100000000 + Math.random() * 900000000);
    const entrySpot = this.simQuotes.get(params.symbol) || this.lastSimQuote;

    this.handlers.onBuyResult?.({
      success: true,
      contractId: dummyContractId,
    });

    const mkt = VOLATILITY_MARKETS.find((m) => m.symbol === params.symbol);
    const resolvedName = mkt?.name || params.symbol;

    const openTrade: TradeRecord = {
      id: String(dummyContractId),
      contractId: dummyContractId,
      symbol: params.symbol,
      symbolName: resolvedName,
      contractType: params.contract_type,
      stake: params.amount,
      payout: Number((params.amount * 1.95).toFixed(2)),
      profit: 0,
      status: 'open',
      purchaseTime: Date.now(),
      entrySpot: entrySpot,
      entryBarrier: entrySpot.toFixed(2),
      barrier: entrySpot.toFixed(2),
    };

    this.handlers.onTradeUpdate?.(openTrade);

    // If 1-minute expiry, settle at 59 seconds (or standard 59s settlement for 1m options)
    const settleDurationSec = params.duration_unit === 'm' ? 59 : Math.max(2, params.duration);

    setTimeout(() => {
      const exitSpot = this.simQuotes.get(params.symbol) || this.lastSimQuote;
      let won = false;
      if (params.contract_type === 'CALL') {
        won = exitSpot >= entrySpot;
      } else if (params.contract_type === 'PUT') {
        won = exitSpot <= entrySpot;
      } else {
        won = exitSpot >= entrySpot;
      }

      const payout = won ? Number((params.amount * 1.84).toFixed(2)) : 0;
      const profit = won ? Number((payout - params.amount).toFixed(2)) : -params.amount;

      const settledTrade: TradeRecord = {
        ...openTrade,
        exitSpot: exitSpot,
        exitBarrier: exitSpot.toFixed(2),
        sellTime: Date.now(),
        payout: payout > 0 ? payout : openTrade.payout,
        profit: profit,
        status: won ? 'won' : 'lost',
      };

      this.handlers.onTradeUpdate?.(settledTrade);
    }, settleDurationSec * 1000);
  }
}

export const derivWs = new DerivWebSocketService('33IM5dIMuFaBupAhk042L');
