import React, { useState, useMemo } from 'react';
import { ChevronDown, Search, Activity, Zap, Check, Flame } from 'lucide-react';
import { VOLATILITY_MARKETS, MarketDefinition } from '../data/markets';

interface MarketSelectorProps {
  selectedSymbol: string;
  onSelectMarket: (market: MarketDefinition) => void;
  currentPrice?: number;
}

export const MarketSelector: React.FC<MarketSelectorProps> = ({
  selectedSymbol,
  onSelectMarket,
  currentPrice,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'standard' | '1s' | 'step' | 'jump'>('all');

  const selectedMarket = useMemo(() => {
    return VOLATILITY_MARKETS.find((m) => m.symbol === selectedSymbol) || VOLATILITY_MARKETS[4]; // Default Vol 100
  }, [selectedSymbol]);

  const filteredMarkets = useMemo(() => {
    return VOLATILITY_MARKETS.filter((m) => {
      const matchesCategory = activeCategory === 'all' || m.category === activeCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.symbol.toLowerCase().includes(q) ||
        m.shortName.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, activeCategory]);

  const handleSelect = (market: MarketDefinition) => {
    onSelectMarket(market);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative inline-block text-left">
      {/* Trigger Button */}
      <button
        id="market-selector-trigger"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 hover:border-zinc-600 transition-all text-white text-xs font-semibold shadow-sm cursor-pointer group"
      >
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-zinc-400 font-normal">Market:</span>
          <span className="text-amber-400 font-bold tracking-tight">{selectedMarket.shortName}</span>
        </div>

        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400 border border-zinc-700/50">
          {selectedMarket.symbol}
        </span>

        {currentPrice && (
          <span className="hidden sm:inline-block font-mono text-emerald-400 font-medium ml-1">
            ${currentPrice.toFixed(2)}
          </span>
        )}

        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover / Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop for closing */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div
            id="market-selector-dropdown"
            className="absolute left-0 mt-2 w-80 sm:w-96 rounded-xl bg-zinc-950 border border-zinc-800 shadow-2xl shadow-black/80 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Search and Category Header */}
            <div className="p-3 border-b border-zinc-800/80 bg-zinc-900/40">
              <div className="relative mb-2.5">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  id="market-search-input"
                  type="text"
                  placeholder="Search volatility indices (e.g. Vol 25, 100)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/70"
                />
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setActiveCategory('all')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-all ${
                    activeCategory === 'all'
                      ? 'bg-amber-500 text-black font-semibold'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  All ({VOLATILITY_MARKETS.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategory('standard')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-all ${
                    activeCategory === 'standard'
                      ? 'bg-amber-500 text-black font-semibold'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Activity className="w-3 h-3" />
                  <span>Standard</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategory('1s')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-all ${
                    activeCategory === '1s'
                      ? 'bg-amber-500 text-black font-semibold'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>1s VIX</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategory('step')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-all ${
                    activeCategory === 'step'
                      ? 'bg-cyan-500 text-black font-semibold'
                      : 'bg-zinc-900 text-cyan-400 hover:text-cyan-200'
                  }`}
                >
                  <span>Step Index</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCategory('jump')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-all ${
                    activeCategory === 'jump'
                      ? 'bg-purple-500 text-white font-semibold'
                      : 'bg-zinc-900 text-purple-400 hover:text-purple-200'
                  }`}
                >
                  <span>Jump Index</span>
                </button>
              </div>
            </div>

            {/* Popular Quick Pills */}
            <div className="px-3 py-2 border-b border-zinc-800/50 bg-zinc-900/20 flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1 mr-1">
                <Flame className="w-3 h-3 text-orange-400" /> Popular:
              </span>
              {['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ100V'].map((sym) => {
                const m = VOLATILITY_MARKETS.find((v) => v.symbol === sym);
                if (!m) return null;
                const isSelected = selectedSymbol === sym;
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => handleSelect(m)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50'
                    }`}
                  >
                    {m.shortName}
                  </button>
                );
              })}
            </div>

            {/* Market Items List */}
            <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/40 custom-scrollbar">
              {filteredMarkets.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500">No volatility markets match your search.</div>
              ) : (
                filteredMarkets.map((market) => {
                  const isSelected = market.symbol === selectedSymbol;
                  return (
                    <button
                      key={market.symbol}
                      type="button"
                      id={`market-option-${market.symbol}`}
                      onClick={() => handleSelect(market)}
                      className={`w-full flex items-center justify-between p-2.5 text-left transition-colors cursor-pointer ${
                        isSelected ? 'bg-amber-500/10 hover:bg-amber-500/15' : 'hover:bg-zinc-900/80'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                            market.category === '1s'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : market.category === 'step'
                              ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                              : market.category === 'jump'
                              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                              : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                          }`}
                        >
                          {market.category === 'step' ? 'STP' : `${market.volatility}%`}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-semibold truncate ${
                                isSelected ? 'text-amber-400' : 'text-zinc-200'
                              }`}
                            >
                              {market.name}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500">[{market.symbol}]</span>
                          </div>
                          <p className="text-[10px] text-zinc-400 truncate mt-0.5">{market.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                          {market.tickInterval}
                        </span>
                        {isSelected && <Check className="w-4 h-4 text-amber-400" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-2 bg-zinc-900/60 border-t border-zinc-800 text-[10px] text-zinc-400 flex items-center justify-between">
              <span>Timeframe: 1-Minute (1m) Candles</span>
              <span className="text-zinc-500 font-mono">Deriv Synthetic Indices</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
