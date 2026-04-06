"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { TimePoint, SportEvent } from "@/lib/mockData";
import { useState } from "react";
import { captureParameterChanged } from "@/lib/analytics";

interface Props {
  data: TimePoint[];
  events: SportEvent[];
  eventColors: Record<string, string>;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1c2128] border border-[#30363d] rounded-lg p-3 text-xs shadow-xl min-w-[190px]">
      <p className="font-mono text-gray-400 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-3 font-mono">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className={Number(p.value) >= 0 ? "text-[#3fb950]" : "text-[#f85149]"}>
            {Number(p.value) >= 0 ? "+" : ""}{(Number(p.value) * 100).toFixed(2)} pp
          </span>
        </div>
      ))}
    </div>
  );
};

export default function DivergenceTimeSeries({ data, events, eventColors }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      const willShow = next.has(id);
      willShow ? next.delete(id) : next.add(id);
      captureParameterChanged({ parameter_name: "chart_line_toggle", parameter_value: `${id}:${willShow ? "show" : "hide"}`, simulator_version: "1.0.0" });
      return next;
    });
  }

  const tickInterval = Math.floor(data.length / 6);

  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#21262d]">
        <span className="text-sm font-semibold text-gray-300">Divergence Over Time (24h)</span>
        <p className="text-xs text-gray-500 mt-0.5">
          Hourly snapshot — market prob minus sportsbook implied probability
        </p>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pt-3">
        {events.map((ev) => (
          <button
            key={ev.id}
            onClick={() => toggle(ev.id)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-opacity hover:bg-[#21262d]"
            style={{ opacity: hidden.has(ev.id) ? 0.3 : 1 }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: eventColors[ev.id] }}
            />
            <span className="text-gray-400">{ev.event.split(" vs ")[0]}</span>
          </button>
        ))}
      </div>

      <div className="p-4">
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis
              dataKey="time"
              tick={{ fill: "#8b949e", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#21262d" }}
              interval={tickInterval}
            />
            <YAxis
              tickFormatter={(v) =>
                `${v >= 0 ? "+" : ""}${(Number(v) * 100).toFixed(1)}`
              }
              tick={{ fill: "#8b949e", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              unit=" pp"
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#30363d" strokeWidth={1.5} />
            <ReferenceLine y={0.05} stroke="#d29922" strokeDasharray="4 4" strokeWidth={1} />
            <ReferenceLine y={-0.05} stroke="#d29922" strokeDasharray="4 4" strokeWidth={1} />

            {events.map((ev) => (
              <Line
                key={ev.id}
                type="monotone"
                dataKey={ev.id}
                stroke={eventColors[ev.id]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
                hide={hidden.has(ev.id)}
                name={ev.event.split(" vs ")[0]}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
