import { useState } from 'react';
import { api } from '../lib/api';
import { textoFichas, gruposDeFichas } from '../lib/fichas';
import { IconoFicha } from './ElegirFichasModal';
import HistorialFichas from './HistorialFichas';
import FichasMaquinaModal from './FichasMaquinaModal';
import FichasPorTurno from './FichasPorTurno';
import ConfirmacionModal from './ConfirmacionModal';

const th = 'px-4 py-2.5 font-medium whitespace-nowrap';
const td = 'px-4 py-2.5 whitespace-nowrap';

/**
 * Página Fichas: las que hay de cada tipo, las que quedaron dentro de cada
 * máquina (se recogen aquí) y el historial. `resumen` viene de GET /fichas; `onResumen` recibe el nuevo.
 */
export default function FichasPanel({ resumen, onResumen, esAdmin }) {
  const [recogiendo, setRecogiendo] = useState(null); // id de máquina o 'todas'
  const [error, setError] = useState('');
  // Recoger pide confirmación: la máquina (o null = todas) que se va a vaciar.
  const [porRecoger, setPorRecoger] = useState(undefined);
  /* La máquina cuyas fichas se ven en el modal (su id: tras recoger se toma la del resumen nuevo). */
  const [viendoId, setViendoId] = useState(null);

  if (!resumen) return null;
  const grupos = gruposDeFichas(resumen);
  const conTipos = resumen.tipos.length > 0;
  const negativo = grupos.some(g => g.disponibles < 0);
  /* El grupo (tipo) de una máquina, para "Disponibles después". */
  const grupoDe = (m) => grupos.find(g => g.maquinas.some(x => x.id === m.id));
  const nombreTipo = (m) => resumen.tipos.find(t => t.id === m.ficha_tipo_id)?.nombre ?? 'Sin tipo';
  /* Secciones de la tabla: primero lavadoras, luego secadoras (solo las que tienen máquinas). */
  const secciones = [
    { clave: 'lavadora', nombre: 'Lavadoras', maquinas: resumen.maquinas.filter(m => m.tipo !== 'secadora') },
    { clave: 'secadora', nombre: 'Secadoras', maquinas: resumen.maquinas.filter(m => m.tipo === 'secadora') },
  ].filter(sec => sec.maquinas.length > 0);

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
          Un conteo en negativo no cuadra: {esAdmin ? 'recoge las fichas o fija cuántas hay en Ajustes → Fichas' : 'avisa a un admin para que recoja las fichas'}.
        </p>
      )}

      {/* Las máquinas de fichas, con las que tienen dentro. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-dark-blue">Máquinas</h2>
          {/* Recoger es solo del admin (el backend también lo exige). */}
          {esAdmin && resumen.dentro > 0 && (
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
          /* Tabla seccionada por lavadoras y secadoras; el tipo de ficha se ve al abrir la máquina. */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className={th}>Máquina</th>
                  <th className={`${th} text-right`}>Dentro</th>
                  {esAdmin && <th className={th}><span className="sr-only">Recoger</span></th>}
                </tr>
              </thead>
              {secciones.map(sec => (
                <tbody key={sec.clave} className="divide-y divide-gray-100">
                  <tr className="bg-gray-50">
                    <td colSpan={esAdmin ? 3 : 2} className="px-4 py-2 text-sm font-semibold text-gray-600">{sec.nombre}</td>
                  </tr>
                  {sec.maquinas.map(m => (
                    <tr key={m.id}>
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => setViendoId(m.id)}
                          className="font-semibold text-blue hover:underline"
                        >
                          {m.nombre}
                        </button>
                      </td>
                      <td className={`${td} text-right`}>
                        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-gray-900">
                          <IconoFicha className="w-4 h-4 text-gray-400" />
                          {textoFichas(m.fichas_dentro)}
                        </span>
                      </td>
                      {esAdmin && (
                        <td className={`${td} text-right`}>
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
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
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

      {/* Las fichas de una máquina: se abre al apretar su nombre. */}
      {(() => {
        const viendo = resumen.maquinas.find(m => m.id === viendoId);
        return viendo && (
          <FichasMaquinaModal
            maquina={viendo}
            nombreTipo={nombreTipo(viendo)}
            conTipos={conTipos}
            recarga={resumen}
            onClose={() => setViendoId(null)}
          />
        );
      })()}

      {/* Por turno de caja: con cuántas empezó, usadas y con cuántas terminó. */}
      <FichasPorTurno recarga={resumen} />

      {/* Historial en tabla, con su período; se recarga tras recoger. */}
      <HistorialFichas recarga={resumen} />

    </div>
  );
}
