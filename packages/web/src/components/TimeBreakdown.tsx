import ReactECharts from "echarts-for-react";

interface BreakdownItem {
  name: string;
  type: "llm" | "builtin" | "mcp";
  calls: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
}

interface Props {
  data: BreakdownItem[];
}

const COLORS = {
  llm: "#2dd4bf",
  builtin: "#60a5fa",
  mcp: "#c084fc",
};

export function TimeBreakdown({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty">No data</div>;
  }

  // Take top 10 for chart
  const chartData = data.slice(0, 10);

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any) => {
        const item = params[0];
        const d = chartData[item.dataIndex];
        return `<strong>${d.name}</strong><br/>
          Calls: ${d.calls}<br/>
          Total: ${formatMs(d.totalMs)}<br/>
          Avg: ${formatMs(d.avgMs)}<br/>
          Errors: ${d.errors}`;
      },
    },
    grid: {
      left: "3%",
      right: "15%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e", formatter: (v: number) => formatMs(v) },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    yAxis: {
      type: "category",
      data: chartData.map((d) => d.name).reverse(),
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#c9d1d9", width: 150, overflow: "truncate" },
    },
    series: [
      {
        type: "bar",
        data: chartData
          .map((d) => ({
            value: d.totalMs,
            itemStyle: { color: COLORS[d.type] },
          }))
          .reverse(),
        label: {
          show: true,
          position: "right",
          formatter: (params: any) => {
            const d = chartData[chartData.length - 1 - params.dataIndex];
            return `${d.calls} calls`;
          },
          color: "#8b949e",
        },
      },
    ],
    backgroundColor: "transparent",
  };

  return (
    <div className="time-breakdown">
      <ReactECharts option={option} style={{ height: Math.max(200, chartData.length * 35) }} />

      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Calls</th>
            <th>Total</th>
            <th>Avg</th>
            <th>P95</th>
            <th>Errors</th>
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
              <td>{formatMs(d.totalMs)}</td>
              <td>{formatMs(d.avgMs)}</td>
              <td>{formatMs(d.p95Ms)}</td>
              <td className={d.errors > 0 ? "has-errors" : ""}>{d.errors}</td>
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
  return `${(ms / 60000).toFixed(1)}m`;
}
