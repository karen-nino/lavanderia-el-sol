// Overlay con una lavadora/secadora animada, para dar feedback al arrancar o
// detener una máquina. Hay tres variantes visuales:
//   - 'lavar'   (iniciar + lavadora): tonos azules, el tambor se LLENA de agua.
//   - 'secar'   (iniciar + secadora): tonos cálidos, el tambor GIRA con ondas
//                de calor subiendo.
//   - 'detener' (cualquier tipo):     tonos rojos, el tambor DESACELERA hasta
//                frenar y un anillo de alerta pulsa.
//
//   modo:   'iniciar' | 'detener'
//   tipo:   'secadora' → "Secadora"; cualquier otro → "Lavadora".
//   nombre: nombre de la máquina (L1, S1, …).
export default function MaquinaCicloOverlay({ modo = 'iniciar', tipo, nombre }) {
  const esDetener = modo === 'detener';
  const esSecadora = tipo === 'secadora';
  const tipoLabel = esSecadora ? 'Secadora' : 'Lavadora';
  const titulo = esDetener ? 'Deteniendo máquina…' : 'Iniciando máquina…';

  const variant = esDetener ? 'detener' : esSecadora ? 'secar' : 'lavar';
  const CFG = {
    lavar: {
      glass: '#cfeaff', holes: '#9fccf3', rim: '#a9c8ea', ring: '#b7cbe8', aro: '#eef4fb',
      light: '#22c55e', lightDur: '1.4s', knob: '#2f6fed', knob2: '#cfe0fb',
      cloth2: '#ffd27f', cloth3: '#7fb2ff', drum: undefined,
      tituloCls: 'text-gray-400', tipoCls: 'text-dark-blue', nombreCls: 'text-blue',
    },
    secar: {
      glass: '#fde3e3', holes: '#e79191', rim: '#e6a3a3', ring: '#eda3a3', aro: '#fbeaea',
      light: '#ef4444', lightDur: '1.2s', knob: '#ef4444', knob2: '#f6cccc',
      cloth2: '#f7a8a8', cloth3: '#ef7f7f',
      drum: { transformBox: 'view-box', transformOrigin: '60px 90px', animation: 'sol-drum 2.2s linear infinite' },
      tituloCls: 'text-gray-400', tipoCls: 'text-red-700', nombreCls: 'text-red-600',
    },
    detener: {
      glass: '#fde3e3', holes: '#e08a8a', rim: '#e6a3a3', ring: '#eda3a3', aro: '#fbeaea',
      light: '#ef4444', lightDur: '1s', knob: '#ef4444', knob2: '#f6cccc',
      cloth2: '#f7a8a8', cloth3: '#ef7f7f',
      drum: { transformBox: 'view-box', transformOrigin: '60px 90px', animation: 'sol-drum-stop 1.5s cubic-bezier(.12,.7,.2,1) both' },
      tituloCls: 'text-red-400', tipoCls: 'text-red-700', nombreCls: 'text-red-600',
    },
  };
  const c = CFG[variant];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm">
      <div
        className="bg-white rounded-3xl shadow-2xl px-8 py-9 w-full max-w-xs flex flex-col items-center gap-5"
        style={{ animation: 'sol-pop .32s cubic-bezier(.34,1.56,.64,1) both' }}
      >
        <svg width="124" height="156" viewBox="0 0 120 150" role="img" aria-label={titulo}>
          {/* Cuerpo */}
          <rect x="12" y="8" width="96" height="134" rx="16" fill="#ffffff" stroke="#d7e3f4" strokeWidth="3" />
          {/* Panel superior */}
          <line x1="12" y1="38" x2="108" y2="38" stroke="#eaf0f8" strokeWidth="2" />
          <circle cx="26" cy="23" r="4" fill={c.knob} />
          <circle cx="40" cy="23" r="3" fill={c.knob2} />
          <circle cx="96" cy="23" r="3.5" fill={c.light}>
            <animate attributeName="opacity" values="1;.35;1" dur={c.lightDur} repeatCount="indefinite" />
          </circle>

          {/* Anillo de alerta (solo al detener) */}
          {esDetener && (
            <circle
              cx="60" cy="90" r="34" fill="none" stroke="#ef4444" strokeWidth="2.5"
              style={{ transformBox: 'view-box', transformOrigin: '60px 90px', animation: 'sol-ring 1.2s ease-out infinite' }}
            />
          )}

          {/* Aro metálico de la puerta */}
          <circle cx="60" cy="90" r="34" fill={c.aro} stroke={c.rim} strokeWidth="2" />
          <circle cx="60" cy="90" r="30" fill="none" stroke={c.ring} strokeWidth="4" />

          {/* Interior del vidrio (recortado al círculo) */}
          <defs>
            <clipPath id="sol-glass">
              <circle cx="60" cy="90" r="26" />
            </clipPath>
          </defs>
          <g clipPath="url(#sol-glass)">
            <rect x="34" y="64" width="52" height="52" fill={c.glass} />

            {/* Interior (agujeros + ropa). Gira al secar y al detener (frena);
                queda quieto al lavar mientras el agua sube. */}
            <g style={c.drum}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
                const r = 21;
                const x = 60 + r * Math.cos((a * Math.PI) / 180);
                const y = 90 + r * Math.sin((a * Math.PI) / 180);
                return <circle key={a} cx={x} cy={y} r="2" fill={c.holes} />;
              })}
              <rect x="49" y="81" width="16" height="11" rx="5" fill="#ffffff" transform="rotate(18 57 86)" />
              <rect x="58" y="90" width="15" height="10" rx="5" fill={c.cloth2} transform="rotate(-24 65 95)" />
              <rect x="50" y="92" width="13" height="9" rx="4.5" fill={c.cloth3} transform="rotate(40 56 96)" />
            </g>

            {/* Lavar: agua que sube llenando + burbujas */}
            {variant === 'lavar' && (
              <>
                <g style={{ animation: 'sol-fill 2.3s cubic-bezier(.37,0,.24,1) both' }}>
                  <rect x="34" y="64" width="52" height="52" fill="#5aa9f0" opacity="0.5" />
                  <rect x="34" y="64" width="52" height="3" fill="#a9d6fb" opacity="0.9" />
                </g>
                {[
                  { cx: 50, r: 2.6, d: '0s'   },
                  { cx: 60, r: 3.2, d: '.5s'  },
                  { cx: 69, r: 2.2, d: '.9s'  },
                  { cx: 56, r: 2,   d: '1.3s' },
                ].map((b, i) => (
                  <circle key={i} cx={b.cx} cy="112" r={b.r} fill="#ffffff" opacity="0.9"
                    style={{ animation: `sol-bubble 1.8s ease-in ${b.d} infinite` }} />
                ))}
              </>
            )}
          </g>

          {/* Secar: ondas de calor subiendo (fuera del vidrio, sobre la puerta) */}
          {variant === 'secar' && [
            { x: 48, d: '0s'   },
            { x: 60, d: '.8s'  },
            { x: 72, d: '1.6s' },
          ].map((w, i) => (
            <path
              key={i}
              d={`M${w.x} 78 q 6 -6 0 -12 q -6 -6 0 -12`}
              fill="none"
              stroke="#ef4444"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0"
              style={{ animation: `sol-heat 2.6s ease-in-out ${w.d} infinite` }}
            />
          ))}

          {/* Reflejo del vidrio */}
          <path d="M46 78 A26 26 0 0 1 68 68" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <circle cx="60" cy="90" r="26" fill="none" stroke={c.rim} strokeWidth="2" />
        </svg>

        <div className="text-center">
          <p className={`text-xs font-semibold uppercase tracking-wide ${c.tituloCls}`}>{titulo}</p>
          <p className={`text-xl font-bold mt-1.5 ${c.tipoCls}`}>{tipoLabel}</p>
          {nombre && <p className={`text-3xl font-extrabold leading-tight ${c.nombreCls}`}>{nombre}</p>}
        </div>
      </div>

      <style>{`
        @keyframes sol-drum      { to { transform: rotate(360deg); } }
        @keyframes sol-drum-stop { from { transform: rotate(0deg); } to { transform: rotate(540deg); } }
        @keyframes sol-fill      { from { transform: translateY(52px); } to { transform: translateY(0); } }
        @keyframes sol-pop       { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
        @keyframes sol-bubble {
          0%   { transform: translateY(0);    opacity: 0; }
          20%  { opacity: .9; }
          100% { transform: translateY(-30px); opacity: 0; }
        }
        @keyframes sol-heat {
          0%   { transform: translateY(10px); opacity: 0; }
          25%  { opacity: .95; }
          70%  { opacity: .95; }
          100% { transform: translateY(-26px); opacity: 0; }
        }
        @keyframes sol-ring {
          0%   { transform: scale(1);   opacity: .7; }
          100% { transform: scale(1.3); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="sol-drum"], [style*="sol-bubble"], [style*="sol-fill"], [style*="sol-heat"], [style*="sol-ring"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
