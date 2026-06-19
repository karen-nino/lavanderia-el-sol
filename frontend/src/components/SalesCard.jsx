const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n ?? 0);

export default function SalesCard({ total, label = 'Ventas Hoy' }) {
  return (
    <div className="rounded-xl bg-white p-5 md:p-6 shadow-card">
      <p className="text-kpi-label uppercase tracking-wide text-grey">{label}</p>
      <p className="mt-2 text-[2.75rem] md:text-5xl font-extrabold leading-none text-dark-blue">{fmt(total)}</p>
    </div>
  );
}
