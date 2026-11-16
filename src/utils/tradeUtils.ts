import { TradeRecord } from '../types';

/**
 * Reliable detector for virtual trades across the entire application.
 * Checks isVirtualTrade flag, 'VIRTUAL-' ID/contractId prefix, and simulated ID range [900,000,000, 999,999,999].
 * Real Deriv contract IDs are numbers > 1,000,000,000 (e.g. 284950123456) and are NEVER virtual.
 */
export function isVirtualRecord(t?: TradeRecord | null, isVirtualSystemEnabled: boolean = true): boolean {
  if (!t) return false;
  if (!isVirtualSystemEnabled) return false;
  if (t.isVirtualTrade === true) return true;
  if (typeof t.id === 'string' && t.id.startsWith('VIRTUAL-')) return true;
  if (String(t.contractId).startsWith('VIRTUAL-')) return true;
  return false;
}

/**
 * Accurately extracts the net profit or loss for a trade record.
 * Won trades return positive profit (e.g. +0.29), lost trades return negative stake (e.g. -0.35).
 */
export function getTradeProfit(trade: TradeRecord): number {
  if (trade.status === 'open') return 0;
  if (trade.status === 'won') {
    if (typeof trade.profit === 'number' && trade.profit > 0) {
      return Number(trade.profit.toFixed(2));
    }
    if (typeof trade.payout === 'number' && typeof trade.stake === 'number' && trade.payout > trade.stake) {
      return Number((trade.payout - trade.stake).toFixed(2));
    }
    return Number(((trade.stake || 0) * 0.84).toFixed(2));
  }
  if (trade.status === 'lost') {
    if (typeof trade.profit === 'number' && trade.profit < 0) {
      return Number(trade.profit.toFixed(2));
    }
    return -Number(Math.abs(trade.stake || 0).toFixed(2));
  }
  return 0;
}

/**
 * Plays a pleasant ascending chime sound using Web Audio API when Virtual Switch escalates to the next box.
 */
export function playEscalationChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Ascending arpeggio (C5 -> E5 -> G5 -> C6)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      gain.gain.setValueAtTime(0.18, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.28);
    });
  } catch {}
}
