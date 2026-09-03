import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import AbrirCajaModal from './AbrirCajaModal';

// Tarjeta de Corte del Dashboard. El botón depende del estado de la caja:
//   • Sin caja abierta → Abrir caja: abre un modal (fondo inicial + nota)
//     que la abre; al confirmar, el botón pasa a Realizar corte.
//   • Con caja abierta → Realizar corte: lleva a Caja → Corte.
export default function CashCutCard() {
  const [abierta, setAbierta] = useState(null); // null = cargando
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let activo = true;
    api.get('/caja/actual')
      .then((d) => { if (activo) setAbierta(!!d?.abierta); })
      .catch(() => { if (activo) setAbierta(false); });
    return () => { activo = false; };
  }, []);

  // Acento de color e ícono según el estado (verde = abrir, rojo = corte), en
  // línea con el resto de la app (verde = caja abierta, rojo = cerrar). Durante
  // la carga (abierta === null) se muestra el estado de abrir.
  const abrir = !abierta;
  const accent = abrir
    ? { circle: 'bg-green-50', icon: 'text-green-600', btn: 'bg-green-600 hover:bg-green-700' }
    : { circle: 'bg-red-50',   icon: 'text-red-600',   btn: 'bg-red-600 hover:bg-red-700' };

  return (
    <div className="rounded-card bg-white p-card-pad py-12 shadow-card flex flex-col items-center gap-3">
      <div className={`w-16 h-16 rounded-pill flex items-center justify-center ${accent.circle}`}>
        {abrir ? (
          // Billetes: el fondo inicial que se ingresa al abrir la caja.
          <svg className={`w-9 h-9 ${accent.icon}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        ) : (
          // Moneda $: el dinero que se cuenta al hacer el corte.
          <svg className={`w-9 h-9 ${accent.icon}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>
      <div className="text-center">
        <p className="text-card-title text-dark-blue">{abierta ? 'Corte de Caja' : 'Abrir Caja'}</p>
        <p className="text-kpi-label text-grey mt-1">
          {abierta
            ? 'Cerrar el día y revisar ventas'
            : 'Registra el fondo inicial para empezar el día'}
        </p>
      </div>

      {abierta ? (
        <Link
          to="/caja?tab=corte"
          className={`w-1/2 text-center text-white text-section py-3 rounded-3xl transition-colors ${accent.btn}`}
        >
          Realizar corte
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={abierta === null}
          className={`w-1/2 text-center text-white text-section py-3 rounded-3xl transition-colors disabled:opacity-60 ${accent.btn}`}
        >
          Abrir caja
        </button>
      )}

      <AbrirCajaModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAbierta={() => { setModalOpen(false); setAbierta(true); }} // el botón pasa a Realizar corte
      />
    </div>
  );
}
