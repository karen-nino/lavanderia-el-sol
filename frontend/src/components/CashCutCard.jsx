import { Link } from 'react-router-dom';

export default function CashCutCard({ to = '/ventas' }) {
  return (
    <div className="rounded-card bg-light-blue p-card-pad shadow-card flex flex-col items-center gap-3">
      <div className="w-14 h-14 rounded-pill bg-light-blue flex items-center justify-center">
        <svg className="w-7 h-7 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12m-7 3a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-card-title text-dark-blue">Corte de Caja</p>
        <p className="text-kpi-label text-grey mt-1">Cerrar el día y revisar ventas</p>
      </div>
      <Link
        to={to}
        className="w-1/2 text-center bg-blue text-white text-section py-3 rounded-3xl hover:opacity-90 transition-opacity"
      >
        Realizar corte
      </Link>
    </div>
  );
}
