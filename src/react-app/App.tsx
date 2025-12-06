

import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import SignalList from './components/SignalList';
import ChartPanel from './components/ChartPanel';
import DetailPanel from './components/DetailPanel';
import { RightPanel } from './components/RightPanel';
import { AnalysisModal } from './components/AnalysisModal';
import { NewsPopup } from './components/NewsPopup';
import { SimulationModal } from './components/SimulationModal';
import { BreakingNewsTicker } from './components/BreakingNewsTicker';
import { SystemUpdateModal } from './components/SystemUpdateModal';
import { Signal, Preset, AgentLog, MarketType, WhaleAlert, WhaleSignal, DeepDiveModel, AnalysisStyle } from './types';
import { generateMockSignal } from './services/mockService';
import { AGENT_NAMES } from './constants';
import { LanguageProvider } from './contexts/LanguageContext';
import { SystemProvider, useSystem } from './contexts/SystemContext';
import { BinanceScanner } from './services/binanceScanner';
import { analyzeSignalWithPerplexity, PerplexityResponse } from './services/perplexityService';
import { fetchBatchStockQuotes, fetchSingleQuote } from './services/quoteService';
import { WATCH_LIST } from './components/StockPanel';
import { LayoutDashboard, BarChart2, Globe, List } from 'lucide-react';

// Initial Watchlist
const INITIAL_STOCKS = WATCH_LIST.map(symbol => ({
  symbol,
  market: (symbol.includes('.KS') ? 'KOSPI' : symbol.includes('.KQ') ? 'KOSDAQ' : 'NASDAQ') as MarketType
}));

const Dashboard: React.FC = () => {
  const { config } = useSystem();
  
  const [signals, setSignals] = useState<Signal[]>([]);
  const [whales, setWhales] = useState<WhaleAlert[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  
  // View State
  const [viewMode, setViewMode] = useState<'PC' | 'MOBILE'>('PC');
  const [mobileTab, setMobileTab] = useState<'SIGNALS' | 'CHART' | 'MARKET'>('CHART');

  // Analysis State
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PerplexityResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isSimulationOpen, setIsSimulationOpen] = useState(false);
  const [isSystemUpdateOpen, setIsSystemUpdateOpen] = useState(false);
  const [newsPopup, setNewsPopup] = useState<{ isOpen: boolean, symbol: string, market: MarketType }>({ isOpen: false, symbol: '', market: 'NASDAQ' });
  const [isNewsLoading, setIsNewsLoading] = useState(false);
  
  const scannerRef = useRef<BinanceScanner | null>(null);
  const hasSelectedInitialSignal = useRef(false);

  // 1. Initialize Stocks
  useEffect(() => {
    const initStocks = async () => {
        const stockSymbols = INITIAL_STOCKS.map(s => s.symbol);
        try {
            const quotes = await fetchBatchStockQuotes(stockSymbols);
            const stockSignals = INITIAL_STOCKS.map(stock => {
                const quote = quotes.find(q => q.symbol === stock.symbol);
                return generateMockSignal(stock.symbol, stock.market, quote?.price ?? 0, quote?.changePercent ?? 0);
            });
            
            setSignals(prev => {
                // 1. Keep Crypto Signals (managed by Binance Scanner)
                const crypto = prev.filter(s => s.market === 'CRYPTO');
                
                // 2. Keep User-Searched Signals (Items not in the default watchlist but exist in current state)
                const userSearched = prev.filter(s => 
                    s.market !== 'CRYPTO' && 
                    !INITIAL_STOCKS.some(init => init.symbol === s.symbol)
                );

                // 3. Merge: Crypto + Preserved Search + Fresh Watchlist Updates
                return [...crypto, ...userSearched, ...stockSignals];
            });

            if (!hasSelectedInitialSignal.current && stockSignals.length > 0) {
                setSelectedSignalId(stockSignals[0].id);
                hasSelectedInitialSignal.current = true;
            }
        } catch (e) { console.error(e); }
    };
    
    initStocks();
    const id = setInterval(initStocks, 10000); 
    return () => clearInterval(id);
  }, []);

  // 2. Initialize Binance Scanner
  useEffect(() => {
    const scanner = new BinanceScanner(
      (realSignal) => {
        setSignals(prev => {
          const idx = prev.findIndex(s => s.symbol === realSignal.symbol);
          if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { 
                  ...updated[idx], 
                  price: realSignal.price, 
                  change_rate: realSignal.change_rate,
                  volume: realSignal.volume,
                  score: realSignal.score
              };
              return updated;
          }
          return [realSignal, ...prev];
        });
      },
      (whale) => {
        const threshold = config.thresholds.whaleUsd;
        if (whale.value < threshold) return;
        
        const newAlert: WhaleAlert = {
            id: Math.random().toString(),
            timestamp: Date.now(),
            symbol: whale.symbol,
            market: 'CRYPTO',
            type: 'LARGE_ORDER',
            side: whale.side,
            amount_usd: whale.value,
            description: whale.description
        };

        setWhales(prev => [newAlert, ...prev].slice(0, 50));
        setSignals(prev => prev.map(s => {
            if (s.symbol === whale.symbol) {
                const wSignal: WhaleSignal = {
                    type: 'LARGE_ORDER',
                    description: `Executed ${whale.side} $${Math.floor(whale.value).toLocaleString()}`,
                    intensity: Math.min(whale.value / 1000000, 1)
                };
                return {
                    ...s,
                    whale_signals: [wSignal, ...s.whale_signals].slice(0, 20)
                };
            }
            return s;
        }));
      }
    );
    scanner.start();
    scannerRef.current = scanner;
    return () => scanner.stop();
  }, [config.thresholds.whaleUsd]); 

  // Auto-detect Mobile Screen
  useEffect(() => {
    const checkMobile = () => {
        if (window.innerWidth < 768) {
            setViewMode('MOBILE');
        } else {
            setViewMode('PC');
        }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleSearch = async (query: string) => {
      const qUpper = query.toUpperCase();
      
      const existing = signals.find(s => s.symbol.toUpperCase() === qUpper || s.id.toUpperCase() === qUpper);
      if (existing) {
          setSelectedSignalId(existing.id);
          if (viewMode === 'MOBILE') setMobileTab('CHART');
          return;
      }

      try {
          const quote = await fetchSingleQuote(query);
          if (quote) {
              let market: MarketType = 'NASDAQ';
              if (quote.symbol.includes('USDT')) market = 'CRYPTO';
              else if (quote.symbol.endsWith('.KS')) market = 'KOSPI';
              else if (quote.symbol.endsWith('.KQ')) market = 'KOSDAQ';
              else if (!quote.symbol.includes('.')) market = 'NASDAQ';
              else market = 'NYSE';
              
              const newSignal = generateMockSignal(quote.symbol, market, quote.price, quote.changePercent);
              setSignals(prev => [newSignal, ...prev]);
              setSelectedSignalId(newSignal.id);
              if (viewMode === 'MOBILE') setMobileTab('CHART');
          } else {
              const fallbackSignal = generateMockSignal(qUpper, 'NYSE', 0, 0); 
              fallbackSignal.reasons = ["Added via Global Search", "Price data unavailable"];
              setSignals(prev => [fallbackSignal, ...prev]);
              setSelectedSignalId(fallbackSignal.id);
              if (viewMode === 'MOBILE') setMobileTab('CHART');
          }
      } catch (e) {
          console.error("Search error", e);
      }
  };

  const handleRunAnalysis = async (model: DeepDiveModel, style: AnalysisStyle) => {
      if (!selectedSignal) return;
      setIsAnalyzing(true);
      setAnalysisError(null);
      setIsAnalysisOpen(true); 

      try {
          const result = await analyzeSignalWithPerplexity(selectedSignal, model, style);
          setAnalysisResult(result);
      } catch (e) {
          setAnalysisError("AI 분석 엔진 연결 실패. 잠시 후 다시 시도해주세요.");
      } finally {
          setIsAnalyzing(false);
      }
  };

  const selectedSignal = signals.find(s => s.id === selectedSignalId) || null;

  const filteredSignals = signals.filter(s => {
    if (s.id === selectedSignalId) return true;
    if (activeFilter === 'CRYPTO' && s.market !== 'CRYPTO') return false;
    if (activeFilter === 'KR' && !s.market.includes('KOS')) return false;
    if (activeFilter === 'GLOBAL' && (s.market === 'CRYPTO' || s.market.includes('KOS'))) return false;
    if (activeFilter === 'WHALE' && s.whale_signals.length === 0) return false;
    return true;
  });

  return (
    <div className={`flex flex-col h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden select-none transition-colors duration-1000 ${
        config.theme.primary === 'orange' ? 'theme-war' : config.theme.primary === 'purple' ? 'theme-whale' : ''
    }`}>
      <style>{`
        .theme-war .border-cyan-500 { border-color: #ef4444 !important; }
        .theme-war .text-cyan-400 { color: #f87171 !important; }
        .theme-war .bg-cyan-600 { background-color: #dc2626 !important; }
        .theme-whale .border-cyan-500 { border-color: #a855f7 !important; }
        .theme-whale .text-cyan-400 { color: #c084fc !important; }
        .theme-whale .bg-cyan-600 { background-color: #9333ea !important; }
      `}</style>

      <Header 
        activePreset={activePreset} 
        onSelectPreset={setActivePreset} 
        logs={logs}
        activeFilter={activeFilter}
        onSelectFilter={setActiveFilter}
        onSearch={handleSearch}
        onOpenSystemUpdate={() => setIsSystemUpdateOpen(true)}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(prev => prev === 'PC' ? 'MOBILE' : 'PC')}
      />
      
      {viewMode === 'PC' ? (
        // --- PC LAYOUT (3-Column) ---
        <div className="flex-1 flex overflow-hidden">
            <div className={`${isSidebarCollapsed ? 'w-12' : 'w-72'} flex-shrink-0 flex flex-col z-20 border-r border-slate-800 transition-all duration-300`}>
                <SignalList 
                    signals={filteredSignals} 
                    selectedSignalId={selectedSignalId} 
                    onSelectSignal={(s) => setSelectedSignalId(s.id)}
                    isCollapsed={isSidebarCollapsed}
                    onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                />
            </div>

            <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative">
            <div className="flex-1 min-h-0 border-b border-slate-800 relative flex flex-col">
                <ChartPanel signal={selectedSignal} />
            </div>
            <div className="h-[320px] flex-shrink-0 relative z-10 bg-[#050914]">
                <DetailPanel 
                    signal={selectedSignal} 
                    onOpenAnalysis={handleRunAnalysis}
                    onRefreshNews={() => {}}
                    isNewsLoading={isNewsLoading}
                    onOpenDailyBriefing={() => setNewsPopup({isOpen:true, symbol: selectedSignal?.symbol||'', market: selectedSignal?.market||'NASDAQ'})}
                    onOpenSimulation={() => setIsSimulationOpen(true)}
                />
            </div>
            </div>

            <RightPanel 
                isCollapsed={isRightPanelCollapsed} 
                onToggle={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
                activeFilter={activeFilter}
                signals={signals}
                whales={whales}
            />
        </div>
      ) : (
        // --- MOBILE LAYOUT (Stacked with Bottom Nav) ---
        <div className="flex-1 flex flex-col overflow-hidden relative">
            <div className="flex-1 relative overflow-hidden flex flex-col">
                {mobileTab === 'SIGNALS' && (
                    <div className="w-full h-full">
                        <SignalList 
                            signals={filteredSignals} 
                            selectedSignalId={selectedSignalId} 
                            onSelectSignal={(s) => {
                                setSelectedSignalId(s.id);
                                setMobileTab('CHART');
                            }}
                            isCollapsed={false}
                            onToggle={() => {}}
                        />
                    </div>
                )}

                {mobileTab === 'CHART' && (
                    <div className="flex flex-col h-full">
                        <div className="h-[40%] border-b border-slate-800 relative">
                             <ChartPanel signal={selectedSignal} />
                        </div>
                        <div className="flex-1 relative overflow-hidden">
                             <DetailPanel 
                                signal={selectedSignal} 
                                onOpenAnalysis={handleRunAnalysis}
                                onRefreshNews={() => {}}
                                isNewsLoading={isNewsLoading}
                                onOpenDailyBriefing={() => setNewsPopup({isOpen:true, symbol: selectedSignal?.symbol||'', market: selectedSignal?.market||'NASDAQ'})}
                                onOpenSimulation={() => setIsSimulationOpen(true)}
                            />
                        </div>
                    </div>
                )}

                {mobileTab === 'MARKET' && (
                     <div className="w-full h-full">
                        <RightPanel 
                            isCollapsed={false} 
                            onToggle={() => {}}
                            activeFilter={activeFilter}
                            signals={signals}
                            whales={whales}
                        />
                        {/* Force RightPanel to be full width via inline styles override if needed, 
                            but RightPanel has w-80 class. We might need to override it or assume 
                            it fills container flex-col. The RightPanel component uses fixed width classes.
                            Let's rely on container constraints or we might need to adjust RightPanel props. 
                            Actually, RightPanel has `w-80 lg:w-96` which is fixed. 
                            Ideally we pass a prop `isMobile` to RightPanel to make it `w-full`.
                            For now, since we didn't update RightPanel props, it will be 320px width.
                            Mobile screens are usually > 320px so it fits, or we center it.
                        */}
                     </div>
                )}
            </div>

            {/* Mobile Bottom Navigation */}
            <div className="h-16 bg-slate-900 border-t border-slate-800 flex items-center justify-around shrink-0 px-2 pb-safe">
                <button 
                    onClick={() => setMobileTab('SIGNALS')}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${mobileTab === 'SIGNALS' ? 'text-cyan-400' : 'text-slate-500'}`}
                >
                    <List size={20} />
                    <span className="text-[10px] font-bold">SIGNALS</span>
                </button>
                <button 
                    onClick={() => setMobileTab('CHART')}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${mobileTab === 'CHART' ? 'text-cyan-400' : 'text-slate-500'}`}
                >
                    <BarChart2 size={20} />
                    <span className="text-[10px] font-bold">CHART</span>
                </button>
                <button 
                    onClick={() => setMobileTab('MARKET')}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${mobileTab === 'MARKET' ? 'text-cyan-400' : 'text-slate-500'}`}
                >
                    <Globe size={20} />
                    <span className="text-[10px] font-bold">MARKET</span>
                </button>
            </div>
        </div>
      )}

      <AnalysisModal isOpen={isAnalysisOpen} onClose={() => setIsAnalysisOpen(false)} isLoading={isAnalyzing} error={analysisError} data={analysisResult} symbol={selectedSignal?.symbol || ''} />
      <SimulationModal isOpen={isSimulationOpen} onClose={() => setIsSimulationOpen(false)} signal={selectedSignal} />
      <SystemUpdateModal isOpen={isSystemUpdateOpen} onClose={() => setIsSystemUpdateOpen(false)} />
      <NewsPopup isOpen={newsPopup.isOpen} onClose={() => setNewsPopup(p => ({...p, isOpen:false}))} symbol={newsPopup.symbol} market={newsPopup.market} />
      {config.layout.showBreakingTicker && <BreakingNewsTicker />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <SystemProvider>
        <Dashboard />
      </SystemProvider>
    </LanguageProvider>
  );
}

export default App;
