export default function CircularTimer({
  progress = 1,
  label,
  size = 120,
  color = 'blue',
  ticks = 24,
  tickLen = 11,
  tickWidth = 4,
}) {
  const filledColor = color === 'green' ? '#2F9F58' : color === 'red' ? '#E65001' : '#0272C0';
  const trackColor  = color === 'green' ? '#C9EAD3' : color === 'red' ? '#FBD9CF' : '#C7E1F0';
  // El número de la secadora (color rojo) conserva el mismo tono que la
  // lavadora (dark-blue); solo el aro cambia a rojo.
  const textCls     = color === 'green' ? 'text-green' : 'text-dark-blue';

  const c = size / 2;
  const outerR = c - 2;
  const innerR = outerR - tickLen;

  const p = Math.max(0, Math.min(1, progress));
  const filledCount = Math.round(p * ticks);

  const tickEls = [];
  for (let i = 0; i < ticks; i++) {
    const angle = -(i / ticks) * 2 * Math.PI - Math.PI / 2;
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
