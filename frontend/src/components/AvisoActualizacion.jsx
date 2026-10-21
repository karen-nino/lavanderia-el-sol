import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  hayQueActualizar, esObligatoria, infoPublicada, aplicarActualizacion,
  esRutaDeConsulta, esMomentoSeguro,
} from '../lib/actualizacion';

/* Cada cuánto se pregunta si hay versión nueva. */
const CADA_CUANTO_MS = 5 * 60 * 1000;
/* Sin tocar la app este rato, en una pantalla de consulta, se actualiza sola. */
const INACTIVIDAD_MS = 10 * 60 * 1000;
/* Un intento automático por versión cada tantos minutos (por si el servidor tarda en servirla). */
const ESPERA_REINTENTO_MS = 5 * 60 * 1000;
const CLAVE_INTENTO = 'actualizacionIntento';
const EVENTOS_USO = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

/**
 * ¿Ya se intentó hace poco actualizar sola a esta versión? Evita recargar en
 * bucle si el servidor aún entrega la app vieja.
 */
function intentoReciente(version) {
  try {
    const previo = JSON.parse(sessionStorage.getItem(CLAVE_INTENTO) || 'null');
    return previo?.version === version && Date.now() - previo.at < ESPERA_REINTENTO_MS;
  } catch {
    return false;
  }
}

/** Anota el intento automático (sin sessionStorage, no se anota). */
function anotarIntento(version) {
  try {
    sessionStorage.setItem(CLAVE_INTENTO, JSON.stringify({ version, at: Date.now() }));
  } catch {
    /* modo privado */
  }
}

/**
 * Versión nueva dentro de la app: barrita con "Actualizar" y, en momentos
 * seguros (cambio de pantalla, volver a la app o un rato sin tocarla en una
 * pantalla de consulta), se actualiza sola. Si la versión ya no sirve
 * (versionMinima), un aviso que no se cierra.
 */
export default function AvisoActualizacion() {
  const { pathname } = useLocation();
  const [info, setInfo] = useState(null);
  const [actualizando, setActualizando] = useState(false);

  const hay = hayQueActualizar(info?.version);
  const obligatoria = hay && esObligatoria(info?.minima);
  /* La última versión publicada, para los efectos (se anota al consultar). */
  const versionRef = useRef(null);

  const actualizar = useCallback(async () => {
    setActualizando(true);
    await aplicarActualizacion();
  }, []);

  /** Actualización automática: una vez por versión cada rato. */
  const actualizarSola = useCallback(() => {
    const version = versionRef.current;
    if (!hayQueActualizar(version) || intentoReciente(version)) return;
    anotarIntento(version);
    actualizar();
  }, [actualizar]);

  /* Pregunta al montar, cada 5 minutos y al volver a la app; al volver, en consulta, se actualiza. */
  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      const datos = await infoPublicada();
      if (vivo && datos) {
        setInfo(datos);
        versionRef.current = datos.version;
      }
    };
    consultar();
    const id = setInterval(consultar, CADA_CUANTO_MS);
    const alVolver = async () => {
      if (document.visibilityState !== 'visible') return;
      await consultar();
      if (vivo && esRutaDeConsulta(window.location.pathname) && esMomentoSeguro()) actualizarSola();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [actualizarSola]);

  /* Al cambiar de pantalla lo de la anterior ya se soltó: se actualiza (no entre secciones de Ajustes). */
  const rutaPrevia = useRef(pathname);
  useEffect(() => {
    const previa = rutaPrevia.current;
    rutaPrevia.current = pathname;
    if (previa === pathname) return;
    if (previa.startsWith('/ajustes') && pathname.startsWith('/ajustes')) return;
    actualizarSola();
  }, [pathname, actualizarSola]);

  /* Un rato sin tocarla, en consulta y sin modal: se actualiza (la tableta fija en Salidas). */
  useEffect(() => {
    if (!hay) return undefined;
    let ultimoUso = Date.now();
    const usar = () => { ultimoUso = Date.now(); };
    EVENTOS_USO.forEach(e => window.addEventListener(e, usar, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - ultimoUso < INACTIVIDAD_MS) return;
      if (esRutaDeConsulta(window.location.pathname) && esMomentoSeguro()) actualizarSola();
    }, 30 * 1000);
    return () => {
      EVENTOS_USO.forEach(e => window.removeEventListener(e, usar));
      clearInterval(id);
    };
  }, [hay, actualizarSola]);

  if (!hay) return null;

  if (obligatoria) {
    return (
      <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
          <h3 className="text-base font-bold text-gray-900">Hay que actualizar la app</h3>
          <p className="text-sm text-gray-600">
            Esta versión ya no funciona bien con el sistema. Actualiza a la versión {info.version} para seguir trabajando.
          </p>
          <button
            type="button"
            onClick={actualizar}
            disabled={actualizando}
            className="w-full py-3.5 text-base font-semibold rounded-xl bg-blue text-white disabled:opacity-60"
          >
            {actualizando ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 bg-light-blue text-dark-blue px-4 py-2.5 flex items-center justify-between gap-3">
      <p className="text-sm min-w-0">
        <span className="font-semibold">Hay una versión nueva</span> ({info.version})
      </p>
      <button
        type="button"
        onClick={actualizar}
        disabled={actualizando}
        className="flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-lg bg-blue text-white disabled:opacity-60"
      >
        {actualizando ? 'Actualizando…' : 'Actualizar'}
      </button>
    </div>
  );
}
