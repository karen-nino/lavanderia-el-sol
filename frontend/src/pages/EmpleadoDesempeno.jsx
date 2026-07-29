import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const fmtMoneda = (n) =>
  '$' + Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (iso) =>
  new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

function ResumenCard({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-center">
      <p className="text-2xl font-bold text-dark-blue leading-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

// Número de la tabla que abre su modal de detalle. En 0 no es botón.
function CeldaNumero({ value, onClick }) {
  if (!value) return <span className="text-gray-400">0</span>;
  return (
    <button
      onClick={onClick}
      className="font-medium text-blue hover:text-blue-700 hover:underline underline-offset-2 transition-colors"
    >
      {value}
    </button>
  );
}

function FilaModal({ left, sub, right, rightSub, onClick }) {
  const contenido = (
    <>
      <div className="min-w-0">
        <p className={`text-sm truncate ${onClick ? 'text-blue font-medium' : 'text-gray-800'}`}>{left}</p>
        {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
      </div>
      {(right != null || rightSub) && (
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {right != null && (
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{right}</span>
          )}
          {rightSub}
        </div>
      )}
    </>
  );
  const base = 'w-full flex items-center justify-between gap-3 px-5 py-2.5 border-b border-gray-50 last:border-0 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} hover:bg-gray-50 transition-colors`}>
      {contenido}
    </button>
  ) : (
    <div className={base}>{contenido}</div>
  );
}

const tipoMaquinaLabel = (tipo) =>
  tipo === 'secadora'         ? 'Secadora'
  : tipo === 'lavadora_jumbo' ? 'Lavadora jumbo'
  : tipo                      ? 'Lavadora'
  :                             '';

const METRICA_TITULO = {
  notas:     'Notas',
  maquinas:  'Máquinas',
  cargas:    'Cargas',
  productos: 'Productos',
  clientes:  'Clientes',
};

const MODALIDAD_LABEL = {
  AUTOSERVICIO: 'Autoservicio',
  POR_ENCARGO:  'Por encargo',
  EDREDON:      'Edredón',
};

const ESTADO_BADGE = {
  EN_ESPERA:  { label: 'En Espera',    cls: 'bg-gray-100 text-gray-600'     },
  LAVANDO:    { label: 'Lavando',      cls: 'bg-light-blue text-blue-700'   },
  SECANDO:    { label: 'Secando',      cls: 'bg-red-100 text-red-700'       },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800' },
  PAGADA:     { label: 'Pagada',       cls: 'bg-light-green text-green-700' },
  FINALIZADA: { label: 'Finalizada',   cls: 'bg-light-green text-green-700' },
  CANCELADA:  { label: 'Cancelada',    cls: 'bg-red-100 text-red-700'       },
};

function EstadoBadge({ estado }) {
  const b = ESTADO_BADGE[estado];
  if (!b) return null;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${b.cls}`}>
      {b.label}
    </span>
  );
}

// Modal con el detalle de una métrica de un día.
function MetricaModal({ metrica, fecha, count, items, onClose }) {
  const navigate = useNavigate();
  const noun = { notas: 'nota', maquinas: 'máquina', cargas: 'carga', productos: 'producto', clientes: 'cliente' }[metrica];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{METRICA_TITULO[metrica]}</h2>
            <p className="text-xs text-gray-500">{fecha} · {count} {count === 1 ? noun : `${noun}s`}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Sin registros</p>
          ) : metrica === 'notas' ? (
            items.map((n, i) => (
              <FilaModal key={i} left={`Nota ${n.folio}`}
                sub={[MODALIDAD_LABEL[n.modalidad] ?? n.modalidad, n.cliente].filter(Boolean).join(' · ')}
                right={fmtMoneda(n.precio)}
                rightSub={<EstadoBadge estado={n.estado} />}
                onClick={n.id ? () => { onClose(); navigate(`/notas/${n.id}`); } : undefined} />
            ))
          ) : metrica === 'maquinas' ? (
            items.map((m, i) => (
              <FilaModal key={i} left={m.nombre} sub={tipoMaquinaLabel(m.tipo)}
                right={`${m.usos} ${m.usos === 1 ? 'uso' : 'usos'}`} />
            ))
          ) : metrica === 'cargas' ? (
            items.map((c, i) => (
              <FilaModal key={i} left={c.descripcion} sub={c.folio ? `Nota ${c.folio}` : null}
                right={fmtMoneda(c.precio)} />
            ))
          ) : metrica === 'productos' ? (
            items.map((p, i) => (
              <FilaModal key={i} left={p.nombre} right={`× ${p.cantidad}`} />
            ))
          ) : (
            items.map((cl, i) => (
              <FilaModal key={i} left={cl.nombre} sub={cl.folio ? `Nota ${cl.folio}` : null} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function EmpleadoDesempeno() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [modal,   setModal]   = useState(null); // { dia, metrica }

  useEffect(() => {
    let activo = true;
    api.get(`/usuarios/${id}/desempeno`)
      .then(d => { if (activo) setData(d); })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [id]);

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/empleados')}
            aria-label="Volver"
            className="w-11 h-11 rounded-full border border-gray-300 text-gray-700 flex items-center justify-center hover:bg-gray-50 transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{data?.empleado?.nombre ?? '—'}</h1>
            <p className="text-sm text-gray-500">Información de desempeño</p>
          </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="px-6 md:px-8 py-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="text-center text-gray-400 text-sm py-16">Cargando...</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        ) : data && data.dias.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <p className="text-center text-gray-400 text-sm py-16">Este empleado aún no tiene actividad registrada.</p>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ResumenCard label="Días activos" value={data.resumen.dias_activos} />
              <ResumenCard label="Notas" value={data.resumen.notas} />
              <ResumenCard label="Vendido" value={fmtMoneda(data.resumen.vendido)} />
              <ResumenCard label="Cargas" value={data.resumen.cargas} />
            </div>

            {/* Tabla por día */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800">Desempeño por día</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                      <th className="text-right px-4 py-2.5 font-medium">Notas</th>
                      <th className="text-right px-4 py-2.5 font-medium">Vendido</th>
                      <th className="text-right px-4 py-2.5 font-medium">Máquinas</th>
                      <th className="text-right px-4 py-2.5 font-medium">Cargas</th>
                      <th className="text-right px-4 py-2.5 font-medium">Productos</th>
                      <th className="text-right px-4 py-2.5 font-medium">Clientes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.dias.map((d) => (
                      <tr key={d.fecha} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(d.fecha)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.notas} onClick={() => setModal({ dia: d, metrica: 'notas' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-dark-blue">{fmtMoneda(d.vendido)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.maquinas} onClick={() => setModal({ dia: d, metrica: 'maquinas' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.cargas} onClick={() => setModal({ dia: d, metrica: 'cargas' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.productos} onClick={() => setModal({ dia: d, metrica: 'productos' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.clientes} onClick={() => setModal({ dia: d, metrica: 'clientes' })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {modal && (
        <MetricaModal
          metrica={modal.metrica}
          fecha={fmtFecha(modal.dia.fecha)}
          count={modal.dia[modal.metrica]}
          items={modal.dia.detalle?.[modal.metrica] ?? []}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
