import { useState } from 'react';
import { api } from '../lib/api';
import { formatFechaHora12 } from '../lib/fecha';
import { textoFichas } from '../lib/fichas';
import { IconoFicha } from './ElegirFichasModal';

/** Tipo y tamaño de la máquina: "Secadora mediana", "Lavadora chica". */
const tipoMaquina = (m) => {
  const tipo = m.tipo === 'secadora' ? 'Secadora' : 'Lavadora';
  return m.tamano ? `${tipo} ${m.tamano}` : tipo;
};

/** Texto de un movimiento del historial. */
const textoMovimiento = (mv) => {
  if (mv.tipo === 'uso') {
    return `${textoFichas(-mv.cantidad)} a ${mv.maquina_nombre ?? 'una máquina'}${mv.folio ? ` · nota ${mv.folio}` : ''}`;
  }
  if (mv.tipo === 'recoger') return `Recogidas ${textoFichas(mv.cantidad)} de ${mv.maquina_nombre ?? 'una máquina'}`;
  return `Conteo corregido (${mv.cantidad > 0 ? '+' : ''}${mv.cantidad})`;
};

/**
 * Página Fichas: las que hay en la sucursal, las que quedaron dentro de
 * cada máquina (se recogen aquí) y los últimos movimientos. El admin corrige el
 * conteo. `resumen` viene de GET /fichas; `onResumen` recibe el nuevo.
 */
export default function FichasPanel({ resumen, onResumen, esAdmin }) {
  const [recogiendo, setRecogiendo] = useState(null); // id de máquina o 'todas'
  const [error, setError] = useState('');
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [conteo, setConteo] = useState('');
  const [guardando, setGuardando] = useState(false);

  if (!resumen) return null;
  const negativo = resumen.disponibles < 0;

  const recoger = async (maquinaId = null) => {
    setRecogiendo(maquinaId ?? 'todas');
    setError('');
    try {
      const r = await api.post('/fichas/recoger', maquinaId ? { maquina_id: maquinaId } : {});
      if (r) onResumen(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setRecogiendo(null);
    }
  };

  const guardarConteo = async () => {
    setGuardando(true);
    setError('');
    try {
      const r = await api.post('/fichas/ajustar', { disponibles: Number(conteo) });
      if (r) {
        onResumen(r);
        setCorrigiendo(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      {/* Totales: las que hay para usar y las que esperan a recogerse. */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Disponibles</p>
          <p className={`text-3xl font-bold tabular-nums ${negativo ? 'text-red-600' : 'text-gray-900'}`}>{resumen.disponibles}</p>
          {negativo && <p className="text-sm text-red-600 mt-1">El conteo no cuadra: recoge las fichas o corrígelo.</p>}
          {esAdmin && (
            <button
              type="button"
              onClick={() => { setConteo(String(Math.max(0, resumen.disponibles))); setCorrigiendo(true); }}
              className="mt-2 text-sm font-medium text-blue hover:underline"
            >
              Corregir conteo
            </button>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Dentro de las máquinas</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900">{resumen.dentro}</p>
          {resumen.dentro > 0 && (
            <button
              type="button"
              onClick={() => recoger()}
              disabled={recogiendo != null}
              className="mt-2 text-sm font-medium text-blue hover:underline disabled:opacity-60"
            >
              {recogiendo === 'todas' ? 'Recogiendo…' : 'Recoger todas'}
            </button>
          )}
        </div>
      </div>

      {/* Una tarjeta por máquina de fichas, con las que tiene dentro. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-dark-blue">Máquinas</h2>
        </div>
        {resumen.maquinas.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">No hay máquinas que trabajen con fichas en esta sucursal.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {resumen.maquinas.map(m => (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{m.nombre}</p>
                  <p className="text-sm text-gray-500">{tipoMaquina(m)}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-gray-900">
                    <IconoFicha className="w-4 h-4 text-gray-400" />
                    {textoFichas(m.fichas_dentro)}
                  </span>
                  <button
                    type="button"
                    onClick={() => recoger(m.id)}
                    disabled={m.fichas_dentro === 0 || recogiendo != null}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {recogiendo === m.id ? 'Recogiendo…' : 'Recoger'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historial: quién usó, recogió o corrigió, y con cuántas quedó. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-dark-blue">Últimos movimientos</h2>
        </div>
        {resumen.movimientos.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">Aún no hay movimientos.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {resumen.movimientos.map(mv => (
              <div key={mv.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800">{textoMovimiento(mv)}</p>
                  <p className="text-sm text-gray-500">
                    {formatFechaHora12(mv.created_at)}{mv.usuario ? ` · ${mv.usuario}` : ''}
                  </p>
                </div>
                <span className="text-sm text-gray-500 tabular-nums flex-shrink-0">Quedan {mv.disponibles_despues}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {corrigiendo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Corregir conteo</h3>
            <p className="text-sm text-gray-500">Cuenta las fichas que hay para usar (sin las que están dentro de las máquinas) y escribe el total.</p>
            <input
              type="number" inputMode="numeric" min="0" step="1" value={conteo}
              onChange={e => setConteo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue"
            />
            <div className="flex gap-3">
              <button
                type="button" onClick={() => setCorrigiendo(false)} disabled={guardando}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button" onClick={guardarConteo} disabled={guardando || conteo === ''}
                className="flex-1 bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base disabled:opacity-60"
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
