import { useState } from 'react';
import { api } from '../lib/api';
import { textoFichas } from '../lib/fichas';
import { IconoFicha } from './ElegirFichasModal';
import HistorialFichas from './HistorialFichas';
import ConfirmacionModal from './ConfirmacionModal';

/** Tipo y tamaño de la máquina: "Secadora mediana", "Lavadora chica". */
const tipoMaquina = (m) => {
  const tipo = m.tipo === 'secadora' ? 'Secadora' : 'Lavadora';
  return m.tamano ? `${tipo} ${m.tamano}` : tipo;
};

/**
 * Página Fichas: las que hay en la sucursal, las que quedaron dentro de
 * cada máquina (se recogen aquí) y los últimos movimientos. `resumen` viene de GET /fichas; `onResumen` recibe el nuevo.
 */
export default function FichasPanel({ resumen, onResumen, esAdmin }) {
  const [recogiendo, setRecogiendo] = useState(null); // id de máquina o 'todas'
  const [error, setError] = useState('');
  // Recoger pide confirmación: la máquina (o null = todas) que se va a vaciar.
  const [porRecoger, setPorRecoger] = useState(undefined);

  if (!resumen) return null;
  const negativo = resumen.disponibles < 0;

  const recoger = async (maquinaId = null) => {
    setRecogiendo(maquinaId ?? 'todas');
    setError('');
    try {
      const r = await api.post('/fichas/recoger', maquinaId ? { maquina_id: maquinaId } : {});
      if (r) {
        onResumen(r);
        setPorRecoger(undefined);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRecogiendo(null);
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
          {negativo && (
            <p className="text-sm text-red-600 mt-1">
              El conteo no cuadra: recoge las fichas{esAdmin ? ' o fija cuántas hay en Ajustes → Fichas' : ''}.
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Dentro de las máquinas</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900">{resumen.dentro}</p>
          {resumen.dentro > 0 && (
            <button
              type="button"
              onClick={() => { setError(''); setPorRecoger(null); }}
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
                    onClick={() => { setError(''); setPorRecoger(m); }}
                    disabled={m.fichas_dentro === 0 || recogiendo != null}
                    /* Con fichas dentro, de color: hay algo que recoger. */
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      m.fichas_dentro > 0
                        ? 'bg-blue text-white hover:opacity-90 disabled:opacity-60'
                        : 'border border-gray-300 text-gray-700 disabled:opacity-40'
                    }`}
                  >
                    {recogiendo === m.id ? 'Recogiendo…' : 'Recoger'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advertencia antes de recoger: las fichas pasan de la máquina a Disponibles. */}
      {porRecoger !== undefined && (() => {
        const cantidad = porRecoger ? porRecoger.fichas_dentro : resumen.dentro;
        return (
          <ConfirmacionModal
            tono="aviso"
            titulo={porRecoger ? `Recoger fichas de ${porRecoger.nombre}` : 'Recoger todas las fichas'}
            mensaje={porRecoger
              ? `Hazlo cuando ya hayas sacado las fichas de ${porRecoger.nombre}: pasan a Disponibles y no se puede deshacer.`
              : 'Hazlo cuando ya hayas sacado las fichas de todas las máquinas: pasan a Disponibles y no se puede deshacer.'}
            detalle={[
              { etiqueta: porRecoger ? 'Dentro de la máquina' : 'Dentro de las máquinas', valor: textoFichas(cantidad) },
              { etiqueta: 'Disponibles después', valor: textoFichas(resumen.disponibles + cantidad) },
            ]}
            textoConfirmar="Recoger"
            procesando={recogiendo != null}
            error={error}
            onClose={() => { setPorRecoger(undefined); setError(''); }}
            onConfirm={() => recoger(porRecoger ? porRecoger.id : null)}
          />
        );
      })()}

      {/* Historial en tabla, con su período; se recarga tras recoger. */}
      <HistorialFichas recarga={resumen} />

    </div>
  );
}
