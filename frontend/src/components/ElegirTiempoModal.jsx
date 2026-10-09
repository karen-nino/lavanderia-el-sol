/**
 * Elegir con cuánto tiempo corre un ciclo (mig. 120).
 *
 * Hay modelos que no tienen "un" ciclo sino varios programas de distinta
 * duración —la Speed Queen Sec49 tiene tres— y quién decide cuál corre es el
 * empleado con la ropa delante, no la configuración. Este modal sale justo
 * después de confirmar el arranque, y lo que se elija es lo que cronometra la
 * app y lo que decide cuándo se le corta la corriente.
 *
 * Sale solo cuando el modelo lo pide y tiene más de un tiempo configurado; con
 * uno solo no hay nada que preguntar.
 */
// `titulo`, `descripcion` y `etiqueta` dejan reusarlo para sumar tiempo con
// "Otro ciclo" (Sec49, 2026-10-08).
export default function ElegirTiempoModal({
  maquina, tiempos, guardando = false, error = '', onElegir, onCancelar,
  titulo = '¿Con cuánto tiempo?', descripcion = null, etiqueta = (min) => `${min} min`,
}) {
  if (!maquina) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex-shrink-0 w-9 h-9 rounded-full bg-light-blue text-blue flex items-center justify-center">
            {/* Reloj */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M12 7v5l3 2" />
            </svg>
          </span>
          <div>
            <h3 className="text-base font-bold text-gray-900">{titulo}</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-semibold text-gray-700">{maquina.nombre}</span>
              {maquina.modelo ? ` · ${maquina.modelo}` : ''}
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-500">
          {descripcion ?? (maquina.cronometro
            /* Con cronómetro (mig. 146) el programa solo avisa; el corte es el tope. */
            ? 'Elige el programa con el que la arrancaste. La app te avisa cuando lo cumpla; la corriente se le corta hasta su tope si nadie la finaliza.'
            : 'Elige el programa con el que la arrancaste. La app cronometra ese tiempo y le corta la corriente al terminar.')}
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        {/* Un botón por tiempo. En columna y no en fila: en el teléfono tres
            botones lado a lado quedan estrechos y aquí se aprieta con prisa. */}
        <div className="space-y-2">
          {tiempos.map(min => (
            <button
              key={min}
              type="button"
              disabled={guardando}
              onClick={() => onElegir(min)}
              className="w-full py-3.5 rounded-lg border border-gray-300 text-gray-800 font-medium text-base hover:border-blue hover:bg-light-blue hover:text-blue disabled:opacity-60 transition-colors"
            >
              {etiqueta(min)}
            </button>
          ))}
        </div>

        <button
          type="button" onClick={onCancelar} disabled={guardando}
          className="w-full border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
