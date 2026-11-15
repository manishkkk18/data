import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CrossCheck } from "../data";
import { COLOR_A, COLOR_B } from "./chartColors";

type Row = { year: number; ours: number | null; bhuvan: number | null };

export default function CrossCheckChart({ data, state }: { data: CrossCheck; state: string }) {
  const s = data.states.find((x) => x.state === state);

  const rows = useMemo(() => {
    if (!s) return [];
    const base = String(data.base_year);
    const oursBase = s.ours[base];
    const bhuvanBase = s.bhuvan[base];
    const years = [...new Set([...Object.keys(s.ours), ...Object.keys(s.bhuvan)].map(Number))].sort((a, b) => a - b);
    const first = years[0];
    const last = years[years.length - 1];
    const out: Row[] = [];
    for (let y = first; y <= last; y++) {
      const o = s.ours[String(y)];
      const b = s.bhuvan[String(y)];
      out.push({
        year: y,
        ours: o != null && oursBase ? (o / oursBase) * 100 : null,
        bhuvan: b != null && bhuvanBase ? (b / bhuvanBase) * 100 : null,
      });
    }
    return out;
  }, [s, data.base_year]);

  if (!s || rows.length === 0) return null;
  const dotFor = (key: "ours" | "bhuvan", color: string) => (p: { cx?: number; cy?: number; index?: number }) => {
    const k = p.index ?? -1;
    const isolated = rows[k]?.[key] != null && rows[k - 1]?.[key] == null && rows[k + 1]?.[key] == null;
    return isolated && p.cx != null && p.cy != null ? (
      <circle key={`${key}${k}`} cx={p.cx} cy={p.cy} r={3.5} fill={color} stroke="#121829" strokeWidth={1.5} />
    ) : (
      <g key={`${key}${k}`} />
    );
  };
  const lastYear = rows[rows.length - 1].year;

  return (
    <figure className="trend" aria-label={`${state}: night-light trend indexed to ${data.base_year} = 100, our data versus ISRO Bhuvan`}>
      <figcaption className="trend-head">
        <span className="trend-title">{state}</span>
        <span className="trend-legend">
          <span><i style={{ background: COLOR_A }} aria-hidden="true" /> Our data</span>
          <span><i style={{ background: COLOR_B }} aria-hidden="true" /> ISRO Bhuvan</span>
        </span>
      </figcaption>
      <div className="trend-plot tall">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="#232B40" />
            {/* Shade Bhuvan's Collection 2 years so the jump there isn't read as real growth. */}
            <ReferenceArea
              x1={data.break_year - 0.5}
              x2={lastYear + 0.5}
              fill="#9AA3B8"
              fillOpacity={0.08}
              label={{ value: "Bhuvan C2", position: "insideTop", fill: "#9AA3B8", fontSize: 10 }}
            />
            <ReferenceLine y={100} stroke="#3A4560" strokeDasharray="3 3" />
            <XAxis
              dataKey="year"
              type="number"
              domain={[rows[0].year - 0.5, lastYear + 0.5]}
              ticks={rows.map((r) => r.year).filter((y) => y % 2 === 0 || y === data.base_year)}
              tick={{ fill: "#9AA3B8", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#232B40" }}
            />
            <YAxis tick={{ fill: "#9AA3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: "#9AA3B8", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="trend-tip">
                    <strong>{r.year}</strong>
                    <span>Our data: {r.ours != null ? <b>{r.ours.toFixed(0)}</b> : "–"}</span>
                    <span>Bhuvan: {r.bhuvan != null ? <b>{r.bhuvan.toFixed(0)}</b> : "–"}</span>
                    {r.ours != null && <span className="muted">our source: {data.ours_source[String(r.year)]}</span>}
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey="bhuvan" stroke={COLOR_B} strokeWidth={2} connectNulls={false} dot={dotFor("bhuvan", COLOR_B)} isAnimationActive={false} />
            <Line type="linear" dataKey="ours" stroke={COLOR_A} strokeWidth={2} connectNulls={false} dot={dotFor("ours", COLOR_A)} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-note muted">Index, {data.base_year} = 100 · breaks are years we haven't processed yet</p>
    </figure>
  );
}
