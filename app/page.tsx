export const dynamic = "force-dynamic";

import { enrichEvents, TIME_SERIES, EVENTS, EVENT_COLORS } from "@/lib/mockData";
import AlertBanner from "./components/AlertBanner";
import StatsBar from "./components/StatsBar";
import ProbabilityTable from "./components/ProbabilityTable";
import ChartsWrapper from "./components/ChartsWrapper";
import { ClientDate } from "./components/ClientDate";
import AnalyticsEvents from "./components/AnalyticsEvents";

export default function Dashboard() {
  const events = enrichEvents();
  const alerts = events.filter((e) => e.alert);

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="border-b border-[#21262d] bg-[#0d1117]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-none">ProbEdge</h1>
              <p className="text-[10px] text-gray-500 leading-none mt-0.5">Sportsbook vs Markets</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Data:</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#161b22] border border-[#21262d] text-gray-400 font-mono">
              Mock — Simulated
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {alerts.length > 0 && (
              <div className="flex items-center gap-1.5 text-yellow-400">
                <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-xs font-semibold">{alerts.length} Alert{alerts.length > 1 ? "s" : ""}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </div>
            <ClientDate className="text-xs text-gray-600 font-mono hidden sm:block" />
          </div>
        </div>
      </header>

      <AnalyticsEvents />
      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        <AlertBanner alerts={alerts} />
        <StatsBar events={events} />
        <ProbabilityTable events={events} />
        <ChartsWrapper
          events={events}
          timeSeries={TIME_SERIES}
          allEvents={EVENTS}
          eventColors={EVENT_COLORS}
        />

        <footer className="text-center text-xs text-gray-600 py-2">
          ProbEdge · Simulated data only · Not financial advice
        </footer>
      </main>
    </div>
  );
}
