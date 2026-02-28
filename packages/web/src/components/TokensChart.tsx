import ReactECharts from "echarts-for-react";

interface DataPoint {
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface Props {
  data: DataPoint[];
}

export function TokensChart({ data }: Props) {
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
          html += `${p.marker} ${p.seriesName}: ${p.value.toLocaleString()}<br/>`;
        }
        return html;
      },
    },
    legend: {
      data: ["Input", "Output", "Cache Read"],
      textStyle: { color: "#8b949e" },
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
        smooth: true,
      },
      {
        name: "Output",
        type: "line",
        data: data.map((d) => [d.ts, d.outputTokens]),
        itemStyle: { color: "#3fb950" },
        smooth: true,
      },
      {
        name: "Cache Read",
        type: "line",
        data: data.map((d) => [d.ts, d.cacheReadTokens]),
        itemStyle: { color: "#d29922" },
        lineStyle: { type: "dashed" },
        smooth: true,
      },
    ],
    backgroundColor: "transparent",
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
