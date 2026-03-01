import ReactECharts from "echarts-for-react";
import { useRef, useState, useCallback, useEffect } from "react";

interface DataPoint {
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface Props {
  data: DataPoint[];
  onZoomChange?: (range: { start: number; end: number } | null) => void;
  isZoomed?: boolean;
}

export function TokensChart({ data, onZoomChange, isZoomed }: Props) {
  const chartRef = useRef<ReactECharts>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; ts: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

  if (data.length === 0) {
    return <div className="empty">No token data</div>;
  }

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        const date = new Date(params[0].axisValue).toLocaleString();
        let html = `<strong>${date}</strong><br/>`;
        for (const p of params) {
          html += `${p.marker} ${p.seriesName}: ${formatNumber(p.value[1])}<br/>`;
        }
        return html;
      },
    },
    legend: {
      data: ["Input", "Output"],
      textStyle: { color: "#8b949e" },
      top: 0,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e" },
    },
    yAxis: {
      type: "value",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e", formatter: (v: number) => formatNumber(v) },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    series: [
      {
        name: "Input",
        type: "line",
        data: data.map((d) => [d.ts, d.inputTokens]),
        itemStyle: { color: "#58a6ff" },
        showSymbol: false,
        smooth: true,
      },
      {
        name: "Output",
        type: "line",
        data: data.map((d) => [d.ts, d.outputTokens]),
        itemStyle: { color: "#3fb950" },
        showSymbol: false,
        smooth: true,
      },
    ],
    backgroundColor: "transparent",
  };

  const getTimestampFromX = useCallback((clientX: number): number | null => {
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart || !containerRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const point = chart.convertFromPixel({ seriesIndex: 0 }, [x, 0]);
    return point?.[0] ?? null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const ts = getTimestampFromX(e.clientX);
    if (ts !== null) {
      setDragStart({ x: e.clientX, ts });
      setDragCurrent(e.clientX);
    }
  }, [getTimestampFromX]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStart) {
      setDragCurrent(e.clientX);
    }
  }, [dragStart]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragStart || !onZoomChange) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const endTs = getTimestampFromX(e.clientX);
    if (endTs !== null) {
      const start = Math.min(dragStart.ts, endTs);
      const end = Math.max(dragStart.ts, endTs);
      // Ignore tiny selections (< 1 second)
      if (end - start >= 1000) {
        onZoomChange({ start, end });
      }
    }

    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, getTimestampFromX, onZoomChange]);

  const handleMouseLeave = useCallback(() => {
    setDragStart(null);
    setDragCurrent(null);
  }, []);

  // Calculate selection overlay position
  const getSelectionStyle = (): React.CSSProperties | null => {
    if (!dragStart || dragCurrent === null || !containerRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const left = Math.min(dragStart.x, dragCurrent) - rect.left;
    const width = Math.abs(dragCurrent - dragStart.x);

    return {
      position: "absolute",
      left: `${left}px`,
      top: 0,
      width: `${width}px`,
      height: "100%",
      backgroundColor: "rgba(88, 166, 255, 0.2)",
      borderLeft: "1px solid #58a6ff",
      borderRight: "1px solid #58a6ff",
      pointerEvents: "none",
    };
  };

  const selectionStyle = getSelectionStyle();

  return (
    <div className="tokens-chart-container">
      {isZoomed && (
        <button
          className="zoom-clear-btn"
          onClick={() => onZoomChange?.(null)}
        >
          Clear
        </button>
      )}
      <div
        ref={containerRef}
        style={{ position: "relative", cursor: "crosshair" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: 300 }}
        />
        {selectionStyle && <div style={selectionStyle} />}
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
