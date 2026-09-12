// Fondo con el que se abre la caja. No es un número libre: es el dinero que
// quedó en el cajón en el corte anterior (lo calcula el backend, ver
// `aperturaSugerida`). El empleado solo lo confirma; el admin puede ajustarlo,
// pero viendo siempre con cuánto se cerró el día anterior.
//
//   • sugerida → { monto, origen: 'corte' | 'cierre_automatico', corte: {...} }
//                 o null si la sucursal nunca ha cerrado una caja
//   • admin    → si el usuario puede ajustar el monto
//   • monto / onMonto → el valor del campo (string, como todo <input>)

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

const fmtFechaHora = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  return d.toLocaleString('es-MX', {
    day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
  });
};

export default function FondoApertura({ sugerida, admin, monto, onMonto }) {
  // Sin corte anterior no hay nada que arrastrar: lo captura un admin.
  if (!sugerida) {
    if (!admin) {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-medium text-amber-800">No hay un corte anterior</p>
          <p className="mt-1 text-sm text-amber-700">
            El fondo sale del corte del día anterior y esta sucursal todavía no tiene uno.
            Pide a un administrador que abra la caja.
          </p>
        </div>
      );
    }
    return (
      <div>
        <label htmlFor="fondo-apertura" className="block text-sm font-medium text-gray-700 mb-1">
          Fondo inicial
        </label>
        <input
          id="fondo-apertura"
          type="number" min="0" step="0.01" required autoFocus
          value={monto} onChange={(e) => onMonto(e.target.value)}
          placeholder="0.00"
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          Es la primera caja de esta sucursal: cuenta el efectivo y captúralo. De aquí en
          adelante el fondo lo trae solo del corte anterior.
        </p>
      </div>
    );
  }

  const sinConteo = sugerida.origen === 'cierre_automatico';
  const ajustado  = admin && monto !== '' && Number(monto) !== sugerida.monto;
  const diferencia = ajustado ? Number(monto) - sugerida.monto : 0;

  return (
    <div className="space-y-3">
      {/* De dónde sale el dinero: el corte anterior, siempre a la vista. */}
      <div className={`rounded-xl border p-4 ${sinConteo ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
        <p className={`text-xs font-medium uppercase tracking-wide ${sinConteo ? 'text-amber-700' : 'text-gray-500'}`}>
          {sinConteo ? 'Cierre anterior · sin conteo' : 'Quedó del corte anterior'}
        </p>
        <p className={`mt-1 text-2xl font-bold ${sinConteo ? 'text-amber-800' : 'text-gray-900'}`}>
          {fmt(sugerida.monto)}
        </p>
        <p className={`mt-0.5 text-xs ${sinConteo ? 'text-amber-700' : 'text-gray-500'}`}>
          {fmtFechaHora(sugerida.corte?.cerrada_at)}
        </p>
        {sinConteo && (
          <p className="mt-2 text-sm text-amber-700">
            Nadie cerró la caja ese día y la app la cerró sola, así que nadie contó el efectivo.
            Este es el monto que debería haber en el cajón: cuéntalo antes de abrir.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="fondo-apertura" className="block text-sm font-medium text-gray-700 mb-1">
          Fondo inicial
        </label>
        <input
          id="fondo-apertura"
          type="number" min="0" step="0.01" required
          value={monto} onChange={(e) => onMonto(e.target.value)}
          readOnly={!admin}
          // Bloqueado para el empleado: el dinero del cajón no cambia porque
          // alguien teclee otro número.
          className={`w-full border rounded-lg px-3 py-2.5 text-base ${
            admin ? 'border-gray-300' : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'
          }`}
        />
        {admin ? (
          ajustado ? (
            <p className="mt-1.5 text-xs text-amber-700">
              Estás ajustando el fondo en {diferencia > 0 ? '+' : '−'}{fmt(Math.abs(diferencia))}
              {' '}sobre lo que quedó del corte anterior.
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-gray-500">
              Viene del corte anterior. Puedes ajustarlo si el efectivo del cajón no coincide.
            </p>
          )
        ) : (
          <p className="mt-1.5 text-xs text-gray-500">
            Lo fija el corte anterior. Si el efectivo no coincide, un administrador puede ajustarlo.
          </p>
        )}
      </div>
    </div>
  );
}
