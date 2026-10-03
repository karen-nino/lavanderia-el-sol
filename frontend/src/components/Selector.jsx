import { useEffect, useState } from 'react';

/**
 * Campo para elegir UNA opción, con el mismo estilo que "Agregar máquina"
 * (2026-10-02): el campo se ve como los demás del formulario y, al tocarlo,
 * abre una ventana con las opciones en tarjetas. Sustituye a los `<select>`
 * nativos de la app, cuya lista la dibuja el sistema operativo y no se parece
 * a nada de lo demás.
 *
 * A diferencia de Agregar máquina se elige una sola cosa, así que tocar una
 * opción la elige y cierra la ventana: no hace falta un botón de confirmar.
 *
 * Props:
 *   valor       — el valor elegido ('' si ninguno).
 *   onChange    — recibe el VALOR, no un evento.
 *   opciones    — [{ valor, etiqueta, detalle?, deshabilitado? }]. `detalle`
 *                 va a la derecha en gris (lo que queda, la marca…). Solo lo
 *                 elegible: el texto de "Seleccionar…" es `marcador`.
 *   marcador    — texto gris del campo mientras no hay nada elegido.
 *   titulo      — título de la ventana (por defecto, la etiqueta aria).
 *   requerido   — como `required`: el formulario no se envía sin valor.
 *   deshabilitado, etiquetaAria, id,
 *   claseCampo  — clases del campo para igualar a sus vecinos (INPUT_CLS,
 *                 MOBILE_INPUT_CLS…); sin ella, el tamaño estándar.
 *   alerta      — borde ámbar: falta elegir algo que hace falta.
 */
const CAMPO_BASE = 'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base';

export default function Selector({
  valor,
  onChange,
  opciones = [],
  marcador = 'Seleccionar…',
  titulo,
  requerido = false,
  deshabilitado = false,
  etiquetaAria,
  id,
  claseCampo = CAMPO_BASE,
  alerta = false,
  className = '',
}) {
  const [abierto, setAbierto] = useState(false);
  const actual = String(valor ?? '');
  const elegida = opciones.find(o => String(o.valor) === actual) ?? null;

  // Esc cierra la ventana, como cualquier otro modal de la app.
  useEffect(() => {
    if (!abierto) return undefined;
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [abierto]);

  const elegir = (o) => {
    if (o.deshabilitado) return;
    setAbierto(false);
    if (String(o.valor) !== actual) onChange(o.valor);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        disabled={deshabilitado}
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        // El nombre del campo y lo elegido: "Rol: Empleado".
        aria-label={etiquetaAria ? `${etiquetaAria}: ${elegida?.etiqueta ?? marcador}` : undefined}
        className={`${claseCampo} text-left flex items-center justify-between gap-2 transition-colors
          ${deshabilitado
            ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
            : `bg-white hover:border-gray-400 ${alerta ? '!border-amber-300' : ''}`}`}
      >
        <span className={`truncate ${elegida ? (deshabilitado ? 'text-gray-500' : 'text-gray-900') : 'text-gray-400'}`}>
          {elegida?.etiqueta ?? marcador}
        </span>
        <svg className="w-5 h-5 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* `required` sin <select>: un campo invisible encima del botón lleva la
          validación del navegador, que así sigue avisando en su sitio. */}
      {requerido && (
        <input
          tabIndex={-1} aria-hidden="true" required
          value={actual} onChange={() => {}}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        />
      )}

      {abierto && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          // Muchos selectores viven dentro de otra ventana (alta de empleado,
          // de máquina…): el clic en el fondo cierra solo ESTA, no la de atrás.
          onClick={(e) => { e.stopPropagation(); setAbierto(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={titulo ?? etiquetaAria ?? marcador}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-base font-bold text-gray-900">{titulo ?? etiquetaAria ?? marcador}</h3>

            {opciones.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay opciones.</p>
            ) : (
              <div className="space-y-2" role="listbox">
                {opciones.map(o => {
                  const puesta = String(o.valor) === actual;
                  return (
                    <button
                      key={String(o.valor)}
                      type="button"
                      role="option"
                      aria-selected={puesta}
                      disabled={o.deshabilitado}
                      onClick={() => elegir(o)}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                        puesta ? 'border-blue bg-light-blue'
                          : o.deshabilitado ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                          : 'border-gray-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          puesta ? 'border-blue bg-blue text-white' : 'border-gray-300 bg-white'
                        }`}>
                          {puesta && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span className="font-medium text-gray-800 truncate">{o.etiqueta}</span>
                      </span>
                      {o.detalle && (
                        <span className="text-xs text-gray-500 flex-shrink-0">{o.detalle}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
