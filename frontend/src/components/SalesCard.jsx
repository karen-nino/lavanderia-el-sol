import { Link } from 'react-router-dom';

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n ?? 0);

export default function SalesCard({ total, label = 'Ventas Hoy', to }) {
  const baseCls = 'rounded-xl bg-white p-5 md:p-6 shadow-card';

  const contenido = (
    <>
      <p className="text-kpi-label uppercase tracking-wide text-grey">{label}</p>
      <p className="mt-2 text-[2.75rem] md:text-5xl font-extrabold leading-none text-dark-blue">{fmt(total)}</p>
    </>
  );

  // Con `to`, la tarjeta navega y muestra feedback al pasar el cursor.
  if (to) {
    return (
      <Link
        to={to}
        className={`${baseCls} block text-left transition-transform hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue/40`}
      >
        {contenido}
      </Link>
    );
  }

  return <div className={baseCls}>{contenido}</div>;
}
