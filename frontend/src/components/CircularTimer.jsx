export default function CircularTimer({
  progress = 1,
  label,
  size = 120,
  color = 'blue',
  ticks = 24,
  tickLen = 11,
  tickWidth = 4,
}) {
  const isGreen     = color === 'green';
  const filledColor = isGreen ? '#2F9F58' : '#0272C0';
  const trackColor  = isGreen ? '#C9EAD3' : '#C7E1F0';
  const textCls     = isGreen ? 'text-green' : 'text-dark-blue';

  const c = size / 2;
  const outerR = c - 2;
  const innerR = outerR - tickLen;

  const p = Math.max(0, Math.min(1, progress));
  const filledCount = Math.round(p * ticks);

  const tickEls = [];
  for (let i = 0; i < ticks; i++) {
    const angle = (i / ticks) * 2 * Math.PI - Math.PI / 2;
    const x1 = c + innerR * Math.cos(angle);
    const y1 = c + innerR * Math.sin(angle);
    const x2 = c + outerR * Math.cos(angle);
    const y2 = c + outerR * Math.sin(angle);
    const filled = i < filledCount;
    tickEls.push(
      <line
        key={i}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={filled ? filledColor : trackColor}
        strokeWidth={tickWidth}
        strokeLinecap="butt"
      />
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>{tickEls}</svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-timer ${textCls}`}>{label}</span>
      </div>
    </div>
  );
}
