import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import ElegirTiempoModal from './ElegirTiempoModal';
import { textoFichas } from '../lib/fichas';

/** Ficha: una moneda con su marca. */
export const IconoFicha = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" strokeWidth={2} />
    <circle cx="12" cy="12" r="5" strokeWidth={2} />
  </svg>
);

/**
 * "¿Cuántas fichas?" al iniciar una máquina que trabaja con fichas (inventario
 * de fichas de la sucursal): 1, 2 o 3. Dice cuántas quedan; si no alcanzan, la
 * máquina arranca igual y el conteo queda en negativo.
 */
export default function ElegirFichasModal({ maquina, guardando = false, error = '', onElegir, onCancelar }) {
  const [disponibles, setDisponibles] = useState(null);
  useEffect(() => {
    if (!maquina) return undefined;
    let vigente = true;
    api.get('/fichas')
      .then(d => { if (vigente) setDisponibles(d?.disponibles ?? null); })
      .catch(() => { /* sin el conteo se puede elegir igual */ });
    return () => { vigente = false; };
  }, [maquina]);

  if (!maquina) return null;
  const quedan = disponibles == null ? null
    : disponibles < 3
      ? `Quedan ${textoFichas(disponibles)}: si usas más, el conteo queda en negativo hasta que las recojan o lo corrijan en Inventario → Fichas.`
      : `Quedan ${textoFichas(disponibles)} en la sucursal.`;
  return (
    <ElegirTiempoModal
      maquina={maquina}
      tiempos={[1, 2, 3]}
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
