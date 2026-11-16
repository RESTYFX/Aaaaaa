import React, { useState, useEffect } from 'react';
import { RefreshCw, Eye, EyeOff, Trash2, KeyRound, Check, AlertCircle } from 'lucide-react';
import { ConnectionState } from '../types';

interface SavedTokenItem {
  token: string;
  savedAt: number;
}

interface LoginModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onConnect: (token: string, appId: string) => void;
  connectionState: ConnectionState;
  connectionError?: string;
  defaultAppId?: string;
  isFullScreen?: boolean;
  isRestoringSession?: boolean;
  onCancelRestore?: () => void;
}

const STORAGE_KEY = 'deriv_saved_api_tokens';

// Strict check for valid Deriv API token or Personal Access Token format
export const isPlausibleDerivToken = (tok: string): boolean => {
  if (!tok || typeof tok !== 'string') return false;
  const t = tok.trim().replace(/^["']|["']$/g, '').trim();
  if (t.startsWith('DEMO')) return false;
  // Tokens are alphanumeric (may contain _ or -), 8 to 128 characters, with NO whitespace or punctuation
  if (t.length < 8 || t.length > 128) return false;
  if (/\s/.test(t)) return false;
  return /^[a-zA-Z0-9_\-]+$/.test(t);
};

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen = true,
  onClose,
  onConnect,
  connectionState,
  connectionError,
  defaultAppId = '33IM5dIMuFaBupAhk042L',
  isFullScreen = false,
  isRestoringSession = false,
  onCancelRestore,
}) => {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saveTokenChecked, setSaveTokenChecked] = useState(true);
  const [savedTokens, setSavedTokens] = useState<SavedTokenItem[]>([]);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // Load saved tokens on mount and clean out any invalid text (such as accidental pasted sentences)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Strictly filter only plausible Deriv API tokens (alphanumeric, no spaces, 8-128 chars)
          const valid = parsed.filter(
            (item: any) =>
              item &&
              typeof item.token === 'string' &&
              isPlausibleDerivToken(item.token)
          );
          setSavedTokens(valid);
          // Persist the cleaned list so corrupt entries are permanently removed
          localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
          if (valid.length > 0) {
            setToken(valid[0].token);
          } else {
            setToken('');
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load saved tokens:', e);
    }
  }, []);

  if (!isOpen && !isFullScreen) return null;

  // Only consider connecting when explicitly authorizing credentials or restoring session
  const isConnecting = connectionState === 'authorizing' || isRestoringSession;
  const trimmedToken = token.trim().replace(/^["']|["']$/g, '').trim();

  const maskToken = (t: string) => {
    if (t.length <= 10) return t;
    const prefix = t.slice(0, 4);
    const suffix = t.slice(-6);
    return `${prefix}••••••••${suffix}`;
  };

  const handleSelectSaved = (savedToken: string) => {
    setFormatError(null);
    setDismissedError(null);
    setToken(savedToken);
  };

  const handleDeleteSaved = (e: React.MouseEvent, tokenToDelete: string) => {
    e.stopPropagation();
    const updated = savedTokens.filter((item) => item.token !== tokenToDelete);
    setSavedTokens(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn('Failed to delete saved token from storage:', err);
    }
    if (token === tokenToDelete) {
      setToken('');
    }
  };

  const handleClearCurrentAndSaved = () => {
    if (trimmedToken) {
      const updated = savedTokens.filter((item) => item.token !== trimmedToken);
      setSavedTokens(updated);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    }
    setToken('');
    setFormatError(null);
    if (connectionError) {
      setDismissedError(connectionError);
    }
  };

  const handleClearAllSaved = () => {
    setSavedTokens([]);
    setToken('');
    setFormatError(null);
    if (connectionError) {
      setDismissedError(connectionError);
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormatError(null);
    setDismissedError(null);
    if (!trimmedToken) return;

    if (!isPlausibleDerivToken(trimmedToken)) {
      setFormatError(
        'Invalid API token format. Deriv tokens contain letters and numbers without spaces. Please check your token or click "Use Free Demo Account" below.'
      );
      return;
    }

    // If user checked "Save", save this token to localStorage
    if (saveTokenChecked) {
      const exists = savedTokens.some((item) => item.token === trimmedToken);
      let updated: SavedTokenItem[];
      if (exists) {
        // Move to top
        updated = [
          { token: trimmedToken, savedAt: Date.now() },
          ...savedTokens.filter((item) => item.token !== trimmedToken),
        ];
      } else {
        updated = [{ token: trimmedToken, savedAt: Date.now() }, ...savedTokens];
      }
      setSavedTokens(updated);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('Failed to persist saved token:', err);
      }
    }

    const isPat = trimmedToken.startsWith('pat_');
    const resolvedApp = isPat ? '33IM5dIMuFaBupAhk042L' : (defaultAppId || '1089');
    onConnect(trimmedToken, resolvedApp);
  };

  const content = (
    <div
      id="login-container"
      className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 sm:p-8 space-y-6"
    >
      {/* Welcome Heading */}
      <div className="text-center relative">
        {onClose && !isFullScreen && (
          <button
            id="close-login-btn"
            type="button"
            onClick={onClose}
            className="absolute right-0 top-0 p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        )}
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Welcome to Deriv Alchemist
        </h1>
      </div>

      {/* Restoring Session Notice (Non-blocking with instant cancel) */}
      {isRestoringSession && (
        <div className="p-3 rounded-xl bg-[#ff444f]/10 border border-[#ff444f]/30 flex items-center justify-between text-xs text-zinc-200">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-[#ff444f] animate-spin shrink-0" />
            <span className="font-medium">Auto-restoring previous session...</span>
          </div>
          {onCancelRestore && (
            <button
              type="button"
              onClick={onCancelRestore}
              className="text-[11px] text-zinc-400 hover:text-white underline font-semibold cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Saved API Keys (if any) */}
      {savedTokens.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">
              Saved API Keys ({savedTokens.length})
            </span>
            <span className="text-[11px] text-zinc-500">Click to select</span>
          </div>

          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {savedTokens.map((item) => {
              const isSelected = token === item.token;
              return (
                <div
                  key={item.token}
                  onClick={() => handleSelectSaved(item.token)}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl border text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-purple-950/30 border-purple-500/50 text-white ring-1 ring-purple-500/30'
                      : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-mono truncate">
                    <KeyRound className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-purple-400' : 'text-zinc-500'}`} />
                    <span className="truncate">{maskToken(item.token)}</span>
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[10px] text-purple-400 font-sans font-medium">
                        <Check className="w-3 h-3" /> Selected
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    title="Delete this saved API key"
                    onClick={(e) => handleDeleteSaved(e, item.token)}
                    className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-md transition-colors cursor-pointer ml-2 flex-shrink-0"
                    aria-label="Delete saved key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Form with API login token input, Save Checkbox and Connect & Fetch button */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="api-login-token-input"
            className="block text-xs font-semibold text-zinc-300"
          >
            API login token
          </label>
          <div className="relative">
            <input
              id="api-login-token-input"
              type={showToken ? 'text' : 'password'}
              required
              autoFocus
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setFormatError(null);
                if (connectionError) {
                  setDismissedError(connectionError);
                }
              }}
              placeholder="Enter your API login token"
              disabled={isConnecting}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 pr-10 text-sm font-mono text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#ff444f]/60"
            />
            <button
              id="toggle-show-token-btn"
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Validation Notice for token format */}
          {formatError && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{formatError}</span>
            </div>
          )}
        </div>

        {/* Save API Token Checkbox */}
        <div className="flex items-center gap-2 pt-0.5">
          <input
            id="save-token-checkbox"
            type="checkbox"
            checked={saveTokenChecked}
            onChange={(e) => setSaveTokenChecked(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-[#ff444f] focus:ring-[#ff444f] focus:ring-offset-zinc-900 cursor-pointer accent-[#ff444f]"
          />
          <label
            htmlFor="save-token-checkbox"
            className="text-xs text-zinc-300 font-medium cursor-pointer select-none"
          >
            Save API key for next login
          </label>
        </div>

        {/* Optional Connection Error notice if Deriv returns authorization rejection */}
        {connectionError && connectionError !== dismissedError && (() => {
          const cleanText = connectionError
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const is502Gateway = /502|bad gateway|cloudflare|api\.derivws\.com/i.test(cleanText);

          return (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 text-center space-y-2.5">
              <div className="font-sans font-medium text-rose-200">
                {is502Gateway
                  ? 'Deriv Options API server (api.derivws.com) returned 502 Bad Gateway. Deriv servers are temporarily experiencing downtime.'
                  : cleanText}
              </div>
              {is502Gateway && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 font-sans">
                  Deriv&apos;s external options server is experiencing temporary downtime. You can continue testing and trading all features without interruption using Free Demo mode below.
                </div>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 font-sans">
                <button
                  type="button"
                  onClick={() => onConnect('DEMO', '1089')}
                  className="px-3.5 py-1.5 bg-rose-500/25 hover:bg-rose-500/35 text-white border border-rose-500/40 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-sm"
                >
                  Use Free Demo Account ($10,000 USD)
                </button>
                {trimmedToken && (
                  <button
                    type="button"
                    onClick={handleClearCurrentAndSaved}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    Clear Expired Key
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        <button
          id="connect-fetch-status-btn"
          type="submit"
          disabled={isConnecting || !trimmedToken}
          className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-[#ff444f] to-[#e03a44] hover:from-[#ff555f] hover:to-[#ef454f] text-white shadow-lg shadow-[#ff444f]/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isConnecting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Connecting &amp; Fetching User Status...</span>
            </>
          ) : (
            <span>Connect &amp; Fetch User Status</span>
          )}
        </button>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-zinc-800"></div>
          <span className="flex-shrink mx-3 text-xs text-zinc-500 uppercase font-medium">Or</span>
          <div className="flex-grow border-t border-zinc-800"></div>
        </div>

        <button
          id="connect-demo-account-btn"
          type="button"
          onClick={() => onConnect('DEMO', '1089')}
          className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:text-white hover:border-zinc-600 active:scale-[0.99]"
        >
          <span className="font-bold text-emerald-400">&bull;</span>
          <span>Use Free Demo Account ($10,000 USD Virtual)</span>
        </button>

        <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
          <div className="font-semibold text-zinc-300">How to get a Deriv API Token:</div>
          <div>1. Log into your account on <strong>Deriv.com</strong></div>
          <div>2. Go to <strong>Manage account &gt; API token</strong></div>
          <div>3. Check <strong>Read</strong> and <strong>Trade</strong> scopes, then click <strong>Create</strong></div>
        </div>
      </form>
    </div>
  );

  if (isFullScreen) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 text-zinc-100">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      {content}
    </div>
  );
};
