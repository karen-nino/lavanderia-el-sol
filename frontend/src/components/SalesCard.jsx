const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n ?? 0);

export default function SalesCard({ total, label = 'Ventas Hoy' }) {
  return (
    <div className="rounded-card bg-light-blue p-card-pad shadow-card">
      <p className="text-kpi-label uppercase tracking-wide text-blue">{label}</p>
      <p className="mt-2 text-sales-amount text-dark-blue">{fmt(total)}</p>
    </div>
  );
}
