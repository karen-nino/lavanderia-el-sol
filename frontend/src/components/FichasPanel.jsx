import { useState } from 'react';
import { api } from '../lib/api';
import { textoFichas, gruposDeFichas } from '../lib/fichas';
import { IconoFicha } from './ElegirFichasModal';
import HistorialFichas from './HistorialFichas';
import ConfirmacionModal from './ConfirmacionModal';

/** Tipo y tamaño de la máquina: "Secadora mediana", "Lavadora chica". */
const tipoMaquina = (m) => {
  const tipo = m.tipo === 'secadora' ? 'Secadora' : 'Lavadora';
  return m.tamano ? `${tipo} ${m.tamano}` : tipo;
};

/**
 * Página Fichas: las que hay de cada tipo, las que quedaron dentro de cada
 * máquina (se recogen aquí) y el historial. `resumen` viene de GET /fichas; `onResumen` recibe el nuevo.
 */
export default function FichasPanel({ resumen, onResumen, esAdmin }) {
  const [recogiendo, setRecogiendo] = useState(null); // id de máquina o 'todas'
  const [error, setError] = useState('');
  // Recoger pide confirmación: la máquina (o null = todas) que se va a vaciar.
  const [porRecoger, setPorRecoger] = useState(undefined);

  if (!resumen) return null;
  const grupos = gruposDeFichas(resumen);
  const conTipos = resumen.tipos.length > 0;
  const negativo = grupos.some(g => g.disponibles < 0);
  /* El grupo (tipo) de una máquina, para "Disponibles después". */
  const grupoDe = (m) => grupos.find(g => g.maquinas.some(x => x.id === m.id));

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

      {/* Una tarjeta por tipo: las que hay para usar y las que esperan a recogerse. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {grupos.map(g => (
          <div key={g.clave} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500 truncate">{g.nombre}</p>
            <p className={`text-3xl font-bold tabular-nums ${g.disponibles < 0 ? 'text-red-600' : 'text-gray-900'}`}>{g.disponibles}</p>
            <p className="text-sm text-gray-500 mt-1">
              {g.dentro > 0 ? `${textoFichas(g.dentro)} dentro` : 'Ninguna dentro'}
            </p>
          </div>
        ))}
      </div>
      {negativo && (
        <p className="text-sm text-red-600">
          Un conteo en negativo no cuadra: recoge las fichas{esAdmin ? ' o fija cuántas hay en Ajustes → Fichas' : ''}.
        </p>
      )}

      {/* Las máquinas de fichas por tipo, con las que tienen dentro. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-dark-blue">Máquinas</h2>
          {resumen.dentro > 0 && (
            <button
              type="button"
              onClick={() => { setError(''); setPorRecoger(null); }}
              disabled={recogiendo != null}
              className="text-sm font-medium text-blue hover:underline disabled:opacity-60"
            >
              {recogiendo === 'todas' ? 'Recogiendo…' : `Recoger todas (${resumen.dentro})`}
            </button>
          )}
        </div>
        {resumen.maquinas.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">No hay máquinas que trabajen con fichas en esta sucursal.</p>
        ) : (
          grupos.filter(g => g.maquinas.length > 0).map(g => (
            <div key={g.clave}>
              {conTipos && (
                <p className="px-5 py-2 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-600">{g.nombre}</p>
              )}
              <div className="divide-y divide-gray-100 border-b border-gray-100 last:border-b-0">
                {g.maquinas.map(m => (
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
            </div>
          ))
        )}
      </div>

      {/* Advertencia antes de recoger: las fichas pasan de la máquina a las de su tipo. */}
      {porRecoger !== undefined && (() => {
        const cantidad = porRecoger ? porRecoger.fichas_dentro : resumen.dentro;
        /* "Disponibles después" de un solo tipo: el de la máquina, o el único que hay. */
        const grupo = porRecoger ? grupoDe(porRecoger) : (grupos.length === 1 ? grupos[0] : null);
        return (
          <ConfirmacionModal
            tono="aviso"
            titulo={porRecoger ? `Recoger fichas de ${porRecoger.nombre}` : 'Recoger todas las fichas'}
            mensaje={porRecoger
              ? `Hazlo cuando ya hayas sacado las fichas de ${porRecoger.nombre}: pasan a las disponibles y no se puede deshacer.`
              : 'Hazlo cuando ya hayas sacado las fichas de todas las máquinas: pasan a las disponibles y no se puede deshacer.'}
            detalle={[
              { etiqueta: porRecoger ? 'Dentro de la máquina' : 'Dentro de las máquinas', valor: textoFichas(cantidad) },
              grupo && {
                etiqueta: conTipos ? `${grupo.nombre} después` : 'Disponibles después',
                valor: textoFichas(grupo.disponibles + cantidad),
              },
            ].filter(Boolean)}
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
