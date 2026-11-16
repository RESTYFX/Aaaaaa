/**
 * In-Built Background Reconnection Searcher
 * 
 * When a network glitch occurs:
 * 1. Operates completely in-built in the background (hidden from front chart).
 * 2. Continuously sends test data and pings to the WebSocket and backend gateway to test connectivity.
 * 3. Keeps searching and searching silently until network is confirmed restored.
 * 4. The instant network restoration is discovered, triggers a callback to perform the blink page refresh.
 */

const DERIV_PING_ENDPOINTS = [
  'wss://ws.derivws.com/websockets/v3?app_id=1089&l=EN&brand=deriv',
  'wss://ws.binaryws.com/websockets/v3?app_id=1089&l=EN&brand=deriv',
];

export class InBuiltReconnectionSearcher {
  private isSearching: boolean = false;
  private intervalId: any = null;
  private onRestoredCallback: (() => void) | null = null;
  private probeCount: number = 0;
  private activeWsProbe: WebSocket | null = null;
  private lastBlinkReloadTime: number = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      // Listen to window online event as a fast-path trigger for the searcher
      window.addEventListener('online', () => {
        if (this.isSearching) {
          this.probeNow();
        }
      });
    }
  }

  public isSearchingActive(): boolean {
    return this.isSearching;
  }

  /**
   * Start searching silently in-built when a network glitch or disconnection is detected.
   */
  public startSearching(onRestored: () => void): void {
    if (this.isSearching) return;

    this.isSearching = true;
    this.onRestoredCallback = onRestored;
    this.probeCount = 0;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Keep searching in the background every 1.5 seconds
    this.intervalId = setInterval(() => {
      this.probeNow();
    }, 1500);

    // Initial probe immediately
    this.probeNow();
  }

  /**
   * Stop searching if connection recovered internally or session changed
   */
  public stopSearching(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isSearching = false;
    this.cleanupWsProbe();
  }

  private cleanupWsProbe(): void {
    if (this.activeWsProbe) {
      try {
        this.activeWsProbe.onopen = null;
        this.activeWsProbe.onmessage = null;
        this.activeWsProbe.onerror = null;
        this.activeWsProbe.onclose = null;
        this.activeWsProbe.close();
      } catch {}
      this.activeWsProbe = null;
    }
  }

  /**
   * In-built probe: sends test data to WebSocket & checks HTTP gateway.
   * If both respond or WebSocket successfully connects and receives ping response,
   * network is confirmed restored!
   */
  private async probeNow(): Promise<void> {
    if (!this.isSearching) return;
    this.probeCount++;

    const isBrowserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isBrowserOnline) {
      return;
    }

    // Test 1: Check HTTP backend connectivity with short timeout
    let httpOk = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`/api/health?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        httpOk = true;
      }
    } catch {
      httpOk = false;
    }

    if (httpOk) {
      // Backend is online and responding! Network confirmed restored immediately!
      this.handleRestorationDiscovered();
      return;
    }

    // Test 2: In-built WebSocket probe - send data to WebSocket to verify active live socket connection
    this.testWebSocketConnection((wsOk: boolean) => {
      if (!this.isSearching) return;

      if (wsOk) {
        // Network is confirmed fully restored!
        this.handleRestorationDiscovered();
      }
    });
  }

  /**
   * Tests sending data to WebSocket to see if it's genuinely connecting
   */
  private testWebSocketConnection(callback: (ok: boolean) => void): void {
    this.cleanupWsProbe();

    const endpoint = DERIV_PING_ENDPOINTS[this.probeCount % DERIV_PING_ENDPOINTS.length];
    let resolved = false;

    try {
      const ws = new WebSocket(endpoint);
      this.activeWsProbe = ws;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.cleanupWsProbe();
          callback(false);
        }
      }, 1400);

      ws.onopen = () => {
        try {
          // Send test ping data to verify WebSocket accepts data
          ws.send(JSON.stringify({ ping: 1 }));
        } catch {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.cleanupWsProbe();
            callback(false);
          }
        }
      };

      ws.onmessage = (event) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try {
            const data = JSON.parse(event.data);
            if (data.msg_type === 'ping' || data.ping === 'pong' || data.echo_req) {
              this.cleanupWsProbe();
              callback(true);
              return;
            }
          } catch {}
          this.cleanupWsProbe();
          callback(true);
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.cleanupWsProbe();
          callback(false);
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.cleanupWsProbe();
          callback(false);
        }
      };
    } catch {
      if (!resolved) {
        resolved = true;
        callback(false);
      }
    }
  }

  /**
   * Called the instant the in-built searcher confirms the network is restored
   */
  private handleRestorationDiscovered(): void {
    const now = Date.now();
    // Guard against rapid duplicate triggers (2s debounce)
    if (now - this.lastBlinkReloadTime < 2000) {
      return;
    }

    this.lastBlinkReloadTime = now;
    this.stopSearching();

    if (this.onRestoredCallback) {
      this.onRestoredCallback();
    }
  }
}

export const inBuiltSearcher = new InBuiltReconnectionSearcher();
