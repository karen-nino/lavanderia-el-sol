import { desgloseCaja } from '../lib/desgloseCaja';
import { fmtMoneda as fmt } from '../lib/exportUtils';

// Los tres recuadros de un turno de caja: Ingresos, Egresos y Desglose
// esperado (2026-10-10). Los usan el corte (Caja) y las tarjetas de turno de
// Ventas; las líneas salen de `desgloseCaja`, igual que en las exportaciones.

const Fila = ({ r }) => (
  <div className="flex justify-between px-4 py-3 text-sm text-gray-600">
    <span>
      {r.label}
      {r.nota && <span className="block text-xs text-gray-400">{r.nota}</span>}
    </span>
    <span>{r.sign}{fmt(r.value)}</span>
  </div>
);

// `aparte`: { titulo, filas } informativas que no se suman al total (como
// "Cómo se cobró" en Ventas); van con su encabezado y el total queda hasta
// abajo, como en Ventas (a pedido, 2026-10-10).
function Recuadro({ titulo, filas, totalLabel, total, aparte }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700">{titulo}</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {filas.map((r) => <Fila key={r.label} r={r} />)}
        {aparte && (
          <>
            <div className="px-4 pt-3 pb-1 bg-gray-50/60">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{aparte.titulo}</p>
            </div>
            {aparte.filas.map((r) => <Fila key={r.label} r={r} />)}
          </>
        )}
        <div className="flex justify-between px-4 py-4 text-base font-bold text-gray-900 bg-gray-50">
          <span>{totalLabel}</span>
          <span className="text-lg">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

// `turno`: con la forma del historial (ver lib/desgloseCaja.js).
// `esperadoLabel`: "ESPERADO EN CAJA" o, en un turno abierto, "hasta ahora".
export default function RecuadrosCaja({ turno, esperadoLabel = 'ESPERADO EN CAJA' }) {
  const d = desgloseCaja(turno);
  return (
    <>
      <Recuadro
        titulo="Ingresos" filas={d.ingresos} totalLabel="TOTAL INGRESOS" total={d.totalIngresos}
        aparte={{ titulo: 'Cómo se cobró', filas: d.comoSeCobro }}
      />
      <Recuadro titulo="Egresos" filas={d.egresos} totalLabel="TOTAL EGRESOS" total={d.totalEgresos} />
      <Recuadro titulo="Desglose esperado" filas={d.desglose} totalLabel={esperadoLabel} total={d.esperado} />
    </>
  );
}
