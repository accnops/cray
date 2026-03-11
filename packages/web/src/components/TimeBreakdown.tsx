import { useMemo, useRef, useState, useEffect } from "react";

interface BreakdownItem {
  name: string;
  type: "llm" | "builtin" | "mcp";
  calls: number;
  totalMs: number;
  wallClockMs: number;
  pctOfSession: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
}

interface Props {
  data: BreakdownItem[];
  sessionDurationMs?: number;
}

const COLORS = {
  llm: "#C15F3C",
  builtin: "#60a5fa",
  mcp: "#c084fc",
  background: "#0d0d14",
  paper: "#161620",
  text: "#e0e4f0",
  textLight: "#7a7f99",
  gridLine: "#2a2a3c",
};

const FONT = "'Gaegu', 'Comic Neue', 'Comic Sans MS', cursive";

// Seeded random for reproducible jitter
function createRandom(seed = 12345) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function jitter(value: number, amount: number, rand: () => number): number {
  return value + (rand() - 0.5) * amount;
}

// Hand-drawn horizontal line
function handDrawnHLine(
  x1: number,
  x2: number,
  y: number,
  rand: () => number,
  roughness = 1.5
): string {
  const points: Array<{ x: number; y: number }> = [];
  const segments = Math.max(2, Math.ceil((x2 - x1) / 15));
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: x1 + t * (x2 - x1),
      y: jitter(y, roughness, rand),
    });
  }

  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    const cpX = jitter(midX, roughness, rand);
    const cpY = jitter(midY, roughness, rand);
    d += ` Q ${cpX.toFixed(1)} ${cpY.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return d;
}

// Hand-drawn rectangle (filled bar)
function handDrawnBar(
  x: number,
  y: number,
  width: number,
  height: number,
  rand: () => number,
  roughness = 2
): string {
  const points = [
    { x: x + jitter(0, roughness, rand), y: y + jitter(0, roughness, rand) },
    { x: x + width + jitter(0, roughness, rand), y: y + jitter(0, roughness, rand) },
    { x: x + width + jitter(0, roughness, rand), y: y + height + jitter(0, roughness, rand) },
    { x: x + jitter(0, roughness, rand), y: y + height + jitter(0, roughness, rand) },
  ];

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    d += ` Q ${jitter(midX, roughness * 0.5, rand).toFixed(1)} ${jitter(midY, roughness * 0.5, rand).toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  d += " Z";
  return d;
}

export function TimeBreakdown({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Track container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Get initial width synchronously
    const rect = container.getBoundingClientRect();
    if (rect.width > 0) {
      setContainerWidth(Math.floor(rect.width));
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width } = entry.contentRect;
        if (width > 0) {
          setContainerWidth((prev) => {
            if (!prev || Math.abs(prev - width) > 1) {
              return Math.floor(width);
            }
            return prev;
          });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const chartContent = useMemo(() => {
    if (data.length === 0 || !containerWidth) return null;

    const width = containerWidth;
    const barHeight = 22;
    const barGap = 8;
    // Scale label width based on container width
    const labelWidth = Math.min(140, Math.max(80, width * 0.25));
    const pctWidth = 50;
    const margin = { top: 4, right: 10, bottom: 10, left: 10 };
    const chartWidth = Math.max(50, width - margin.left - margin.right - labelWidth - pctWidth);

    // Take top entries for chart, filtering out items that would have bar width < 2px
    const maxWallClock = Math.max(...data.map((d) => d.wallClockMs), 1);
    // barWidth = (wallClockMs / maxWallClock) * chartWidth, so threshold = 2 * maxWallClock / chartWidth
    const minThreshold = (2 * maxWallClock) / chartWidth;
    const chartData = data.filter((d) => d.wallClockMs >= minThreshold).slice(0, 8);
    const height = margin.top + margin.bottom + chartData.length * (barHeight + barGap) - barGap;

    const rand = createRandom(123);
    const elements: JSX.Element[] = [];

    // Background
    elements.push(
      <rect key="bg" x="0" y="0" width={width} height={height} fill={COLORS.background} rx="4" />
    );

    // Draw bars
    chartData.forEach((item, idx) => {
      const y = margin.top + idx * (barHeight + barGap);
      const barWidth = (item.wallClockMs / maxWallClock) * chartWidth;
      const color = COLORS[item.type];
      const barRand = createRandom(idx * 100);

      // Label (truncated)
      const displayName = item.name.length > 18 ? item.name.slice(0, 16) + "…" : item.name;
      elements.push(
        <text
          key={`label-${idx}`}
          x={margin.left + labelWidth - 8}
          y={y + barHeight / 2 + 5}
          textAnchor="end"
          fill={COLORS.text}
          fontFamily={FONT}
          fontSize="13"
        >
          {displayName}
        </text>
      );

      // Hand-drawn bar (multiple strokes for sketch effect)
      if (barWidth > 2) {
        for (let stroke = 0; stroke < 2; stroke++) {
          const strokeRand = createRandom(idx * 100 + stroke * 50);
          const barPath = handDrawnBar(
            margin.left + labelWidth,
            y + 2,
            barWidth,
            barHeight - 4,
            strokeRand,
            2
          );
          elements.push(
            <path
              key={`bar-${idx}-${stroke}`}
              d={barPath}
              fill={stroke === 0 ? color : "none"}
              stroke={color}
              strokeWidth={stroke === 0 ? 0 : 1.5}
              opacity={stroke === 0 ? 0.8 : 0.5}
            />
          );
        }
      }

      // Percentage label
      elements.push(
        <text
          key={`pct-${idx}`}
          x={margin.left + labelWidth + chartWidth + 8}
          y={y + barHeight / 2 + 5}
          textAnchor="start"
          fill={COLORS.textLight}
          fontFamily={FONT}
          fontSize="13"
        >
          {item.pctOfSession.toFixed(1)}%
        </text>
      );
    });

    return (
      <svg
        width={width}
        height={height}
        style={{ display: "block", marginBottom: "0.75rem" }}
      >
        {elements}
      </svg>
    );
  }, [data, containerWidth]);

  if (data.length === 0) {
    return <div className="empty">No data</div>;
  }

  return (
    <div ref={containerRef} className="time-breakdown">
      {chartContent}

      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Calls</th>
            <th>Wall Clock</th>
            <th>Avg</th>
            <th>P95</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <td className="name">{d.name}</td>
              <td>
                <span className={`badge badge-${d.type}`}>{d.type}</span>
              </td>
              <td>{d.calls}</td>
              <td>{formatMs(d.wallClockMs)} ({d.pctOfSession.toFixed(1)}%)</td>
              <td>{formatMs(d.avgMs)}</td>
              <td>{formatMs(d.p95Ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
  return `${(ms / 86400000).toFixed(1)}d`;
}
