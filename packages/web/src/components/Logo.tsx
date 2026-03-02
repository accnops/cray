interface LogoProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

// Line centers (midpoint of each path)
const lines = [
  { d: "M5 70 L108 14", cx: 56.5, cy: 42, duration: 3 },
  { d: "M2 58 L117 36", cx: 59.5, cy: 47, duration: 4, reverse: true },
  { d: "M4 50 L111 50", cx: 57.5, cy: 50, duration: 3.5 },
  { d: "M2 42 L117 64", cx: 59.5, cy: 53, duration: 4.5, reverse: true },
  { d: "M5 30 L108 86", cx: 56.5, cy: 58, duration: 5 },
];

export function Logo({ size = 32, className, animate = false }: LogoProps) {
  // Aspect ratio of original viewBox (120:100)
  const width = size * 1.2;
  const height = size;

  return (
    <svg
      viewBox="0 0 120 100"
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g stroke="#C15F3C" strokeLinecap="round">
        {lines.map((line, i) => (
          <g
            key={i}
            style={animate ? {
              transformOrigin: `${line.cx}px ${line.cy}px`,
              animation: `logo-spin ${line.duration}s ease-in-out infinite${line.reverse ? " reverse" : ""}`,
            } : undefined}
          >
            <path d={line.d} strokeWidth="6" />
          </g>
        ))}
      </g>
    </svg>
  );
}
