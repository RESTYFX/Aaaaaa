import React from 'react';
import { WifiOff, RefreshCw, CheckCircle2, ShieldCheck, Activity, Timer, AlertOctagon } from 'lucide-react';
import { NetworkSignalState } from '../types';

interface NetworkGlitchBannerProps {
  isGlitch: boolean;
  glitchMessage?: string;
  countdownSeconds?: number;
  onRefreshNow?: () => void;
  onRetryNow?: () => void;
  restoredMessage?: string | null;
  isAutoTrading: boolean;
  currentMartingaleStep: number;
  currentStake: number;
  signalState?: NetworkSignalState;
}

export const NetworkGlitchBanner: React.FC<NetworkGlitchBannerProps> = () => {
  // Never show auto-refreshing session or glitch banner: "stop that auto refreshing session, stop it. Don't even show it."
  return null;
};
