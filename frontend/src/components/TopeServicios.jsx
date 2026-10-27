/**
 * Por Encargo: cuánto del precio de los servicios ya se usó (Tope, Usado y
 * Disponible o Se pasa). Se usa en Salidas y en el detalle de la nota.
 *
 * @param nota la nota con `tope_nota` (sin él no se muestra) y `ajuste`.
 */
const fmtMonto = (n) => `$${Number(n).toFixed(2)}`;

export default function TopeServicios({ nota }) {
  const t = nota?.tope_nota;
  if (!t) return null;
  const servicios = t.servicios ?? [];
  const ajuste = Number(nota.ajuste) || 0;
  const disponible = t.presupuesto - t.usado;
  const sePasa = disponible < -1e-9;
  /* Tres cifras en columnas: etiqueta chica arriba, monto abajo. */
  const cifras = [
    { etiqueta: 'Tope', valor: fmtMonto(t.presupuesto), cls: 'text-gray-700' },
    { etiqueta: 'Usado', valor: fmtMonto(t.usado), cls: 'text-gray-700' },
    sePasa
      ? { etiqueta: 'Se pasa', valor: fmtMonto(-disponible), cls: 'text-red-600' }
      : { etiqueta: 'Disponible', valor: fmtMonto(disponible), cls: 'text-blue' },
  ];
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">
          {servicios.length === 1 ? 'Tope del servicio' : 'Tope de los servicios'}
        </h2>
        {/* El tope ya trae el ajuste; se nombra cuando lo hay. */}
        {ajuste !== 0 && (
          <p className="text-sm text-gray-500 mt-0.5">
            Con ajuste de {ajuste < 0 ? '−' : '+'}{fmtMonto(Math.abs(ajuste))}
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {cifras.map(c => (
          <div key={c.etiqueta} className="px-3 py-3">
            <p className="text-sm text-gray-500">{c.etiqueta}</p>
            <p className={`text-base font-bold tabular-nums ${c.cls}`}>{c.valor}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
