import { NetworkSignalState, SignalLevel } from '../types';

type SignalListener = (state: NetworkSignalState) => void;
type DisconnectListener = (reason: string) => void;

class NetworkEngine {
  private listeners: Set<SignalListener> = new Set();
  private disconnectListeners: Set<DisconnectListener> = new Set();
  private isRunning: boolean = false;
  private intervalId: any = null;
  private isBeepPulse: boolean = false;
  private simulatedOverride: SignalLevel | null = null;
  private lastTickReceivedTime: number = Date.now();
  private lastMeasuredSpeedMbps: number = 0;
  private lastMeasuredLatencyMs: number = 0;
  private latencyHistory: number[] = [];
  private consecutiveFailures: number = 0;

  // Real WebSocket connection tracking
  private isWsConnected: boolean = true;
  private wsDisconnectReason: string = '';
  private wasDisconnectedEmitted: boolean = false;

  private currentState: NetworkSignalState = {
    level: 'good',
    bars: 3,
    latencyMs: 120,
    speedMbps: 4.5,
    speedText: '4.5 Mbps',
    jitterMs: 10,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    statusText: 'Calculating network...',
    lastChecked: Date.now(),
    isBeeping: false,
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => {
        this.consecutiveFailures = 3;
        // Update signal indicator to reflect offline state without prematurely triggering browser auto-refresh
        this.currentState = {
          ...this.currentState,
          level: 'none',
          bars: 0,
          isOnline: false,
          statusText: 'No Internet Connection (0 bars)',
          lastChecked: Date.now(),
        };
        this.notify();
      });

      window.addEventListener('online', () => {
        this.consecutiveFailures = 0;
        this.runSpeedCheck();
      });

      // Start network monitoring immediately upon instantiation
      this.start();
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    // Initial check right away
    this.runSpeedCheck();
    // Continuous monitoring every 1.5 seconds
    this.intervalId = setInterval(() => {
      this.runSpeedCheck();
    }, 1500);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  public subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  public onDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  public getState(): NetworkSignalState {
    return this.currentState;
  }

  public recordTickReceived(): void {
    this.lastTickReceivedTime = Date.now();
    // If we receive a tick, the WebSocket is actively alive
    this.isWsConnected = true;
  }

  public reportWsConnected(): void {
    this.isWsConnected = true;
    this.wasDisconnectedEmitted = false;
    this.lastTickReceivedTime = Date.now();
    this.wsDisconnectReason = '';
    this.runSpeedCheck();
  }

  private lastDisconnectEmitTime: number = 0;

  public reportWsDisconnected(reason?: string): void {
    this.isWsConnected = false;
    this.wsDisconnectReason = reason || 'WebSocket disconnected.';
    // Update visual signal status to show disconnected and trigger immediate backend refresh
    this.currentState = {
      ...this.currentState,
      level: 'none',
      bars: 0,
      isOnline: false,
      statusText: 'DISCONNECTED',
      lastChecked: Date.now(),
    };
    this.notify();
    this.emitDisconnected(this.wsDisconnectReason);
  }

  public setSimulationOverride(override: SignalLevel | null): void {
    this.simulatedOverride = override;
    if (override === 'none') {
      this.isWsConnected = false;
      this.wasDisconnectedEmitted = false;
      this.emitDisconnected('Manual Test: Network Glitch Triggered. Auto-refreshing gateway in backend...');
      // Automatically clear test override after 1.5s so backend reconnect restores live state smoothly
      setTimeout(() => {
        if (this.simulatedOverride === 'none') {
          this.simulatedOverride = null;
          this.isWsConnected = true;
          this.wasDisconnectedEmitted = false;
          this.runSpeedCheck();
        }
      }, 1500);
    } else {
      this.isWsConnected = true;
      this.wasDisconnectedEmitted = false;
      this.runSpeedCheck();
    }
  }

  private emitDisconnected(reason: string): void {
    this.currentState = {
      level: 'none',
      bars: 0,
      latencyMs: 0,
      speedMbps: 0,
      speedText: '0.0 Mbps',
      jitterMs: 0,
      isOnline: false,
      statusText: 'DISCONNECTED',
      lastChecked: Date.now(),
      isBeeping: this.isBeepPulse,
    };
    this.notify();

    const now = Date.now();
    if (!this.wasDisconnectedEmitted || (now - this.lastDisconnectEmitTime > 3000)) {
      this.wasDisconnectedEmitted = true;
      this.lastDisconnectEmitTime = now;
      this.disconnectListeners.forEach((fn) => {
        try {
          fn(reason);
        } catch {}
      });
    }
  }

  private async runSpeedCheck(): Promise<void> {
    this.isBeepPulse = !this.isBeepPulse;

    // Check for simulated overrides first
    if (this.simulatedOverride) {
      if (this.simulatedOverride === 'none') {
        this.emitDisconnected('Simulated Disconnect');
        return;
      }

      let bars: 0 | 1 | 2 | 3 | 4 = 4;
      let latency = 45;
      let speed = 9.5;
      let status = 'Excellent';

      if (this.simulatedOverride === 'poor') {
        bars = 1;
        latency = 650 + Math.floor(Math.random() * 80);
        speed = 0.4;
        status = 'Poor';
      } else if (this.simulatedOverride === 'fair') {
        bars = 2;
        latency = 380 + Math.floor(Math.random() * 50);
        speed = 1.6;
        status = 'Fair';
      } else if (this.simulatedOverride === 'good') {
        bars = 3;
        latency = 190 + Math.floor(Math.random() * 40);
        speed = 4.2;
        status = 'Good';
      } else {
        bars = 4;
        latency = 45 + Math.floor(Math.random() * 20);
        speed = 12.4;
        status = 'Excellent';
      }

      const speedText = speed >= 1 ? `${speed.toFixed(1)} Mbps` : `${Math.round(speed * 1000)} kbps`;
      this.currentState = {
        level: this.simulatedOverride,
        bars,
        latencyMs: latency,
        speedMbps: speed,
        speedText,
        jitterMs: Math.floor(latency * 0.1),
        isOnline: true,
        statusText: `${status} (${latency}ms • ${speedText})`,
        lastChecked: Date.now(),
        isBeeping: this.isBeepPulse,
      };
      this.notify();
      return;
    }

    // Fast Network Glitch & Freeze Detection:
    // Deriv synthetics tick every 1-2s. Only trigger disconnected state if internet completely goes off
    // or if the market feed has experienced an extended complete blackout (>= 25-35 seconds).
    const isBrowserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const silentSec = (Date.now() - this.lastTickReceivedTime) / 1000;

    if (isBrowserOffline || !this.isWsConnected || silentSec >= 20.0) {
      this.consecutiveFailures++;
      this.emitDisconnected(
        isBrowserOffline
          ? 'Internet offline. Applying backend refresh immediately...'
          : !this.isWsConnected
          ? 'WebSocket disconnected. Applying backend refresh immediately...'
          : `Network silent for ${Math.floor(silentSec)}s. Applying backend refresh immediately...`
      );
      return;
    }

    // 4. Real throughput probe against /api/speed-test (32KB payload)
    try {
      const probeStart = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);

      const res = await fetch(`/api/speed-test?t=${Date.now()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error('Speed probe failed');
      }

      const blob = await res.blob();
      const durationMs = Math.max(1, performance.now() - probeStart);
      const bytes = blob.size;

      // Real measured network speed (Megabits per second)
      // (bytes * 8 bits) / (duration in seconds * 1,000,000)
      const measuredMbps = Number((((bytes * 8) / (durationMs / 1000)) / 1_000_000).toFixed(2));
      const measuredLatency = Math.max(1, Math.round(durationMs * 0.45)); // Approximation of RTT from transfer time

      this.lastMeasuredSpeedMbps = measuredMbps;
      this.lastMeasuredLatencyMs = measuredLatency;
      this.consecutiveFailures = 0;

      // Calculate jitter from rolling history
      this.latencyHistory.push(measuredLatency);
      if (this.latencyHistory.length > 6) this.latencyHistory.shift();
      const avgLatency = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
      const jitterMs = Math.round(Math.abs(measuredLatency - avgLatency));

      // Network classification based on measured speed & latency:
      // Note: A poor or slow network connection is fully maintained and kept online!
      let level: SignalLevel = 'good';
      let bars: 0 | 1 | 2 | 3 | 4 = 3;
      let statusLabel = 'Good';

      if (measuredMbps < 0.2 || measuredLatency > 1500) {
        level = 'poor';
        bars = 1;
        statusLabel = 'Poor Signal (Maintained)';
      } else if (measuredMbps < 1.0 || measuredLatency >= 450) {
        level = 'poor';
        bars = 1;
        statusLabel = 'Poor Signal (Connected)';
      } else if (measuredMbps < 2.5 || measuredLatency >= 250) {
        level = 'fair';
        bars = 2;
        statusLabel = 'Fair Signal';
      } else if (measuredMbps >= 6.0 && measuredLatency < 120) {
        level = 'excellent';
        bars = 4;
        statusLabel = 'Excellent';
      } else {
        level = 'good';
        bars = 3;
        statusLabel = 'Good Signal';
      }

      const speedText = measuredMbps >= 1 ? `${measuredMbps.toFixed(1)} Mbps` : `${Math.round(measuredMbps * 1000)} kbps`;

      this.currentState = {
        level,
        bars,
        latencyMs: measuredLatency,
        speedMbps: measuredMbps,
        speedText,
        jitterMs,
        isOnline: true,
        statusText: `${statusLabel} (${measuredLatency}ms • ${speedText})`,
        lastChecked: Date.now(),
        isBeeping: this.isBeepPulse,
      };
      this.notify();
    } catch {
      this.consecutiveFailures++;
      const isBrowserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const silentSec = (Date.now() - this.lastTickReceivedTime) / 1000;
      // Only emit disconnect if the internet is completely offline or there has been prolonged silence (25+ seconds)
      if (isBrowserOffline || (this.consecutiveFailures >= 10 && silentSec >= 25.0)) {
        this.emitDisconnected('Network connection completely offline. Auto-refreshing gateway in backend...');
        return;
      }
      // Poor network maintained: Keep online state true and indicate Poor Signal
      this.currentState = {
        level: 'poor',
        bars: 1,
        latencyMs: 950,
        speedMbps: 0.25,
        speedText: '250 kbps',
        jitterMs: 120,
        isOnline: true,
        statusText: 'Poor Signal (Network Lagging • Maintained)',
        lastChecked: Date.now(),
        isBeeping: this.isBeepPulse,
      };
      this.notify();
    }
  }

  private notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn(this.currentState);
      } catch {}
    });
  }
}

export const networkEngine = new NetworkEngine();
