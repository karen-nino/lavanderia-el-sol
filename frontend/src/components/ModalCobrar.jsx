import { FORMAS_PAGO } from '../lib/formasPago';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

// Modal ÚNICO de cobro (2026-09-26). Antes eran dos —"Abonar" y "Liquidar"—,
// y en el mostrador son el mismo gesto: recibir dinero. La única diferencia es
// si lo que trae el cliente alcanza para todo, y eso lo dice el importe, no un
// botón distinto. Aquí viene puesto el saldo completo, que es el caso normal
// (liquidar de un toque); bajarlo deja la nota abonada y debiendo el resto.
//
// Con saldo 0 no hay importe que teclear —no se puede abonar $0— y el modal se
// queda en confirmar el cobro y su forma, como hacía Liquidar.
//
// `cajaAbierta === false` avisa que el dinero se va a quedar fuera del corte
// del día. El aviso vivía solo en Nueva Nota, que era donde se cobraba el
// autoservicio; desde que el cobro se hace aquí (2026-09-23) se vino con él, o
// el dinero se salía del corte sin que nadie se enterara.
//
// También lo abre Nueva Nota al elegir "Sí" en Pago anticipado de Por Encargo
// (2026-10-03): la nota aún no existe, así que va sin folio y con su título.
export default function ModalCobrar({ saldo, folio, titulo = 'Cobrar nota', monto, onMonto, formaPago, onFormaPago,
                       onCancelar, onConfirmar, loading, error, cajaAbierta, onAbrirCaja,
                       abonado = 0, total }) {
  const sinSaldo = saldo <= 1e-9;
  const importe = Number(monto);
  const montoOk = Number.isFinite(importe) && importe > 0 && importe <= saldo + 1e-9;
  const valido = sinSaldo || montoOk;
  // Lo que pasa al confirmar, dicho antes de confirmar: es lo que antes
  // elegías al escoger entre los dos botones.
  const liquida = sinSaldo || (montoOk && importe >= saldo - 1e-9);
  const restante = montoOk ? saldo - importe : 0;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">{titulo}</h3>
          {folio && <p className="text-sm text-gray-500">Nota {folio}</p>}
        </div>

        {/* El monto es lo que el empleado tiene que cobrar: va en grande y
            aparte, no escondido dentro del texto. Con abonos no es el total de
            la nota sino lo que falta; el total se dice debajo para que se
            entienda el número grande (mig. 121). */}
        <div className="rounded-2xl bg-light-blue border-2 border-blue/30 px-5 py-4 text-center">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            {abonado > 0 ? 'Falta por cobrar' : 'Total'}
          </p>
          <p className="text-4xl font-bold text-dark-blue leading-tight mt-1">{fmtMonto(saldo)}</p>
          {abonado > 0 && (
            <p className="text-xs text-blue-700 mt-1">
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
              Puedes cobrar, pero este dinero no va a aparecer en el corte de hoy.
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
                type="number" min="0" step="any" max={saldo}
                value={monto}
                onChange={e => onMonto(e.target.value)}
                className="w-full pl-8 pr-4 py-3.5 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue focus:border-blue [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            {Number.isFinite(importe) && importe > saldo + 1e-9 ? (
              <p className="text-xs text-red-600">La nota solo debe {fmtMonto(saldo)}.</p>
            ) : montoOk && !liquida ? (
              <p className="text-xs text-gray-500">
                Queda abonada: le faltarían {fmtMonto(restante)} por pagar.
              </p>
            ) : montoOk ? (
              <p className="text-xs text-gray-500">Con esto la nota queda liquidada.</p>
            ) : null}
          </div>
        )}

        {/* Mismos botones que el cobro de Nueva Nota: el empleado elige la
            forma de pago en el mismo gesto en las dos pantallas. */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">Método de pago:</p>
          <div className="grid grid-cols-3 gap-3">
            {FORMAS_PAGO.map(opt => {
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
