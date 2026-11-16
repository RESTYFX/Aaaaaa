import React from 'react';
import { ConnectionState, DerivAccount, NetworkSignalState } from '../types';
import { LogOut } from 'lucide-react';
import { SignalStrengthIndicator } from './SignalStrengthIndicator';
import { networkEngine } from '../services/networkEngine';

interface HeaderProps {
  connectionState: ConnectionState;
  connectionError?: string;
  account: DerivAccount | null;
  currentBalance?: number;
  onOpenLogin: () => void;
  onDisconnect: () => void;
  onRefreshData: () => void;
  onSwitchAccount?: (accountId: string) => void;
  signalState?: NetworkSignalState;
  onSimulateGlitch?: () => void;
  onReconnect?: () => void;
  countdownSeconds?: number;
  isGlitch?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  account,
  currentBalance,
  onOpenLogin,
  onDisconnect,
  onSwitchAccount,
  signalState,
  onSimulateGlitch,
  onReconnect,
  countdownSeconds,
  isGlitch,
}) => {
  const currentSignal: NetworkSignalState = signalState || networkEngine.getState();
  const displayBalance = typeof currentBalance === 'number' && !isNaN(currentBalance)
    ? currentBalance
    : (account?.balance ?? 0);
  const formattedBalance = displayBalance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/95 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-0 sm:h-14 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        {/* Top Row (Mobile: Brand + Signal | Desktop: Brand) */}
        <div className="flex items-center justify-between gap-2 w-full sm:w-auto min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-extrabold tracking-tight text-white text-base sm:text-lg whitespace-nowrap">
              Deriv Alchemist
            </span>
            <span className="hidden md:inline-block px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-400 font-semibold whitespace-nowrap">
              PRO SMC BOT
            </span>
          </div>

          {/* Mobile Signal Strength Indicator on Row 1 */}
          <div className="sm:hidden shrink-0">
            <SignalStrengthIndicator
              signal={currentSignal}
              onSimulateGlitch={onSimulateGlitch}
              onReconnect={onReconnect}
              countdownSeconds={countdownSeconds}
              isGlitch={isGlitch}
            />
          </div>
        </div>

        {/* Bottom Row on Mobile / Right Side Controls on Desktop */}
        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto min-w-0">
          {/* Desktop Signal Strength Indicator */}
          <div className="hidden sm:block shrink-0">
            <SignalStrengthIndicator
              signal={currentSignal}
              onSimulateGlitch={onSimulateGlitch}
              onReconnect={onReconnect}
              countdownSeconds={countdownSeconds}
              isGlitch={isGlitch}
            />
          </div>

          {/* Account Switch & Balance + Logout */}
          {account && (
            <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto min-w-0">
              {account.accountList && account.accountList.length > 1 ? (
                <div className="flex-1 sm:flex-initial min-w-0 flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 overflow-hidden">
                  {account.accountList.map((acc: any) => {
                    const isSelected = acc.loginid === account.loginid;
                    const isDemo = Boolean(
                      acc.is_virtual ||
                      acc.account_type === 'demo' ||
                      acc.loginid?.startsWith('VRTC') ||
                      acc.loginid?.startsWith('DOT')
                    );
                    return (
                      <button
                        key={acc.loginid}
                        type="button"
                        onClick={() => onSwitchAccount?.(acc.loginid)}
                        className={`px-2 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-mono font-medium transition-all cursor-pointer flex items-center justify-center gap-1 sm:gap-2 min-w-0 ${
                          isSelected
                            ? isDemo
                              ? 'flex-1 sm:flex-initial bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                              : 'flex-1 sm:flex-initial bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                            : 'shrink-0 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={`Switch to ${isDemo ? 'Demo' : 'Real'} account`}
                      >
                        <span
                          className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${
                            isDemo ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                        />
                        <span className="font-semibold whitespace-nowrap">{isDemo ? 'Demo' : 'Real'}</span>
                        {isSelected && (
                          <span className="font-bold text-white pl-1.5 border-l border-zinc-700 whitespace-nowrap truncate">
                            ${formattedBalance} {account.currency}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 sm:flex-initial min-w-0 flex items-center justify-between sm:justify-start gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-mono">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        account.isVirtual ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                    />
                    <span
                      className={`font-semibold whitespace-nowrap ${
                        account.isVirtual ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {account.isVirtual ? 'Demo' : 'Real'}
                    </span>
                    <span className="text-zinc-400 hidden md:inline whitespace-nowrap">({account.loginid})</span>
                  </div>
                  <span className="font-bold text-white pl-1.5 border-l border-zinc-700 whitespace-nowrap truncate">
                    ${formattedBalance} {account.currency}
                  </span>
                </div>
              )}

              {/* Disconnect / Logout Button */}
              <button
                id="header-disconnect-btn"
                onClick={onDisconnect}
                title="Logout / Disconnect"
                className="px-2.5 py-1.5 sm:p-2 rounded-lg bg-zinc-900 hover:bg-rose-950/40 border border-zinc-800 hover:border-rose-900/60 text-zinc-300 hover:text-rose-400 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 text-[11px] font-medium"
                aria-label="Logout"
              >
                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="sm:hidden">Logout</span>
              </button>
            </div>
          )}

          {/* Log In / Connect API Button when not authenticated */}
          {!account && (
            <button
              id="header-open-login-btn"
              type="button"
              onClick={onOpenLogin}
              className="w-full sm:w-auto justify-center px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#ff444f] to-[#e03a44] hover:from-[#ff555f] hover:to-[#ef454f] text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-[#ff444f]/20 flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>Connect API Token</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
