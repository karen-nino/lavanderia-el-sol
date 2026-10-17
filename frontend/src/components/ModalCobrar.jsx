import { FORMAS_PAGO_COBRO } from '../lib/formasPago';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

/**
 * Modal de cobro. Trae el saldo completo (liquidar de un toque); con menos, la
 * nota queda abonada. Con saldo 0 solo confirma la forma de pago.
 *
 * Con `cajaAbierta === false` no se recibe dinero (el backend responde 409
 * CAJA_CERRADA): el aviso ofrece abrirla. Liquidar en $0 sí se permite.
 *
 * Nueva Nota también lo usa para el pago anticipado de Por Encargo (sin folio,
 * con su título).
 */
export default function ModalCobrar({ saldo, folio, titulo = 'Cobrar nota', monto, onMonto, formaPago, onFormaPago,
                       onCancelar, onConfirmar, loading, error, cajaAbierta, onAbrirCaja,
                       abonado = 0, total }) {
  const sinSaldo = saldo <= 1e-9;
  const importe = Number(monto);
  const montoOk = Number.isFinite(importe) && importe > 0 && importe <= saldo + 1e-9;
  const sinCaja = cajaAbierta === false && !sinSaldo;
  const valido = (sinSaldo || montoOk) && !sinCaja;
  // Qué pasará al confirmar, dicho antes.
  const liquida = sinSaldo || (montoOk && importe >= saldo - 1e-9);
  const restante = montoOk ? saldo - importe : 0;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">{titulo}</h3>
          {folio && <p className="text-sm text-gray-500">Nota {folio}</p>}
        </div>

        {/* El monto a cobrar en grande; con abonos es lo que falta, con el total debajo. */}
        <div className="rounded-2xl bg-light-blue border-2 border-blue/30 px-5 py-4 text-center">
          <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">
            {abonado > 0 ? 'Falta por cobrar' : 'Total'}
          </p>
          <p className="text-4xl font-bold text-dark-blue leading-tight mt-1">{fmtMonto(saldo)}</p>
          {abonado > 0 && (
            <p className="text-sm text-blue-700 mt-1">
              Ya abonó {fmtMonto(abonado)} de {fmtMonto(total)}
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        {cajaAbierta === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">La caja del día no está abierta</p>
            <p className="mt-0.5 text-sm text-amber-800">
              {sinSaldo
                ? 'No hay dinero que recibir, así que puedes liquidarla igual.'
                : 'Ábrela para poder recibir el pago: así entra en el corte de hoy.'}
            </p>
            <button
              type="button"
              onClick={onAbrirCaja}
              className="mt-2.5 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors"
            >
              Abrir caja
            </button>
          </div>
        )}

        {!sinSaldo && (
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900">¿Cuánto recibes?</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
              <input
                type="number" inputMode="decimal" min="0" step="any" max={saldo}
                value={monto}
                onChange={e => onMonto(e.target.value)}
                placeholder="0"
                aria-label="¿Cuánto recibes?"
                className="w-full pl-8 pr-4 py-3.5 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue focus:border-blue [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            {Number.isFinite(importe) && importe > saldo + 1e-9 ? (
              <p className="text-sm text-red-600">La nota solo debe {fmtMonto(saldo)}.</p>
            ) : montoOk && !liquida ? (
              <p className="text-sm text-gray-500">
                Queda abonada: le faltarían {fmtMonto(restante)} por pagar.
              </p>
            ) : montoOk ? (
              <p className="text-sm text-gray-500">Con esto la nota queda liquidada.</p>
            ) : null}
          </div>
        )}

        {/* Los mismos botones de forma de pago que Nueva Nota. */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">Método de pago:</p>
          <div className="grid grid-cols-2 gap-3">
            {FORMAS_PAGO_COBRO.map(opt => {
              const selected = formaPago === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onFormaPago(opt.v)}
                  className={`py-4 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                    selected
                      ? 'border-blue bg-light-blue text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-100">
          <button
            onClick={onCancelar}
            disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={loading || !valido || !formaPago}
            className="flex-1 bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Procesando...' : liquida ? 'Liquidar' : 'Abonar'}
          </button>
        </div>
      </div>
    </div>
  );
}
