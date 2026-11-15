import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtRad, monthLabel, type AppData } from "../data";

// Validated with the dataviz palette checker on the #121829 panel (dark band, CVD-safe).
const MONTHLY = "#C98424";
const YEARLY = "#2FA39A";
const MARKER = "#6EA8FF"; // blue = selection, per the design spec

type Row = { i: number; month: string; m: number | null; y: number | null; status: "ok" | "cloud" | "missing" };

type Props = { data: AppData; districtId: string; monthIndex: number; onPickMonth: (i: number) => void };

export default function TrendChart({ data, districtId, monthIndex, onPickMonth }: Props) {
  const m = data.monthly;
  const col = data.index.get(districtId);

  const { rows, yearTicks, observed } = useMemo(() => {
    const yearlyCol = data.yearly ? data.yearly.ids.indexOf(districtId) : -1;
    const yearlyByYear = new Map<number, number | null>();
    if (data.yearly && yearlyCol >= 0) data.yearly.years.forEach((yr, k) => yearlyByYear.set(yr, data.yearly!.mean[k][yearlyCol]));

    const rows: Row[] = m.months.map((month, i) => {
      const v = col != null ? m.mean[i][col] : null;
      const missing = m.loaded?.[i] === false;
      return {
        i,
        month,
        m: v,
        // The annual value is drawn across its whole year; a missing year stays empty.
        y: yearlyByYear.get(Number(month.slice(0, 4))) ?? null,
        status: v != null ? "ok" : missing ? "missing" : "cloud",
      };
    });
    const yearTicks = rows.filter((r) => r.month.endsWith("-01")).map((r) => r.i);
    return { rows, yearTicks, observed: rows.filter((r) => r.m != null).length };
  }, [m, col, data.yearly, districtId]);

  if (observed < 2) {
    return (
      <div className="chart-placeholder">
        <p className="muted small">The month-by-month trend appears once more months of history are loaded.</p>
      </div>
    );
  }

  const hasYearly = rows.some((r) => r.y != null);
  const name = data.byId.get(districtId)?.name ?? "";

  return (
    <figure className="trend" aria-label={`Night-time brightness of ${name}, by month${hasYearly ? ", with NASA's yearly average" : ""}. Click a point to show that month on the map.`}>
      <figcaption className="trend-head">
        <span className="trend-title">Brightness over time</span>
        <span className="trend-legend">
          <span><i style={{ background: MONTHLY }} aria-hidden="true" /> Monthly</span>
          {hasYearly && <span><i style={{ background: YEARLY }} aria-hidden="true" /> Yearly (NASA annual)</span>}
        </span>
      </figcaption>
      <div className="trend-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            onClick={(s) => {
              const i = Number(s?.activeTooltipIndex);
              if (Number.isInteger(i)) onPickMonth(i);
            }}
            style={{ cursor: "pointer" }}
          >
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={MONTHLY} stopOpacity={0.35} />
                <stop offset="100%" stopColor={MONTHLY} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#232B40" />
            <XAxis
              dataKey="i"
              type="number"
              domain={[0, rows.length - 1]}
              ticks={yearTicks}
              tickFormatter={(i: number) => `'${rows[i]?.month.slice(2, 4)}`}
              tick={{ fill: "#9AA3B8", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#232B40" }}
              interval="preserveStartEnd"
              minTickGap={6}
            />
            <YAxis tick={{ fill: "#9AA3B8", fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => String(Number(v.toFixed(1)))} />
            <Tooltip
              cursor={{ stroke: "#9AA3B8", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="trend-tip">
                    <strong>{monthLabel(r.month)}</strong>
                    <span>
                      Monthly:{" "}
                      {r.status === "ok" ? <b>{fmtRad(r.m)}</b> : r.status === "cloud" ? "gap (clouds)" : "no data"}
                    </span>
                    {r.y != null && (
                      <span>
                        Yearly: <b>{fmtRad(r.y)}</b>
                      </span>
                    )}
                  </div>
                );
              }}
            />
            {/* connectNulls off: cloudy or missing months show as breaks, never interpolated. */}
            <Area
              type="linear"
              dataKey="m"
              stroke={MONTHLY}
              strokeWidth={2}
              fill="url(#trend-fill)"
              connectNulls={false}
              dot={(p: { cx?: number; cy?: number; index?: number }) => {
                const k = p.index ?? -1;
                const isolated = rows[k]?.m != null && rows[k - 1]?.m == null && rows[k + 1]?.m == null;
                return isolated && p.cx != null && p.cy != null ? (
                  <circle key={k} cx={p.cx} cy={p.cy} r={3.5} fill={MONTHLY} stroke="#121829" strokeWidth={1.5} />
                ) : (
                  <g key={k} />
                );
              }}
              activeDot={{ r: 4, stroke: "#121829", strokeWidth: 2, fill: MONTHLY }}
              isAnimationActive={false}
            />
            {hasYearly && (
              <Line type="stepAfter" dataKey="y" stroke={YEARLY} strokeWidth={2} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            )}
            <ReferenceLine x={monthIndex} stroke={MARKER} strokeDasharray="4 3" strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-note muted">nW/cm²/sr · breaks are cloudy or not-yet-loaded months · click to jump to a month</p>
    </figure>
  );
}
