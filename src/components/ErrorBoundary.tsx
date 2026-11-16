import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetAndClear = () => {
    try {
      localStorage.removeItem('deriv_active_session');
      localStorage.removeItem('deriv_martingale_recovery_state');
      localStorage.removeItem('deriv_active_trade');
      localStorage.removeItem('deriv_glitch_reload_state');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const rawErrorMsg = this.state.error?.message || 'An unexpected application error occurred.';
      const cleanErrorMsg = rawErrorMsg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const is502 = /502|bad gateway|cloudflare|api\.derivws\.com/i.test(cleanErrorMsg);

      return (
        <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white tracking-tight">
                {is502 ? 'Deriv Gateway Temporarily Unavailable' : 'Something went wrong'}
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {is502
                  ? 'Deriv remote services (api.derivws.com) returned a 502 Bad Gateway error. The trading app can automatically recover or switch to Demo mode.'
                  : cleanErrorMsg}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-[#ff444f] to-[#e03a44] hover:from-[#ff555f] hover:to-[#ef454f] text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload App</span>
              </button>

              <button
                type="button"
                onClick={this.handleResetAndClear}
                className="w-full sm:w-auto px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Session &amp; Demo</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
