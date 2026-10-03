// Aviso sonoro de máquina en TODA la app (2026-10-03): suena en cualquier
// pantalla, no solo en Máquinas, porque el empleado puede estar haciendo una
// nota. Cubre los dos modos:
//
//   · Cronómetro: cuenta hacia arriba hasta que alguien la finaliza; si nadie
//     lo hace, al llegar a su tope el corte le quita la luz. Suena ahí.
//   · Temporizador (MAQUINAS_CRONOMETRO=off): suena cuando el ciclo de una
//     máquina con nota termina —la tarjeta pasa a verde—. Antes este aviso
//     vivía solo en la pantalla de Máquinas (MaquinasEnUso).
//
// En los dos casos el momento es el mismo: se cumplieron los minutos sellados
// al arrancar (`ciclo_minutos`). Lo que suena es avisoSonoro.js.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { prepararAviso, reproducirAvisoCiclo } from './avisoSonoro';

const REFRESCO_MS = 30_000; // cada cuánto se vuelve a pedir la lista de máquinas
const REVISION_MS = 5_000;  // cada cuánto se compara con el reloj

// Máquinas que ya cumplieron su tiempo, como claves "id:en_uso_desde": la
// misma máquina en otro encendido es otra clave, así que vuelve a sonar.
// En uso y con minutos sellados. Una encendida a mano sin nota no tiene carga
// que cuidar; el temporizador, además, solo avisa si una nota la usa (es la
// tarjeta verde de "terminar ciclo").
export function clavesEnTope(maquinas, ahora = Date.now()) {
  return (maquinas ?? [])
    .filter(m => m.estado === 'en_uso' && m.en_uso_desde && Number(m.ciclo_minutos) > 0)
    .filter(m => !(m.encendida_manual_at && !m.en_uso_nota_id))
    .filter(m => m.cronometro || m.en_uso_nota_id)
    .filter(m => new Date(m.en_uso_desde).getTime() + Number(m.ciclo_minutos) * 60_000 <= ahora)
    .map(m => `${m.id}:${m.en_uso_desde}`);
}

// ¿Llegó alguna máquina NUEVA al tope desde la revisión anterior? Sin revisión
// anterior (`previas` null) nunca: al abrir la app no suena por lo que ya
// estaba en tope, solo por lo que llega con la app abierta.
export function hayTopeNuevo(previas, actuales) {
  if (!previas) return false;
  return actuales.some(c => !previas.has(c));
}

export function useAvisoTopeMaquinas() {
  const [maquinas, setMaquinas] = useState(null); // null = aún no cargan
  const previasRef = useRef(null);

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
      if (hayTopeNuevo(previasRef.current, actuales)) reproducirAvisoCiclo();
      previasRef.current = new Set(actuales);
    };
    revisar();
    const id = setInterval(revisar, REVISION_MS);
    return () => clearInterval(id);
  }, [maquinas]);
}
