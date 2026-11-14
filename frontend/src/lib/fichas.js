// Textos del inventario de fichas (aparte para Fast Refresh).

/** "1 ficha", "2 fichas". */
export const textoFichas = (n) => `${n} ${Math.abs(Number(n)) === 1 ? 'ficha' : 'fichas'}`;

/** ¿Al iniciarla se elige cuántas fichas? Solo si su modelo admite más de una; si no, lleva 1 sin preguntar. */
export const eligeFichas = (m) => Boolean(m?.pide_fichas) && (Number(m?.max_fichas) || 3) > 1;

/**
 * Grupos por tipo de ficha (mig. 179): { clave, nombre, disponibles, dentro,
 * maquinas }. "Sin tipo" (el conteo general) solo si alguna máquina no tiene
 * tipo, si tiene fichas o si no hay tipos.
 */
export function gruposDeFichas(resumen) {
  const grupos = resumen.tipos.map(t => ({
    clave: t.id, nombre: t.nombre, disponibles: t.disponibles, dentro: t.dentro,
    maquinas: resumen.maquinas.filter(m => m.ficha_tipo_id === t.id),
  }));
  const sueltas = resumen.maquinas.filter(m => m.ficha_tipo_id == null);
  if (grupos.length === 0 || sueltas.length > 0 || resumen.disponibles !== 0) {
    grupos.push({
      clave: 'sin', nombre: grupos.length === 0 ? 'Disponibles' : 'Sin tipo', disponibles: resumen.disponibles,
      dentro: sueltas.reduce((t, m) => t + m.fichas_dentro, 0), maquinas: sueltas,
    });
  }
  return grupos;
}

/**
 * Las disponibles que usa la máquina `maquinaId` al iniciarla: las de su tipo,
 * o las sin tipo si no tiene (o no está). `resumen` viene de GET /fichas.
 */
export function disponiblesDeMaquina(resumen, maquinaId) {
  const m = resumen?.maquinas?.find(x => x.id === Number(maquinaId));
  if (!m) return resumen?.disponibles ?? null;
  if (m.ficha_tipo_id == null) return resumen.disponibles;
  return resumen.tipos.find(t => t.id === m.ficha_tipo_id)?.disponibles ?? null;
}
