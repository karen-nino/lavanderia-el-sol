import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// Tarjeta de Corte del Dashboard. El botón depende del estado de la caja:
//   • Sin caja abierta → "Abrir caja": abre un modal (fondo inicial + nota)
//     que la abre; al confirmar, el botón pasa a "Realizar corte".
//   • Con caja abierta → "Realizar corte": lleva a Caja → Corte.
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
      setAbierta(true); // el botón pasa a "Realizar corte"
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

  return (
    <div className="rounded-card bg-light-blue p-card-pad py-12 shadow-card flex flex-col items-center gap-3">
      <div className="w-16 h-16 rounded-pill bg-light-blue flex items-center justify-center">
        <svg className="w-[3.9375rem] h-[3.9375rem] text-blue" viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fill="currentColor" d="M59.5833 5.41669H5.41665C4.69835 5.41669 4.00948 5.70203 3.50157 6.20994C2.99365 6.71785 2.70831 7.40673 2.70831 8.12502V29.7917C2.70831 30.51 2.99365 31.1989 3.50157 31.7068C4.00948 32.2147 4.69835 32.5 5.41665 32.5H13.5416V56.875C13.5416 57.5933 13.827 58.2822 14.3349 58.7901C14.8428 59.298 15.5317 59.5834 16.25 59.5834H48.75C49.4683 59.5834 50.1572 59.298 50.6651 58.7901C51.173 58.2822 51.4583 57.5933 51.4583 56.875V32.5H59.5833C60.3016 32.5 60.9905 32.2147 61.4984 31.7068C62.0063 31.1989 62.2916 30.51 62.2916 29.7917V8.12502C62.2916 7.40673 62.0063 6.71785 61.4984 6.20994C60.9905 5.70203 60.3016 5.41669 59.5833 5.41669ZM18.9583 54.1667V48.75C20.3949 48.75 21.7727 49.3207 22.7885 50.3365C23.8043 51.3523 24.375 52.7301 24.375 54.1667H18.9583ZM46.0416 54.1667H40.625C40.625 52.7301 41.1957 51.3523 42.2115 50.3365C43.2273 49.3207 44.6051 48.75 46.0416 48.75V54.1667ZM46.0416 43.3334C43.1685 43.3334 40.413 44.4747 38.3813 46.5064C36.3497 48.538 35.2083 51.2935 35.2083 54.1667H29.7916C29.7916 51.2935 28.6503 48.538 26.6186 46.5064C24.587 44.4747 21.8315 43.3334 18.9583 43.3334V21.6667H46.0416V43.3334ZM56.875 27.0834H51.4583V18.9584C51.4583 18.2401 51.173 17.5512 50.6651 17.0433C50.1572 16.5354 49.4683 16.25 48.75 16.25H16.25C15.5317 16.25 14.8428 16.5354 14.3349 17.0433C13.827 17.5512 13.5416 18.2401 13.5416 18.9584V27.0834H8.12498V10.8334H56.875V27.0834ZM32.5 40.625C34.107 40.625 35.6778 40.1485 37.014 39.2557C38.3501 38.3629 39.3915 37.094 40.0065 35.6093C40.6215 34.1247 40.7824 32.491 40.4689 30.9149C40.1554 29.3388 39.3815 27.8911 38.2452 26.7548C37.1089 25.6185 35.6612 24.8446 34.0851 24.5311C32.509 24.2176 30.8753 24.3785 29.3907 24.9935C27.906 25.6085 26.6371 26.6499 25.7443 27.986C24.8515 29.3222 24.375 30.893 24.375 32.5C24.375 34.6549 25.231 36.7215 26.7547 38.2453C28.2785 39.769 30.3451 40.625 32.5 40.625ZM32.5 29.7917C33.0356 29.7917 33.5593 29.9505 34.0046 30.2481C34.45 30.5457 34.7972 30.9687 35.0022 31.4636C35.2071 31.9585 35.2608 32.503 35.1563 33.0284C35.0518 33.5538 34.7938 34.0363 34.4151 34.4151C34.0363 34.7939 33.5537 35.0518 33.0283 35.1563C32.503 35.2608 31.9584 35.2072 31.4635 35.0022C30.9687 34.7972 30.5457 34.4501 30.2481 34.0047C29.9505 33.5593 29.7916 33.0357 29.7916 32.5C29.7916 31.7817 30.077 31.0929 30.5849 30.5849C31.0928 30.077 31.7817 29.7917 32.5 29.7917Z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-card-title text-dark-blue">Caja</p>
        <p className="text-kpi-label text-grey mt-1">Cerrar el día y revisar ventas</p>
      </div>

      {abierta ? (
        <Link
          to="/caja?tab=corte"
          className="w-1/2 text-center bg-blue text-white text-section py-3 rounded-3xl hover:opacity-90 transition-opacity"
        >
          Realizar corte
        </Link>
      ) : (
        <button
          type="button"
          onClick={abrirModal}
          disabled={abierta === null}
          className="w-1/2 text-center bg-blue text-white text-section py-3 rounded-3xl hover:opacity-90 transition-opacity disabled:opacity-60"
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
