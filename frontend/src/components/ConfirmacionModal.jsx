// Advertencia antes de una acción que no se deshace o que mueve hardware.
//
// Nace de Gestión de Máquinas, donde "Encender" y "Eliminar" se confirmaban con
// el `confirm()` del navegador: en la PWA sale como un diálogo del sistema, sin
// nada del lenguaje de la app, y en el teléfono es fácil despacharlo sin leerlo.
// Este modal usa el mismo patrón que EmpleadoDeleteModal —círculo con ícono,
// título, texto y dos botones— para que una advertencia se vea como una
// advertencia en toda la app.
//
//   tono:           'peligro' (rojo, algo se pierde) | 'aviso' (ámbar, algo se mueve)
//   titulo:         qué se va a hacer, con el nombre de la cosa
//   mensaje:        la consecuencia principal, en una frase
//   puntos:         consecuencias sueltas; las vacías se ignoran, así que se
//                   pueden armar con condicionales sin filtrarlas antes
//   detalle:        filas [{ etiqueta, valor }] para lo que hay que ver en
//                   números —cuánto deja de cobrarse, cómo queda el total—
//                   cuando decirlo en prosa no basta para decidir
//   textoConfirmar: el verbo del botón, el mismo que se pulsó para llegar aquí
//   procesando:     deshabilita los botones mientras la acción corre
//   error:          lo que respondió el servidor si la acción falló. Va DENTRO
//                   del modal porque el aviso de la página queda debajo de su
//                   fondo y, en una pantalla larga, fuera de vista: cerrar el
//                   modal para enseñarlo hacía que el rechazo pareciera que no
//                   pasó nada (2026-09-22)
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
        </div>
      </div>
    </div>
  );
}
