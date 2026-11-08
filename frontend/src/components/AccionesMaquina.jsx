import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import ConfirmacionModal from './ConfirmacionModal';
import { ES_DEMO } from '../lib/entorno';

/** En la demo no hay Sonoff: no se ofrece Encender ni Apagar. */
const CON_SONOFF = !ES_DEMO;

/**
 * Menú de opciones (⋮) de una máquina, arriba a la derecha de su Información de uso:
 * Editar, Encender o Apagar (si está prendida a mano) y Eliminar.
 * @param maquina fila completa de GET /maquinas
 * @param sonoffReal true con el driver real (en simulación no se ofrece Apagar)
 * @param onEditar abre el formulario de la máquina
 * @param onActualizada recibe la máquina tras encender o apagar
 * @param onEliminada después de borrarla
 */
export default function AccionesMaquina({ maquina, sonoffReal, onEditar, onActualizada, onEliminada }) {
  const [abierto, setAbierto] = useState(false);
  const [porConfirmar, setPorConfirmar] = useState(null); // 'encender' | 'apagar' | 'eliminar'
  const [procesando, setProcesando] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [abierto]);

  const conSonoff = CON_SONOFF && !maquina.solo_fichas;
  /* Prendida a mano: se ofrece Apagar en vez de Encender. */
  const ofreceApagar = Boolean(maquina.encendida_manual_at) && Boolean(maquina.device_id) && sonoffReal;

  /** Corre la acción confirmada; si falla, recoge la máquina con su error. */
  const ejecutar = async () => {
    setProcesando(true);
    try {
      if (porConfirmar === 'eliminar') {
        await api.delete(`/maquinas/${maquina.id}`);
        onEliminada?.();
        return;
      }
      const r = await api.post(`/maquinas/${maquina.id}/${porConfirmar}-sonoff`, {});
      if (r?.maquina) onActualizada?.(r.maquina);
      alert(r?.message ?? (porConfirmar === 'apagar' ? 'Orden de apagado enviada.' : 'Orden de encendido enviada.'));
    } catch (err) {
      if (err?.data?.maquina) onActualizada?.(err.data.maquina);
      alert(err.message);
    } finally {
      setProcesando(false);
      setPorConfirmar(null);
    }
  };

  const aviso = porConfirmar === 'encender' ? {
    tono: 'aviso',
    titulo: `Encender ${maquina.nombre}`,
    mensaje: 'La máquina arranca de verdad y se queda encendida hasta que la apagues.',
    puntos: [
      'Mientras esté encendida queda ocupada: no se va a poder usar en una nota.',
      'Asegúrate de que nadie la esté cargando ni tenga las manos dentro.',
    ],
    textoConfirmar: procesando ? 'Encendiendo…' : 'Encender',
  } : porConfirmar === 'apagar' ? {
    tono: 'aviso',
    titulo: `Apagar ${maquina.nombre}`,
    mensaje: 'Se le corta la corriente de verdad y vuelve a quedar libre para las notas.',
    puntos: [
      'Si tiene ropa lavándose, el ciclo se detiene a la mitad.',
      'También se ve apagada en la app de eWeLink.',
    ],
    textoConfirmar: procesando ? 'Apagando…' : 'Apagar',
  } : {
    tono: 'peligro',
    titulo: `Eliminar ${maquina.nombre}`,
    mensaje: 'La máquina desaparece del sistema y esto no se puede deshacer.',
    puntos: [
      // nota_cargas apunta a la máquina con ON DELETE SET NULL.
      'Las notas que la usaron, incluso las ya cerradas, dejan de decir en qué máquina se lavó.',
      maquina.estado === 'en_uso'
        && 'Ahora mismo está en uso: la nota que la tiene se queda sin máquina asignada.',
    ],
    textoConfirmar: procesando ? 'Eliminando…' : 'Eliminar',
  };

  const elegir = (accion) => { setAbierto(false); setPorConfirmar(accion); };

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        onClick={() => setAbierto(v => !v)}
        aria-label="Acciones"
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="w-11 h-11 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center justify-center transition-colors"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 w-44"
        >
          <button
            role="menuitem"
            onClick={() => { setAbierto(false); onEditar?.(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-gray-700 hover:bg-light-blue hover:text-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Editar
          </button>
          {/* La de fichas no tiene Sonoff que encender. */}
          {conSonoff && (
            <button
              role="menuitem"
              onClick={() => elegir(ofreceApagar ? 'apagar' : 'encender')}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-gray-700 hover:bg-light-blue hover:text-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v9m6.36-6.36a9 9 0 11-12.72 0" />
              </svg>
              {ofreceApagar ? 'Apagar' : 'Encender'}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => elegir('eliminar')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Eliminar
          </button>
        </div>
      )}

      {porConfirmar && (
        <ConfirmacionModal
          {...aviso}
          procesando={procesando}
          onClose={() => setPorConfirmar(null)}
          onConfirm={ejecutar}
        />
      )}
    </div>
  );
}
