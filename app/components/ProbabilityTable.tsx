"use client";

import type { EnrichedEvent } from "@/lib/mockData";
import { useState } from "react";
import clsx from "clsx";
import { ClientTime } from "./ClientDate";
import { captureParameterChanged } from "@/lib/analytics";

interface Props {
  events: EnrichedEvent[];
}

type SortKey = "event" | "sbProb" | "marketProb" | "diff";

function ProbBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-[#21262d] rounded-full h-1.5 mt-1">
      <div
        className="h-1.5 rounded-full bg-[#58a6ff]"
        style={{ width: `${Math.min(value * 100, 100)}%` }}
      />
    </div>
  );
}

function DiffBadge({ diff }: { diff: number }) {
  const pct = (diff * 100).toFixed(2);
  const abs = Math.abs(diff);
  const isAlert = abs > 0.05;
  const isPos = diff >= 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-xs font-semibold",
        isAlert
          ? "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30"
          : isPos
          ? "bg-green-500/10 text-green-400"
          : "bg-red-500/10 text-red-400"
      )}
    >
      {isAlert && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {isPos ? "+" : ""}{pct} pp
    </span>
  );
}

export default function ProbabilityTable({ events }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("diff");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
    captureParameterChanged({ parameter_name: "sort_column", parameter_value: key, simulator_version: "1.0.0" });
  }

  const sorted = [...events].sort((a, b) => {
    const av = sortKey === "event" ? a.event : a[sortKey];
    const bv = sortKey === "event" ? b.event : b[sortKey];
    if (typeof av === "string") return sortDir * av.localeCompare(bv as string);
    return sortDir * ((av as number) - (bv as number));
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-gray-600 ml-1">⇅</span>;
    return <span className="text-[#58a6ff] ml-1">{sortDir === -1 ? "↓" : "↑"}</span>;
  }

  const th =
    "px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-300 transition-colors";

  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden" data-analytics="probability-table">
      <div className="px-4 py-3 border-b border-[#21262d] flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-sm font-semibold text-gray-300">Live Probability Comparison</span>
        <span className="ml-auto text-xs text-gray-500 font-mono">
          Updated: <ClientTime />
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[#21262d]/30">
            <tr>
              <th className={th} onClick={() => handleSort("event")}>
                Event <SortIcon col="event" />
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Sport / League
              </th>
              <th className={th} onClick={() => handleSort("sbProb")}>
                Sportsbook Prob <SortIcon col="sbProb" />
              </th>
              <th className={th} onClick={() => handleSort("marketProb")}>
                Market Prob <SortIcon col="marketProb" />
              </th>
              <th className={th} onClick={() => handleSort("diff")}>
                Difference <SortIcon col="diff" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Kickoff
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#21262d]">
            {sorted.map((ev) => (
              <tr
                key={ev.id}
                className={clsx(
                  "transition-colors hover:bg-[#1c2128]",
                  ev.alert && "bg-yellow-500/5"
                )}
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-sm text-white">{ev.event}</div>
                </td>
                <td className="px-3 py-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-gray-400">
                    {ev.sport}
                  </span>
                  <span className="ml-1 text-xs text-gray-600 font-mono">{ev.league}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-sm text-[#58a6ff] font-semibold">
                    {(ev.sbProb * 100).toFixed(1)}%
                  </span>
                  <ProbBar value={ev.sbProb} />
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-sm text-[#bc8cff] font-semibold">
                    {(ev.marketProb * 100).toFixed(1)}%
                  </span>
                  <ProbBar value={ev.marketProb} />
                </td>
                <td className="px-4 py-3">
                  <DiffBadge diff={ev.diff} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 font-mono">{ev.kickoff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
