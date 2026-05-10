export default function CircularTimer({ progress = 0, label, size = 96, stroke = 8, color = 'blue' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));

  const trackCls  = color === 'green' ? 'stroke-light-green' : 'stroke-light-blue';
  const fillCls   = color === 'green' ? 'stroke-green'       : 'stroke-blue';
  const textCls   = color === 'green' ? 'text-green'         : 'text-dark-blue';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={trackCls} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={fillCls}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-timer ${textCls}`}>{label}</span>
      </div>
    </div>
  );
}
