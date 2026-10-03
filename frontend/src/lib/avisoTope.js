// Aviso de tope del cronómetro en TODA la app (2026-10-03).
//
// Con cronómetro, la máquina no tiene "ciclo terminado": cuenta hacia arriba
// hasta que alguien la finaliza, y si nadie lo hace, al llegar a su tope el
// corte le quita la luz. Ese momento tiene que oírse, y no solo con la
// pantalla de Máquinas abierta: el empleado puede estar haciendo una nota.
//
// Lo que suena es el mismo aviso del temporizador (avisoSonoro.js).
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { prepararAviso, reproducirAvisoCiclo } from './avisoSonoro';

const REFRESCO_MS = 30_000; // cada cuánto se vuelve a pedir la lista de máquinas
const REVISION_MS = 5_000;  // cada cuánto se compara con el reloj

// Máquinas que ya llegaron a su tope, como claves "id:en_uso_desde": la misma
// máquina en otro encendido es otra clave, así que vuelve a sonar.
// Solo cronómetro, en uso y con tope; una encendida a mano sin nota no tiene
// carga que cuidar.
export function clavesEnTope(maquinas, ahora = Date.now()) {
  return (maquinas ?? [])
    .filter(m => m.cronometro && m.estado === 'en_uso' && m.en_uso_desde
      && Number(m.ciclo_minutos) > 0 && !m.encendida_manual_at)
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
