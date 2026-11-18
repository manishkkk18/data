import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtRad, monthLabel, type AppData } from "../data";
import { COLOR_A, COLOR_B } from "./chartColors";

type Row = { i: number; month: string; a: number | null; b: number | null };
type Props = { data: AppData; aId: string; bId: string; monthIndex: number; onPickMonth: (i: number) => void };

export default function CompareChart({ data, aId, bId, monthIndex, onPickMonth }: Props) {
  const m = data.monthly;
  const ca = data.index.get(aId)!;
  const cb = data.index.get(bId)!;
  const nameA = data.byId.get(aId)!.name;
  const nameB = data.byId.get(bId)!.name;

  const { rows, ticks } = useMemo(() => {
    const rows: Row[] = m.months.map((month, i) => ({ i, month, a: m.mean[i][ca], b: m.mean[i][cb] }));
    return { rows, ticks: rows.filter((r) => r.month.endsWith("-01")).map((r) => r.i) };
  }, [m, ca, cb]);

  // A month with gaps on both sides can't form a line segment, so it gets a dot.
  const dotFor = (key: "a" | "b", color: string) => (p: { cx?: number; cy?: number; index?: number }) => {
    const k = p.index ?? -1;
    const isolated = rows[k]?.[key] != null && rows[k - 1]?.[key] == null && rows[k + 1]?.[key] == null;
    return isolated && p.cx != null && p.cy != null ? (
      <circle key={`${key}${k}`} cx={p.cx} cy={p.cy} r={3.5} fill={color} stroke="#121829" strokeWidth={1.5} />
    ) : (
      <g key={`${key}${k}`} />
    );
  };

  return (
    <figure className="trend compare-chart" aria-label={`Monthly brightness of ${nameA} and ${nameB}. Click to show a month on the map.`}>
      <figcaption className="trend-head">
        <span className="trend-title">Brightness over time</span>
        <span className="trend-legend">
          <span><i style={{ background: COLOR_A }} aria-hidden="true" /> {nameA}</span>
          <span><i style={{ background: COLOR_B }} aria-hidden="true" /> {nameB}</span>
        </span>
      </figcaption>
      <div className="trend-plot tall">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
            onClick={(s) => {
              const i = Number(s?.activeTooltipIndex);
              if (Number.isInteger(i)) onPickMonth(i);
            }}
            style={{ cursor: "pointer" }}
          >
            <CartesianGrid vertical={false} stroke="#232B40" />
            <XAxis
              dataKey="i"
              type="number"
              domain={[0, rows.length - 1]}
              ticks={ticks}
              tickFormatter={(i: number) => rows[i]?.month.slice(0, 4) ?? ""}
              tick={{ fill: "#9AA3B8", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#232B40" }}
              minTickGap={8}
            />
            <YAxis tick={{ fill: "#9AA3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => String(Number(v.toFixed(1)))} />
            <Tooltip
              cursor={{ stroke: "#9AA3B8", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="trend-tip">
                    <strong>{monthLabel(r.month)}</strong>
                    <span>{nameA}: {r.a != null ? <b>{fmtRad(r.a)}</b> : "gap"}</span>
                    <span>{nameB}: {r.b != null ? <b>{fmtRad(r.b)}</b> : "gap"}</span>
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey="a" stroke={COLOR_A} strokeWidth={2} connectNulls={false} dot={dotFor("a", COLOR_A)} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="linear" dataKey="b" stroke={COLOR_B} strokeWidth={2} connectNulls={false} dot={dotFor("b", COLOR_B)} activeDot={{ r: 4 }} isAnimationActive={false} />
            <ReferenceLine x={monthIndex} stroke="#6EA8FF" strokeDasharray="4 3" strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-note muted">nW/cm²/sr · breaks are cloudy or not-yet-loaded months · click to jump to a month</p>
    </figure>
  );
}
