/**
 * Aviso sonoro de fin de ciclo en cualquier pantalla (lo monta el Layout):
 * - Cronómetro: al llegar al tope (y al cumplir el programa elegido al iniciar).
 * - Temporizador (MAQUINAS_CRONOMETRO=off): al terminar el ciclo de una máquina
 *   con nota.
 * El momento es cuando se cumplen los minutos sellados (`ciclo_minutos`).
 */
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { prepararAviso, reproducirAvisoCiclo } from './avisoSonoro';

const REFRESCO_MS = 30_000; // cada cuánto se vuelve a pedir la lista de máquinas
// Cada segundo: la máquina se finaliza sola poco después de su tope, y el
// sonido tiene que ganarle al refresco que la quita de la lista.
const REVISION_MS = 1_000;  // cada cuánto se compara con el reloj

/**
 * Claves "id:en_uso_desde" de las máquinas que cumplieron su tiempo (otro
 * encendido es otra clave y vuelve a sonar). No cuentan las encendidas a mano
 * sin nota; con temporizador, solo las que usa una nota.
 */
export function clavesEnTope(maquinas, ahora = Date.now()) {
  const vivas = (maquinas ?? [])
    .filter(m => m.estado === 'en_uso' && m.en_uso_desde)
    .filter(m => !(m.encendida_manual_at && !m.en_uso_nota_id));
  const cumplio = (m, minutos) =>
    new Date(m.en_uso_desde).getTime() + Number(minutos) * 60_000 <= ahora;
  // El tope del reloj, igual que TOPE_RELOJ del backend: con "Otra ficha" de
  // la secadora de fichas (minutos_pagados) se recorre al fin elegido.
  const tope = (m) => (m.minutos_pagados
    ? Math.max(Number(m.ciclo_minutos), Number(m.ciclo_elegido_minutos) || 0)
    : Number(m.ciclo_minutos));
  // La máquina con nota se finaliza sola tras su tope (jobs/finalizarAlTope.js):
  // el sonido avisa que la tarjeta se va. Por eso también suenan las de fichas.
  const topes = vivas
    .filter(m => Number(m.ciclo_minutos) > 0)
    .filter(m => m.cronometro || m.en_uso_nota_id)
    .filter(m => cumplio(m, tope(m)))
    .map(m => `${m.id}:${m.en_uso_desde}`);
  // Programa cumplido: otra clave de la misma vuelta, así suena una vez por cada uno.
  const programas = vivas
    .filter(m => m.cronometro && Number(m.ciclo_elegido_minutos) > 0)
    .filter(m => cumplio(m, m.ciclo_elegido_minutos))
    // Con "Otra ficha" (Sec49) el fin se mueve: el fin nuevo vuelve a sonar.
    .map(m => `${m.id}:${m.en_uso_desde}:programa`
      + (m.minutos_pagados ? `:${m.ciclo_elegido_minutos}` : ''));
  return [...topes, ...programas];
}

/**
 * ¿Llegó alguna máquina nueva al tope? Sin revisión anterior (`previas` null)
 * no: al abrir la app no suena lo que ya estaba en tope.
 */
export function hayTopeNuevo(previas, actuales) {
  if (!previas) return false;
  return actuales.some(c => !previas.has(c));
}

/**
 * @param sonar el interruptor "Sonido de fin de ciclo" de Ajustes. Apagado se
 *   siguen llevando las cuentas, para no sonar de golpe al encenderlo.
 */
export function useAvisoTopeMaquinas(sonar = true) {
  const [maquinas, setMaquinas] = useState(null); // null = aún no cargan
  const previasRef = useRef(null);
  const sonarRef = useRef(sonar);
  useEffect(() => { sonarRef.current = sonar; }, [sonar]);

  useEffect(() => {
    prepararAviso();
    let activo = true;
    const cargar = () => {
      api.get('/maquinas')
        .then(data => { if (activo && Array.isArray(data)) setMaquinas(data); })
        .catch(() => {}); // sin red: se reintenta en la siguiente vuelta
    };
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => { activo = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (maquinas == null) return;
    const revisar = () => {
      const actuales = clavesEnTope(maquinas);
      if (hayTopeNuevo(previasRef.current, actuales) && sonarRef.current) reproducirAvisoCiclo();
      previasRef.current = new Set(actuales);
    };
    revisar();
    const id = setInterval(revisar, REVISION_MS);
    return () => clearInterval(id);
  }, [maquinas]);
}
