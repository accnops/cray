import ReactECharts from "echarts-for-react";
import { useRef, useCallback } from "react";

interface DataPoint {
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface Props {
  data: DataPoint[];
  onZoomChange?: (range: { start: number; end: number } | null) => void;
}

export function TokensChart({ data, onZoomChange }: Props) {
  const chartRef = useRef<ReactECharts>(null);
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
    toolbox: {
      feature: {
        brush: {
          type: ["lineX", "clear"],
          title: { lineX: "Zoom", clear: "Reset" },
        },
      },
      right: 20,
      top: 0,
    },
    brush: {
      toolbox: ["lineX", "clear"],
      xAxisIndex: 0,
      brushStyle: {
        borderWidth: 1,
        color: "rgba(88, 166, 255, 0.2)",
        borderColor: "#58a6ff",
      },
    },
  };

  const onBrushEnd = useCallback((params: any) => {
    if (!onZoomChange) return;

    const areas = params.areas;
    if (!areas || areas.length === 0) return;

    const area = areas[0];
    if (area.coordRange && area.coordRange.length === 2) {
      const [start, end] = area.coordRange;
      // Ignore tiny selections (< 1 second)
      if (end - start < 1000) return;
      onZoomChange({ start, end });
    }
  }, [onZoomChange]);

  const onEvents = {
    brushEnd: onBrushEnd,
    dblclick: () => onZoomChange?.(null),
  };

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      style={{ height: 300 }}
      onEvents={onEvents}
    />
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
