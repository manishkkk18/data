import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtRad, type Diwali } from "../data";
import { COLOR_A, MARKER } from "./chartColors";

type Row = { o: number; date: string; v: number | null; status: "clear" | "cloudy" | "no file" };

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function DiwaliChart({ data, year, city }: { data: Diwali; year: number; city: string }) {
  const y = data.years.find((v) => v.year === year)!;
  const { rows, median } = useMemo(() => {
    const d0 = new Date(`${y.date}T00:00:00Z`).getTime();
    const rows: Row[] = [];
    for (let o = -data.window; o <= data.window; o++) {
      const date = new Date(d0 + o * 86400000).toISOString().slice(0, 10);
      const night = y.nights[String(o)];
      const v = night ? (night[city] ?? null) : null;
      rows.push({ o, date, v, status: !night ? "no file" : v == null ? "cloudy" : "clear" });
    }
    const base = data.baseline_offsets.map((o) => rows.find((r) => r.o === o)?.v).filter((v): v is number => v != null).sort((a, b) => a - b);
    const median = base.length ? (base.length % 2 ? base[(base.length - 1) / 2] : (base[base.length / 2 - 1] + base[base.length / 2]) / 2) : null;
    return { rows, median };
  }, [data, y, city]);

  const dot = (p: { cx?: number; cy?: number; index?: number }) => {
    const r = rows[p.index ?? -1];
    if (!r || r.v == null || p.cx == null || p.cy == null) return <g key={p.index} />;
    return <circle key={p.index} cx={p.cx} cy={p.cy} r={r.o === 0 ? 5 : 3} fill={COLOR_A} stroke="#121829" strokeWidth={1.5} />;
  };

  return (
    <figure className="trend" aria-label={`${city}: radiance each night around Diwali ${year}`}>
      <figcaption className="trend-head">
        <span className="trend-title">{city}, night by night</span>
        <span className="trend-legend">
          <span><i style={{ background: COLOR_A }} aria-hidden="true" /> Radiance</span>
          {median != null && <span><i className="dashed" aria-hidden="true" /> Normal-night median</span>}
        </span>
      </figcaption>
      <div className="trend-plot tall">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="#232B40" />
            {/* Nights left out of the baseline (lights go up early and stay up). */}
            <ReferenceArea x1={-2.5} x2={2.5} fill="#9AA3B8" fillOpacity={0.06} />
            <XAxis
              dataKey="o"
              type="number"
              domain={[-data.window - 0.5, data.window + 0.5]}
              ticks={[-7, -3, 0, 3, 7].filter((t) => Math.abs(t) <= data.window)}
              tickFormatter={(o: number) => (o === 0 ? "Diwali" : `${o > 0 ? "+" : ""}${o}d`)}
              tick={{ fill: "#9AA3B8", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#232B40" }}
            />
            <YAxis tick={{ fill: "#9AA3B8", fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => String(Number(v.toFixed(1)))} />
            <ReferenceLine x={0} stroke={MARKER} strokeDasharray="4 3" strokeWidth={1.5} />
            {median != null && <ReferenceLine y={median} stroke="#9AA3B8" strokeDasharray="5 4" />}
            <Tooltip
              cursor={{ stroke: "#9AA3B8", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="trend-tip">
                    <strong>
                      {shortDate(r.date)} {r.o === 0 ? "· Diwali" : `(${r.o > 0 ? "+" : ""}${r.o} days)`}
                    </strong>
                    <span>{r.status === "clear" ? <b>{fmtRad(r.v)} nW/cm²/sr</b> : r.status === "cloudy" ? "cloudy" : "no NASA data"}</span>
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey="v" stroke={COLOR_A} strokeWidth={2} connectNulls={false} dot={dot} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-note muted">Shaded: nights around Diwali, not used as "normal" · breaks are cloudy nights</p>
    </figure>
  );
}
