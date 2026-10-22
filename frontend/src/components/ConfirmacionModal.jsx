/**
 * Advertencia antes de una acción que no se deshace o que mueve hardware, con
 * el aspecto de la app (en lugar del `confirm()` del navegador).
 *
 * @param tono 'peligro' (rojo, algo se pierde) | 'aviso' (ámbar, algo se mueve).
 * @param titulo qué se va a hacer, con el nombre de la cosa.
 * @param mensaje la consecuencia principal, en una frase.
 * @param puntos consecuencias sueltas; las vacías se ignoran.
 * @param detalle filas [{ etiqueta, valor }] para lo que hay que ver en números.
 * @param children contenido propio debajo del mensaje (opcional).
 * @param textoConfirmar el verbo del botón.
 * @param procesando deshabilita los botones mientras corre.
 * @param error respuesta del servidor si falló; va dentro del modal para que se vea.
 * @param onConfirm sin él, el modal solo avisa: un único botón "Entendido" que cierra.
 */
const TONOS = {
  peligro: {
    circulo: 'bg-red-100',
    icono:   'text-red-600',
    boton:   'bg-red-600 hover:bg-red-700',
  },
  aviso: {
    circulo: 'bg-amber-100',
    icono:   'text-amber-600',
    boton:   'bg-amber-500 hover:bg-amber-600',
  },
};

export default function ConfirmacionModal({
  tono = 'peligro',
  titulo,
  mensaje,
  puntos = [],
  detalle = [],
  children,
  textoConfirmar = 'Continuar',
  procesando = false,
  error = '',
  onClose,
  onConfirm,
}) {
  const t = TONOS[tono] ?? TONOS.peligro;
  const lista = puntos.filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className={`flex items-center justify-center w-12 h-12 rounded-full ${t.circulo} mx-auto mb-4`}>
            <svg className={`w-6 h-6 ${t.icono}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 text-center mb-1">{titulo}</h3>
          {mensaje && (
            <p className="text-sm text-gray-500 text-center mb-4">{mensaje}</p>
          )}
          {children}
          {lista.length > 0 && (
            <ul className="text-sm text-gray-600 space-y-2 mb-4">
              {lista.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="text-gray-400">•</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {detalle.length > 0 && (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm mb-4">
              {detalle.map((d) => (
                <div key={d.etiqueta} className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">{d.etiqueta}</span>
                  <span className="font-semibold text-gray-900">{d.valor}</span>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
              {error}
            </div>
          )}
          {!onConfirm ? (
            <button type="button" onClick={onClose}
              className={`w-full ${t.boton} text-white font-medium py-3.5 rounded-lg text-base transition-colors`}>
              Entendido
            </button>
          ) : (
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={procesando}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={onConfirm} disabled={procesando}
              className={`flex-1 ${t.boton} disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors`}>
              {textoConfirmar}
            </button>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
