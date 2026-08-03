import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// Tarjeta de Corte del Dashboard. El botón depende del estado de la caja:
//   • Sin caja abierta → Abrir caja: abre un modal (fondo inicial + nota)
//     que la abre; al confirmar, el botón pasa a Realizar corte.
//   • Con caja abierta → Realizar corte: lleva a Caja → Corte.
export default function CashCutCard() {
  const [abierta, setAbierta] = useState(null); // null = cargando
  const [modalOpen, setModalOpen] = useState(false);
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    api.get('/caja/actual')
      .then((d) => { if (activo) setAbierta(!!d?.abierta); })
      .catch(() => { if (activo) setAbierta(false); });
    return () => { activo = false; };
  }, []);

  const abrirModal = () => {
    setMonto('');
    setNotas('');
    setError(null);
    setModalOpen(true);
  };

  const submitApertura = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/abrir', { monto_inicial: Number(monto), notas });
      setModalOpen(false);
      setAbierta(true); // el botón pasa a Realizar corte
    } catch (err) {
      // Si ya había una caja abierta (409), igual reflejamos ese estado.
      if (/abierta/i.test(err.message)) {
        setAbierta(true);
        setModalOpen(false);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

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
          onClick={abrirModal}
          disabled={abierta === null}
          className={`w-1/2 text-center text-white text-section py-3 rounded-3xl transition-colors disabled:opacity-60 ${accent.btn}`}
        >
          Abrir caja
        </button>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Abrir caja</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Cerrar"
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={submitApertura} className="p-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fondo inicial <span className="text-red-500">*</span>
                </label>
                <input
                  type="number" min="0" step="0.01" required autoFocus
                  value={monto} onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nota (opcional)</label>
                <textarea
                  rows={4} value={notas} onChange={(e) => setNotas(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base resize-y min-h-[6rem]"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => setModalOpen(false)}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={saving}
                  className="flex-1 bg-blue text-white font-medium py-3 rounded-lg text-base hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {saving ? 'Abriendo…' : 'Abrir caja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
