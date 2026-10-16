import { Link } from 'react-router-dom';

const VARIANT = {
  blue:   { container: 'bg-light-blue',   value: 'text-blue'   },
  green:  { container: 'bg-light-green',  value: 'text-green'  },
  red:    { container: 'bg-light-red',    value: 'text-red'    },
  bronce: { container: 'bg-light-bronce', value: 'text-bronce' },
};

export default function KpiCard({ label, sublabel, sublabelCorto, value, color = 'blue', icon, to }) {
  const v = VARIANT[color] ?? VARIANT.blue;
  /* Cuadrada en celular angosto, alto fijo desde 500 px y 16/9 desde lg. */
  /* w-full: sin él, el alto mínimo ensancha la tarjeta y se enciman. */
  /* Sin overflow-hidden: si el texto no cabe, crece y la fila se empareja. */
  const baseCls = `relative w-full self-stretch aspect-square min-[500px]:aspect-auto min-[500px]:min-h-[9rem] lg:aspect-[16/9] rounded-xl p-4 lg:p-5 pb-5 shadow-card flex flex-col justify-end ${v.container}`;

  const contenido = (
    <>
      {icon && (
        <span className={`absolute top-3.5 right-3.5 lg:top-4 lg:right-4 w-11 h-11 min-[400px]:w-16 min-[400px]:h-16 md:w-10 md:h-10 lg:w-12 lg:h-12 opacity-50 ${v.value}`}>
          {icon}
        </span>
      )}

      <div className="flex flex-col">
        <p className={`font-extrabold leading-none text-4xl min-[400px]:text-5xl md:text-4xl mb-2 md:mb-1 ${v.value}`}>
          {value}
        </p>
        <p className="text-sm leading-tight text-dark-grey">{label}</p>
        <p className="text-base min-[360px]:text-lg md:text-base lg:text-lg font-bold leading-tight text-dark-blue">
          {/* Abajo de 368 px el texto largo se parte en dos líneas: va el corto. */}
          {sublabelCorto ? (
            <>
              <span className="min-[368px]:hidden">{sublabelCorto}</span>
              <span className="hidden min-[368px]:inline">{sublabel}</span>
            </>
          ) : sublabel}
        </p>
      </div>
    </>
  );

  // Con `to`, navega como botón; sin él, tarjeta estática.
  if (to) {
    return (
      <Link
        to={to}
        className={`${baseCls} text-left transition-transform hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue/40`}
      >
        {contenido}
      </Link>
    );
  }

  return <div className={baseCls}>{contenido}</div>;
}
