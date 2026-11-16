import { textoFichas } from '../lib/fichas';
import { IconoFicha } from './ElegirFichasModal';
import HistorialFichas from './HistorialFichas';

/**
 * Las fichas de una máquina (al apretar su nombre en Fichas): su nombre, su tipo de
 * ficha, las que tiene dentro y su historial por período. `recarga` cambia tras recoger.
 */
export default function FichasMaquinaModal({ maquina, nombreTipo, conTipos, recarga, onClose }) {
  if (!maquina) return null;
  const detalle = [
    { etiqueta: 'Máquina', valor: maquina.nombre },
    conTipos && { etiqueta: 'Tipo de ficha', valor: nombreTipo },
    { etiqueta: 'Dentro', valor: textoFichas(maquina.fichas_dentro) },
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label="Cerrar"
          className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2 pr-10">
            <IconoFicha className="w-5 h-5 text-gray-400" />
            <h3 className="text-base font-semibold text-gray-900">Fichas de {maquina.nombre}</h3>
          </div>
          <div className="mt-4 rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            {detalle.map(d => (
              <div key={d.etiqueta} className="flex justify-between gap-3 px-3 py-2">
                <span className="text-gray-500">{d.etiqueta}</span>
                <span className="font-semibold text-gray-900">{d.valor}</span>
              </div>
            ))}
          </div>
        </div>
        <HistorialFichas recarga={recarga} maquinaId={maquina.id} enTarjeta={false} />
      </div>
    </div>
  );
}
