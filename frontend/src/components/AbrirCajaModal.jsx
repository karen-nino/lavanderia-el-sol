import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import FondoApertura from './FondoApertura';

// Modal para abrir la caja del día (fondo inicial + nota). Es el mismo que se
// usa desde el Dashboard y desde el aviso de Nueva Nota, para que abrir caja se
// vea y funcione igual en toda la app.
//   • open      → si se muestra
//   • onClose   → cerrar sin abrir
//   • onAbierta → se llama cuando la caja ya quedó abierta (también si el
//                 servidor responde que ya lo estaba)
export default function AbrirCajaModal({ open, onClose, onAbierta }) {
  // `?? {}`: la tarjeta del Dashboard se renderiza en pruebas sin AuthProvider.
  const { usuario } = useAuth() ?? {};
  const admin = esAdminFn(usuario?.rol);
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // El fondo sale del corte anterior; se consulta al abrir el modal.
  const [sugerida, setSugerida] = useState(null);
  const [cargando, setCargando] = useState(false);

  // Cada vez que se abre, empieza en limpio y trae el fondo del corte anterior.
  useEffect(() => {
    if (!open) return;
    setMonto('');
    setNotas('');
    setError(null);
    setSugerida(null);
    setCargando(true);
    let activo = true;
    api.get('/caja/actual')
      .then(data => {
        if (!activo) return;
        const s = data?.apertura_sugerida ?? null;
        setSugerida(s);
        if (s) setMonto(String(s.monto));
      })
      .catch(err => { if (activo) setError(err.message); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [open]);

  if (!open) return null;

  const cerrar = () => { if (!saving) onClose(); };

  const submitApertura = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/abrir', { monto_inicial: Number(monto), notas });
      onAbierta();
    } catch (err) {
      // Si ya había una caja abierta (409), igual reflejamos ese estado.
      if (/abierta/i.test(err.message)) onAbierta();
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={cerrar}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Abrir caja</h2>
          <button
            type="button"
            onClick={cerrar}
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
          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
            </div>
          ) : (
            <FondoApertura sugerida={sugerida} admin={admin} monto={monto} onMonto={setMonto} />
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nota (opcional)</label>
            <textarea
              rows={4} value={notas} onChange={(e) => setNotas(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base resize-y min-h-[6rem]"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={cerrar}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving || cargando || (!sugerida && !admin)}
              className="flex-1 bg-blue text-white font-medium py-3 rounded-lg text-base hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? 'Abriendo…' : 'Abrir caja'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
