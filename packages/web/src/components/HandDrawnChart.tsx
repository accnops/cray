import { useRef, useState, useCallback, useMemo, useEffect } from "react";

// ============================================================================
// HAND-DRAWN CHART - Ported from blog's sketchy style
// ============================================================================

interface DataPoint {
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface Series {
  name: string;
  color: string;
  values: number[];
}

interface Props {
  data: DataPoint[];
  onZoomChange?: (range: { start: number; end: number } | null) => void;
  onTimeClick?: (ts: number) => void;
  isZoomed?: boolean;
  indicatorTs?: number | null;
}

// Colors matching the blog's dark theme
const COLORS = {
  background: "#0d0d14",
  paper: "#161620",
  text: "#e0e4f0",
  textLight: "#7a7f99",
  gridLine: "#2a2a3c",
  accent1: "#58a6ff", // Blue for input
  accent2: "#3fb950", // Green for output
  claude: "#C15F3C",
  selection: "rgba(154, 74, 47, 0.25)", // Claude orange dark
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

// Add jitter to a point
function jitter(value: number, amount: number, rand: () => number): number {
  return value + (rand() - 0.5) * amount;
}

// Create a hand-drawn line path with wobble
function handDrawnPath(
  points: Array<{ x: number; y: number }>,
  rand: () => number,
  options: { roughness?: number; closed?: boolean; subdivide?: boolean } = {}
): string {
  const { roughness = 1.5, closed = false, subdivide = true } = options;

  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const jitterAmount = roughness * 2.5;

  // Subdivide long segments for more organic wobble
  let expandedPoints = points;
  if (subdivide) {
    expandedPoints = [];
    for (let i = 0; i < points.length; i++) {
      expandedPoints.push(points[i]);
      if (i < points.length - 1) {
        const curr = points[i];
        const next = points[i + 1];
        const dist = Math.hypot(next.x - curr.x, next.y - curr.y);
        const subdivisions = Math.floor(dist / 25);
        for (let j = 1; j <= subdivisions; j++) {
          const t = j / (subdivisions + 1);
          expandedPoints.push({
            x: curr.x + t * (next.x - curr.x),
            y: curr.y + t * (next.y - curr.y),
          });
        }
      }
    }
  }

  let d = `M ${jitter(expandedPoints[0].x, jitterAmount * 0.3, rand).toFixed(1)} ${jitter(expandedPoints[0].y, jitterAmount * 0.3, rand).toFixed(1)}`;

  for (let i = 1; i < expandedPoints.length; i++) {
    const prev = expandedPoints[i - 1];
    const curr = expandedPoints[i];

    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;

    const cp1x = jitter(midX, jitterAmount, rand);
    const cp1y = jitter(midY, jitterAmount, rand);
    const endX = jitter(curr.x, jitterAmount * 0.3, rand);
    const endY = jitter(curr.y, jitterAmount * 0.3, rand);

    d += ` Q ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
  }

  if (closed) d += " Z";
  return d;
}

// Create multiple sketch strokes for pencil effect
function sketchPaths(
  points: Array<{ x: number; y: number }>,
  rand: () => number,
  options: { roughness?: number; strokes?: number } = {}
): string[] {
  const { roughness = 1.5, strokes = 2 } = options;
  const paths: string[] = [];
  for (let s = 0; s < strokes; s++) {
    const strokeRand = createRandom(rand() * 10000);
    const path = handDrawnPath(points, strokeRand, {
      roughness: roughness * (0.8 + s * 0.3),
      subdivide: true,
    });
    paths.push(path);
  }
  return paths;
}

// Hand-drawn rectangle
function handDrawnRect(
  x: number,
  y: number,
  width: number,
  height: number,
  rand: () => number,
  options: { roughness?: number } = {}
): string {
  const { roughness = 2.5 } = options;
  const edges = [
    [{ x, y }, { x: x + width, y }],
    [{ x: x + width, y }, { x: x + width, y: y + height }],
    [{ x: x + width, y: y + height }, { x, y: y + height }],
    [{ x, y: y + height }, { x, y }],
  ];
  return edges
    .map((edge) => handDrawnPath(edge, rand, { roughness, subdivide: true }))
    .join(" ");
}

// Hand-drawn horizontal line
function handDrawnHLine(
  x1: number,
  x2: number,
  y: number,
  rand: () => number,
  options: { roughness?: number } = {}
): string {
  const { roughness = 1.5 } = options;
  const points: Array<{ x: number; y: number }> = [];
  const segments = Math.ceil((x2 - x1) / 20);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: x1 + t * (x2 - x1),
      y: jitter(y, roughness * 1.5, rand),
    });
  }
  return handDrawnPath(points, rand, { roughness: roughness * 0.8, subdivide: false });
}

// Nice upper bound for Y axis
function niceUpperBound(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const scaled = value / base;
  const niceValues = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let nice = 10;
  for (const n of niceValues) {
    if (scaled <= n) {
      nice = n;
      break;
    }
  }
  return nice * base;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// Time intervals for nice tick spacing
const TIME_INTERVALS = [
  { ms: 1000, label: "second" },           // 1 second
  { ms: 5000, label: "second" },           // 5 seconds
  { ms: 10000, label: "second" },          // 10 seconds
  { ms: 30000, label: "second" },          // 30 seconds
  { ms: 60000, label: "minute" },          // 1 minute
  { ms: 300000, label: "minute" },         // 5 minutes
  { ms: 600000, label: "minute" },         // 10 minutes
  { ms: 1800000, label: "minute" },        // 30 minutes
  { ms: 3600000, label: "hour" },          // 1 hour
  { ms: 7200000, label: "hour" },          // 2 hours
  { ms: 14400000, label: "hour" },         // 4 hours
  { ms: 21600000, label: "hour" },         // 6 hours
  { ms: 43200000, label: "hour" },         // 12 hours
  { ms: 86400000, label: "day" },          // 1 day
  { ms: 172800000, label: "day" },         // 2 days
  { ms: 604800000, label: "day" },         // 1 week
];

interface TimeTick {
  ts: number;
  label: string;
}

function computeTimeTicks(minTs: number, maxTs: number, maxTicks: number): TimeTick[] {
  const range = maxTs - minTs;
  if (range <= 0) return [];

  // Find the best interval that gives us a reasonable number of ticks
  let bestInterval = TIME_INTERVALS[TIME_INTERVALS.length - 1];
  for (const interval of TIME_INTERVALS) {
    const tickCount = Math.floor(range / interval.ms);
    if (tickCount >= 2 && tickCount <= maxTicks) {
      bestInterval = interval;
      break;
    }
  }

  // Round minTs down to the nearest interval boundary
  const startTs = Math.floor(minTs / bestInterval.ms) * bestInterval.ms;

  // Generate ticks
  const ticks: TimeTick[] = [];
  for (let ts = startTs; ts <= maxTs; ts += bestInterval.ms) {
    if (ts >= minTs) {
      const d = new Date(ts);
      let label: string;

      if (bestInterval.label === "second") {
        label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } else if (bestInterval.label === "minute") {
        label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } else if (bestInterval.label === "hour") {
        label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } else {
        // day
        label = d.toLocaleDateString([], { month: "short", day: "numeric" });
      }

      ticks.push({ ts, label });
    }
  }

  return ticks;
}

export function HandDrawnChart({ data, onZoomChange, onTimeClick, isZoomed, indicatorTs }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; ts: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // Track container size with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Get initial size synchronously to avoid flash
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          // Only update if dimensions actually changed (avoid infinite loops)
          setDimensions((prev) => {
            if (!prev || Math.abs(prev.width - width) > 1 || Math.abs(prev.height - height) > 1) {
              return { width: Math.floor(width), height: Math.floor(height) };
            }
            return prev;
          });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Chart dimensions - responsive (wait for actual dimensions)
  const width = dimensions?.width ?? 0;
  const height = dimensions?.height ?? 0;

  // Scale margins based on chart size
  const marginScale = Math.min(width / 700, height / 280);
  const margin = {
    top: Math.max(8, Math.round(12 * marginScale)),
    right: Math.max(40, Math.round(60 * marginScale)),
    bottom: Math.max(35, Math.round(50 * marginScale)),
    left: Math.max(40, Math.round(60 * marginScale)),
  };
  const plotW = Math.max(100, width - margin.left - margin.right);
  const plotH = Math.max(50, height - margin.top - margin.bottom);

  // Scale font sizes based on chart size - keep fonts readable
  const fontScale = Math.min(1, Math.max(0.85, Math.min(width / 500, height / 200)));
  const fontSize = {
    axis: Math.max(12, Math.round(14 * fontScale)),
    legend: Math.max(12, Math.round(14 * fontScale)),
    tooltip: Math.max(11, Math.round(12 * fontScale)),
  };

  // Compute tick counts based on available space
  const xTickCount = Math.max(2, Math.min(10, Math.floor(plotW / 100)));
  const yTickCount = Math.max(2, Math.min(8, Math.floor(plotH / 40)));

  // Memoize chart calculations
  const chartData = useMemo(() => {
    if (data.length === 0) return null;

    const timestamps = data.map((d) => d.ts);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

    const inputValues = data.map((d) => d.inputTokens);
    const outputValues = data.map((d) => d.outputTokens);
    const maxVal = Math.max(...inputValues, ...outputValues, 0);
    const yMax = niceUpperBound(maxVal * 1.1);

    const series: Series[] = [
      { name: "Input", color: COLORS.accent1, values: inputValues },
      { name: "Output", color: COLORS.accent2, values: outputValues },
    ];

    return { minTs, maxTs, yMax, series, timestamps };
  }, [data]);

  // Coordinate converters
  const xScale = useCallback(
    (ts: number): number => {
      if (!chartData || chartData.maxTs === chartData.minTs) return margin.left + plotW / 2;
      return margin.left + ((ts - chartData.minTs) / (chartData.maxTs - chartData.minTs)) * plotW;
    },
    [chartData, margin.left, plotW]
  );

  const yScale = useCallback(
    (value: number): number => {
      if (!chartData) return margin.top + plotH;
      return margin.top + (1 - value / chartData.yMax) * plotH;
    },
    [chartData, margin.top, plotH]
  );

  const xScaleInverse = useCallback(
    (px: number): number => {
      if (!chartData) return 0;
      const ratio = (px - margin.left) / plotW;
      return chartData.minTs + ratio * (chartData.maxTs - chartData.minTs);
    },
    [chartData, margin.left, plotW]
  );

  // Convert screen coordinates to SVG coordinates (1:1 mapping since we use pixel dimensions)
  const screenToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      if (!svgRef.current) return { x: 0, y: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  // Mouse handlers for brush zoom
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const { x } = screenToSvg(e.clientX, e.clientY);
      const ts = xScaleInverse(x);
      setDragStart({ x, ts });
      setDragCurrent(x);
    },
    [xScaleInverse, screenToSvg]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const { x } = screenToSvg(e.clientX, e.clientY);

      if (dragStart) {
        setDragCurrent(x);
      }

      // Find closest data point for hover
      if (chartData) {
        const ts = xScaleInverse(x);
        let closestIdx = 0;
        let closestDist = Infinity;
        for (let i = 0; i < chartData.timestamps.length; i++) {
          const dist = Math.abs(chartData.timestamps[i] - ts);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
          }
        }
        setHoverIndex(closestIdx);
      }
    },
    [dragStart, chartData, xScaleInverse, screenToSvg]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragStart || !svgRef.current) {
        setDragStart(null);
        setDragCurrent(null);
        return;
      }

      const { x } = screenToSvg(e.clientX, e.clientY);
      const endTs = xScaleInverse(x);
      const dragDistance = Math.abs(x - dragStart.x);

      // If moved less than 5px, treat as a click
      if (dragDistance < 5) {
        if (onTimeClick) {
          onTimeClick(endTs);
        }
      } else {
        // Drag/zoom behavior
        const start = Math.min(dragStart.ts, endTs);
        const end = Math.max(dragStart.ts, endTs);

        if (end - start >= 1000 && onZoomChange) {
          onZoomChange({ start, end });
        }
      }

      setDragStart(null);
      setDragCurrent(null);
    },
    [dragStart, onZoomChange, onTimeClick, xScaleInverse, screenToSvg]
  );

  const handleMouseLeave = useCallback(() => {
    setDragStart(null);
    setDragCurrent(null);
    setHoverIndex(null);
  }, []);

  // Generate SVG elements
  const svgContent = useMemo(() => {
    if (!chartData) return null;

    const rand = createRandom(42);
    const elements: JSX.Element[] = [];

    // Background
    elements.push(
      <rect key="bg" x="0" y="0" width={width} height={height} fill={COLORS.background} />
    );

    // Plot area background (hand-drawn rectangle)
    const plotBgPath = handDrawnRect(margin.left, margin.top, plotW, plotH, rand, { roughness: 1.5 });
    elements.push(<path key="plotBg" d={plotBgPath} fill={COLORS.paper} stroke="none" />);

    // Border with pencil effect
    const borderRand1 = createRandom(100);
    const borderRand2 = createRandom(200);
    const border1 = handDrawnRect(margin.left, margin.top, plotW, plotH, borderRand1, { roughness: 2 });
    const border2 = handDrawnRect(margin.left, margin.top, plotW, plotH, borderRand2, { roughness: 1.5 });
    elements.push(
      <path key="border1" d={border1} fill="none" stroke={COLORS.gridLine} strokeWidth="1.5" opacity="0.7" />
    );
    elements.push(
      <path key="border2" d={border2} fill="none" stroke={COLORS.gridLine} strokeWidth="1" opacity="0.5" />
    );

    // Y-axis grid lines and labels - use dynamic tick count
    for (let i = 0; i <= yTickCount; i++) {
      const value = (i / yTickCount) * chartData.yMax;
      const gy = yScale(value);
      const gridRand1 = createRandom(300 + i * 10);
      const gridRand2 = createRandom(400 + i * 10);
      const gridPath1 = handDrawnHLine(margin.left, margin.left + plotW, gy, gridRand1, { roughness: 0.6 });
      const gridPath2 = handDrawnHLine(margin.left, margin.left + plotW, gy, gridRand2, { roughness: 0.4 });

      elements.push(
        <path
          key={`grid1-${i}`}
          d={gridPath1}
          fill="none"
          stroke={COLORS.gridLine}
          strokeWidth="1"
          strokeDasharray="6,4"
          opacity="0.6"
        />
      );
      elements.push(
        <path
          key={`grid2-${i}`}
          d={gridPath2}
          fill="none"
          stroke={COLORS.gridLine}
          strokeWidth="0.5"
          strokeDasharray="6,4"
          opacity="0.3"
        />
      );
      elements.push(
        <text
          key={`ylabel-${i}`}
          x={margin.left - 8}
          y={gy + 5}
          textAnchor="end"
          fill={COLORS.textLight}
          fontFamily={FONT}
          fontSize={fontSize.axis}
        >
          {formatNumber(value)}
        </text>
      );
    }

    // X-axis labels - compute nice evenly-spaced ticks based on available width
    const timeTicks = computeTimeTicks(chartData.minTs, chartData.maxTs, xTickCount);
    const edgePadding = Math.max(20, plotW * 0.05);

    for (const tick of timeTicks) {
      const gx = xScale(tick.ts);
      // Skip ticks too close to edges
      if (gx < margin.left + edgePadding || gx > margin.left + plotW - edgePadding) continue;

      elements.push(
        <text
          key={`xlabel-${tick.ts}`}
          x={gx}
          y={margin.top + plotH + Math.round(20 * fontScale)}
          textAnchor="middle"
          fill={COLORS.textLight}
          fontFamily={FONT}
          fontSize={fontSize.axis}
        >
          {tick.label}
        </text>
      );
    }

    // Draw series lines with pencil/sketch effect
    for (const s of chartData.series) {
      const points = s.values.map((value, idx) => ({
        x: xScale(chartData.timestamps[idx]),
        y: yScale(value),
      }));

      const strokes = sketchPaths(points, rand, { roughness: 1.5, strokes: 2 });
      strokes.forEach((path, i) => {
        const sw = 2.5 - i * 0.5;
        const opacity = 1 - i * 0.25;
        elements.push(
          <path
            key={`line-${s.name}-${i}`}
            d={path}
            fill="none"
            stroke={s.color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opacity}
          />
        );
      });

      // End point circle
      const last = points[points.length - 1];
      if (last) {
        const circleRand = createRandom(s.name.length * 100);
        const r = 5;
        const circlePoints: Array<{ x: number; y: number }> = [];
        for (let a = 0; a <= 360; a += 20) {
          const rad = (a * Math.PI) / 180;
          const rr = r + jitter(0, 1.5, circleRand);
          circlePoints.push({
            x: last.x + Math.cos(rad) * rr,
            y: last.y + Math.sin(rad) * rr,
          });
        }
        const circlePath = handDrawnPath(circlePoints, circleRand, { roughness: 1, subdivide: false });
        elements.push(
          <path key={`circle-${s.name}`} d={circlePath} fill={s.color} stroke={s.color} strokeWidth="1.5" />
        );
      }
    }

    // Scroll indicator line from chat
    if (indicatorTs != null && indicatorTs >= chartData.minTs && indicatorTs <= chartData.maxTs) {
      const x = xScale(indicatorTs);
      elements.push(
        <line
          key="scroll-indicator"
          x1={x} y1={margin.top}
          x2={x} y2={margin.top + plotH}
          stroke={COLORS.claude}
          strokeWidth="2"
        />
      );
    }

    // Legend - scale spacing based on font size
    const legendLineWidth = Math.round(24 * fontScale);
    const legendGap = Math.round(8 * fontScale);
    const legendY = height - Math.round(12 * fontScale);
    let legendX = margin.left;
    for (const s of chartData.series) {
      const legendPaths = sketchPaths(
        [
          { x: legendX, y: legendY },
          { x: legendX + legendLineWidth, y: legendY },
        ],
        rand,
        { roughness: 1, strokes: 2 }
      );
      legendPaths.forEach((path, i) => {
        elements.push(
          <path
            key={`legend-line-${s.name}-${i}`}
            d={path}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5 - i}
            strokeLinecap="round"
            opacity={1 - i * 0.3}
          />
        );
      });
      elements.push(
        <text
          key={`legend-text-${s.name}`}
          x={legendX + legendLineWidth + legendGap}
          y={legendY + 5}
          fill={COLORS.text}
          fontFamily={FONT}
          fontSize={fontSize.legend}
        >
          {s.name}
        </text>
      );
      legendX += legendLineWidth + legendGap + s.name.length * fontSize.legend * 0.6 + legendGap * 2;
    }

    return elements;
  }, [chartData, data.length, xScale, yScale, margin, plotW, plotH, width, height, fontSize, fontScale, yTickCount, xTickCount, indicatorTs]);

  if (data.length === 0) {
    return (
      <div className="tokens-chart-container empty-state">
        {isZoomed && (
          <button className="zoom-clear-btn" onClick={() => onZoomChange?.(null)}>
            Clear
          </button>
        )}
        <div className="empty">No token data</div>
      </div>
    );
  }

  // Selection overlay
  const selectionRect =
    dragStart && dragCurrent !== null ? (
      <rect
        x={Math.min(dragStart.x, dragCurrent)}
        y={margin.top}
        width={Math.abs(dragCurrent - dragStart.x)}
        height={plotH}
        fill={COLORS.selection}
        stroke={COLORS.claude}
        strokeWidth="1"
      />
    ) : null;

  // Hover tooltip - scale sizes
  const tooltipWidth = Math.round(145 * fontScale);
  const tooltipHeight = Math.round(52 * fontScale);
  const tooltipPadding = Math.round(8 * fontScale);
  const tooltipLineHeight = Math.round(16 * fontScale);

  const tooltip =
    hoverIndex !== null && chartData && !dragStart ? (
      <>
        <line
          x1={xScale(chartData.timestamps[hoverIndex])}
          y1={margin.top}
          x2={xScale(chartData.timestamps[hoverIndex])}
          y2={margin.top + plotH}
          stroke={COLORS.textLight}
          strokeWidth="1"
          strokeDasharray="4,4"
          opacity="0.5"
        />
        <rect
          x={xScale(chartData.timestamps[hoverIndex]) + tooltipPadding}
          y={margin.top + tooltipPadding}
          width={tooltipWidth}
          height={tooltipHeight}
          fill={COLORS.paper}
          stroke={COLORS.gridLine}
          rx="4"
        />
        <text
          x={xScale(chartData.timestamps[hoverIndex]) + tooltipPadding * 2}
          y={margin.top + tooltipPadding + tooltipLineHeight}
          fill={COLORS.text}
          fontFamily={FONT}
          fontSize={fontSize.tooltip}
        >
          {formatDateTime(chartData.timestamps[hoverIndex])}
        </text>
        <text
          x={xScale(chartData.timestamps[hoverIndex]) + tooltipPadding * 2}
          y={margin.top + tooltipPadding + tooltipLineHeight * 2}
          fill={COLORS.accent1}
          fontFamily={FONT}
          fontSize={fontSize.tooltip}
        >
          Input: {formatNumber(data[hoverIndex].inputTokens)}
        </text>
        <text
          x={xScale(chartData.timestamps[hoverIndex]) + tooltipPadding * 2}
          y={margin.top + tooltipPadding + tooltipLineHeight * 3}
          fill={COLORS.accent2}
          fontFamily={FONT}
          fontSize={fontSize.tooltip}
        >
          Output: {formatNumber(data[hoverIndex].outputTokens)}
        </text>
      </>
    ) : null;

  return (
    <div ref={containerRef} className="tokens-chart-container">
      {isZoomed && (
        <button className="zoom-clear-btn" onClick={() => onZoomChange?.(null)}>
          Clear
        </button>
      )}
      {dimensions && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          style={{ cursor: "crosshair", display: "block" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {svgContent}
          {selectionRect}
          {tooltip}
        </svg>
      )}
    </div>
  );
}
