import { desgloseCaja } from '../lib/desgloseCaja';
import { fmtMoneda as fmt } from '../lib/exportUtils';

/**
 * Recuadros de un turno de caja: Ingresos, Egresos y Desglose esperado (corte
 * de Caja y turnos de Ventas). Las líneas salen de `desgloseCaja`.
 */

// Título de bloque, como el de "Cómo se cobró".
const Titulo = ({ texto }) => (
  <div className="px-4 pt-3 pb-1 bg-gray-50/60">
    <p className="text-sm font-medium uppercase tracking-wide text-gray-400">{texto}</p>
  </div>
);

// Un subtotal (Total vendido) va como el total del recuadro, más chico.
const Fila = ({ r }) => r.titulo ? <Titulo texto={r.label} /> : r.subtotal ? (
  <div className="flex items-center justify-between px-4 py-3.5 text-base font-bold uppercase text-gray-900 bg-gray-50">
    <span>{r.label}</span>
    <span className="text-lg text-blue">{fmt(r.value)}</span>
  </div>
) : (
  <div className="flex justify-between px-4 py-3.5 text-base font-semibold text-gray-700">
    <span className="text-gray-600">
      {r.label}
      {r.nota && <span className="block text-sm font-normal text-gray-400">{r.nota}</span>}
    </span>
    <span>{r.sign}{fmt(r.value)}</span>
  </div>
);

// `aparte`: { titulo, filas } informativas que no suman; van después del total
// para que no se lea como su suma.
function Recuadro({ titulo, filas, totalLabel, total, aparte }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-blue">{titulo}</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {filas.map((r) => <Fila key={r.label} r={r} />)}
        <div className="flex items-center justify-between px-4 py-4 text-lg font-bold text-gray-900 bg-gray-50">
          <span>{totalLabel}</span>
          <span className="text-xl text-blue">{fmt(total)}</span>
        </div>
        {aparte && (
          <>
            <Titulo texto={aparte.titulo} />
            {aparte.filas.map((r) => <Fila key={r.label} r={r} />)}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * @param turno con la forma del historial (lib/desgloseCaja.js).
 * @param esperadoLabel "ESPERADO EN CAJA" o, en un turno abierto, "hasta ahora".
 */
export default function RecuadrosCaja({ turno, esperadoLabel = 'ESPERADO EN CAJA' }) {
  const d = desgloseCaja(turno);
  return (
    <>
      <Recuadro
        titulo="Ingresos" filas={d.ingresos} totalLabel={d.totalIngresosLabel.toUpperCase()} total={d.totalIngresos}
        aparte={d.comoSeCobroDentro ? null : { titulo: 'Cómo se cobró', filas: d.comoSeCobro }}
      />
      <Recuadro titulo="Egresos" filas={d.egresos} totalLabel="TOTAL EGRESOS" total={d.totalEgresos} />
      <Recuadro titulo="Desglose esperado" filas={d.desglose} totalLabel={esperadoLabel} total={d.esperado} />
    </>
  );
}
