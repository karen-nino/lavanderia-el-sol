import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import ElegirTiempoModal from './ElegirTiempoModal';
import { textoFichas, disponiblesDeMaquina } from '../lib/fichas';

/** Ficha: una moneda con su marca. */
export const IconoFicha = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" strokeWidth={2} />
    <circle cx="12" cy="12" r="5" strokeWidth={2} />
  </svg>
);

/**
 * "¿Cuántas fichas?" al iniciar una máquina que trabaja con fichas (inventario
 * de fichas de la sucursal): de 1 al máximo de su modelo (3 sin dato). Dice
 * cuántas quedan de su tipo de ficha; si no alcanzan, la máquina arranca igual
 * y el conteo queda en negativo.
 */
export default function ElegirFichasModal({ maquina, guardando = false, error = '', onElegir, onCancelar }) {
  /* El conteo es de la máquina que lo pidió: si se abre para otra, no se usa el anterior. */
  const [conteo, setConteo] = useState(null); // { id, disponibles, tipo }
  /* La de la nota trae `maquina_id` (su `id` es la pasada); la de la lista, `id`. */
  const id = maquina ? Number(maquina.maquina_id ?? maquina.id) : null;
  useEffect(() => {
    if (id == null) return undefined;
    let vigente = true;
    api.get('/fichas')
      .then(d => {
        if (!vigente) return;
        setConteo({
          id,
          disponibles: disponiblesDeMaquina(d, id),
          tipo: d?.maquinas?.find(m => m.id === id)?.ficha_tipo_nombre ?? null,
        });
      })
      .catch(() => { /* sin el conteo se puede elegir igual */ });
    return () => { vigente = false; };
  }, [id, maquina]);
  const disponibles = conteo?.id === id ? conteo.disponibles : null;
  const tipo = conteo?.id === id ? conteo.tipo : null;

  if (!maquina) return null;
  const max = Math.min(3, Math.max(1, Number(maquina.max_fichas) || 3));
  const opciones = Array.from({ length: max }, (_, i) => i + 1);
  const quedan = disponibles == null ? null
    : disponibles < max
      ? `Quedan ${textoFichas(disponibles)}${tipo ? ` de ${tipo}` : ''}: si usas más, el conteo queda en negativo hasta que las recojan o lo corrijan en Fichas.`
      : `Quedan ${textoFichas(disponibles)} ${tipo ? `de ${tipo}` : 'en la sucursal'}.`;
  return (
    <ElegirTiempoModal
      maquina={maquina}
      tiempos={opciones}
      titulo="¿Cuántas fichas?"
      descripcion={`Las que le metes para arrancarla: salen del inventario y quedan dentro de la máquina hasta que las recojan.${quedan ? ` ${quedan}` : ''}`}
      etiqueta={textoFichas}
      icono={<IconoFicha />}
      guardando={guardando}
      error={error}
      onElegir={onElegir}
      onCancelar={onCancelar}
    />
  );
}
