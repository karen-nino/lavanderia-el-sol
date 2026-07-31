// Overlay que se muestra al arrancar una máquina: una lavadora con el tambor
// girando y burbujas subiendo. Da feedback visible de que el ciclo empezó.
//   tipo:   'secadora' cambia el texto a "secado"; cualquier otro = "lavado".
//   nombre: nombre de la máquina (opcional) para el subtítulo.
export default function IniciandoLavadoOverlay({ tipo, nombre }) {
  const esSecadora = tipo === 'secadora';
  const titulo = esSecadora ? 'Iniciando secado' : 'Iniciando lavado';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm">
      <div
        className="bg-white rounded-3xl shadow-2xl px-8 py-9 w-full max-w-xs flex flex-col items-center gap-5"
        style={{ animation: 'sol-pop .32s cubic-bezier(.34,1.56,.64,1) both' }}
      >
        <svg width="124" height="156" viewBox="0 0 120 150" role="img" aria-label={titulo}>
          {/* Cuerpo (más alto) */}
          <rect x="12" y="8" width="96" height="134" rx="16" fill="#ffffff" stroke="#d7e3f4" strokeWidth="3" />
          {/* Panel superior */}
          <line x1="12" y1="38" x2="108" y2="38" stroke="#eaf0f8" strokeWidth="2" />
          <circle cx="26" cy="23" r="4" fill="#2f6fed" />
          <circle cx="40" cy="23" r="3" fill="#cfe0fb" />
          <circle cx="96" cy="23" r="3.5" fill="#22c55e">
            <animate attributeName="opacity" values="1;.35;1" dur="1.4s" repeatCount="indefinite" />
          </circle>

          {/* Aro metálico de la puerta */}
          <circle cx="60" cy="90" r="34" fill="#eef4fb" stroke="#c3d6ee" strokeWidth="2" />
          <circle cx="60" cy="90" r="30" fill="none" stroke="#b7cbe8" strokeWidth="4" />

          {/* Interior del vidrio (recortado al círculo) */}
          <defs>
            <clipPath id="sol-glass">
              <circle cx="60" cy="90" r="26" />
            </clipPath>
          </defs>
          <g clipPath="url(#sol-glass)">
            <rect x="34" y="64" width="52" height="52" fill="#cfeaff" />

            {/* Tambor girando: agujeros + ropa */}
            <g style={{ transformBox: 'view-box', transformOrigin: '60px 90px', animation: 'sol-drum 2.4s linear infinite' }}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
                const r = 21;
                const x = 60 + r * Math.cos((a * Math.PI) / 180);
                const y = 90 + r * Math.sin((a * Math.PI) / 180);
                return <circle key={a} cx={x} cy={y} r="2" fill="#9fccf3" />;
              })}
              <rect x="49" y="81" width="16" height="11" rx="5" fill="#ffffff" transform="rotate(18 57 86)" />
              <rect x="58" y="90" width="15" height="10" rx="5" fill="#ffd27f" transform="rotate(-24 65 95)" />
              <rect x="50" y="92" width="13" height="9" rx="4.5" fill="#7fb2ff" transform="rotate(40 56 96)" />
            </g>

            {/* Burbujas subiendo */}
            {[
              { cx: 50, r: 2.6, d: '0s'   },
              { cx: 60, r: 3.2, d: '.5s'  },
              { cx: 69, r: 2.2, d: '.9s'  },
              { cx: 56, r: 2,   d: '1.3s' },
            ].map((b, i) => (
              <circle
                key={i}
                cx={b.cx}
                cy="112"
                r={b.r}
                fill="#ffffff"
                opacity="0.9"
                style={{ animation: `sol-bubble 1.8s ease-in ${b.d} infinite` }}
              />
            ))}
          </g>

          {/* Reflejo del vidrio */}
          <path d="M46 78 A26 26 0 0 1 68 68" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <circle cx="60" cy="90" r="26" fill="none" stroke="#a9c8ea" strokeWidth="2" />
        </svg>

        <div className="text-center">
          <p className="text-base font-bold text-dark-blue">{titulo}…</p>
          {nombre && <p className="text-sm text-gray-500 mt-0.5">{nombre}</p>}
        </div>
      </div>

      <style>{`
        @keyframes sol-drum   { to { transform: rotate(360deg); } }
        @keyframes sol-pop    { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
        @keyframes sol-bubble {
          0%   { transform: translateY(0);    opacity: 0; }
          20%  { opacity: .9; }
          100% { transform: translateY(-30px); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="sol-drum"], [style*="sol-bubble"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
