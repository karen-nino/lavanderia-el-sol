import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import SucursalBar from '../components/SucursalBar';

const fmtMoneda = (n) =>
  '$' + Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (iso) =>
  new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

// Filtro de fecha por rangos, como en la página de Notas.
const RANGOS_FECHA = [
  { value: 'TODAS',     label: 'Todas las fechas' },
  { value: 'HOY',       label: 'Hoy' },
  { value: 'AYER',      label: 'Ayer' },
  { value: 'ULTIMOS_7', label: 'Últimos 7 días' },
  { value: 'ESTE_MES',  label: 'Este mes' },
];

function calcularRangoFecha(rango) {
  if (rango === 'TODAS') return null;
  const ahora = new Date();
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const manana = new Date(hoyInicio); manana.setDate(manana.getDate() + 1);
  switch (rango) {
    case 'HOY':
      return { desde: hoyInicio, hasta: manana };
    case 'AYER': {
      const ayer = new Date(hoyInicio); ayer.setDate(ayer.getDate() - 1);
      return { desde: ayer, hasta: hoyInicio };
    }
    case 'ULTIMOS_7': {
      const desde = new Date(hoyInicio); desde.setDate(desde.getDate() - 6);
      return { desde, hasta: manana };
    }
    case 'ESTE_MES':
      return { desde: new Date(ahora.getFullYear(), ahora.getMonth(), 1), hasta: manana };
    default:
      return null;
  }
}

const RANGO_LABEL = Object.fromEntries(RANGOS_FECHA.map(r => [r.value, r.label]));

const POR_PAGINA = 20;

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

const METRICA_TITULO = {
  usos:      'Usos',
  cargas:    'Cargas',
  empleados: 'Empleados',
  clientes:  'Clientes',
};

// Modal con el detalle de una métrica de un día.
function MetricaModal({ metrica, fecha, count, items, onClose }) {
  const navigate = useNavigate();
  const noun = { usos: 'uso', cargas: 'carga', empleados: 'empleado', clientes: 'cliente' }[metrica];
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
          ) : metrica === 'usos' ? (
            items.map((n, i) => (
              <FilaModal key={i} left={`Nota ${n.folio}`}
                sub={[MODALIDAD_LABEL[n.modalidad] ?? n.modalidad, n.cliente].filter(Boolean).join(' · ')}
                right={fmtMoneda(n.precio)}
                rightSub={<EstadoBadge estado={n.estado} />}
                onClick={n.id ? () => { onClose(); navigate(`/notas/${n.id}`); } : undefined} />
            ))
          ) : metrica === 'cargas' ? (
            items.map((c, i) => (
              <FilaModal key={i} left={c.descripcion} sub={c.folio ? `Nota ${c.folio}` : null}
                right={fmtMoneda(c.precio)} />
            ))
          ) : metrica === 'empleados' ? (
            items.map((e, i) => (
              <FilaModal key={i} left={e.nombre} right={`${e.usos} ${e.usos === 1 ? 'uso' : 'usos'}`} />
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

export default function MaquinaUso() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [modal,        setModal]        = useState(null); // { dia, metrica }
  const [rangoFecha,   setRangoFecha]   = useState('TODAS');
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const [pagina,       setPagina]       = useState(1);
  const fechaRef = useRef(null);

  useEffect(() => {
    let activo = true;
    api.get(`/maquinas/${id}/uso`)
      .then(d => { if (activo) setData(d); })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [id]);

  // Cierra el dropdown de fecha al hacer clic fuera.
  useEffect(() => {
    if (!mostrarFecha) return;
    const onDown = (e) => {
      if (fechaRef.current && !fechaRef.current.contains(e.target)) setMostrarFecha(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mostrarFecha]);

  // Filtro por rango de fecha (mismo criterio que Notas).
  const rango = useMemo(() => calcularRangoFecha(rangoFecha), [rangoFecha]);
  const diasFiltrados = useMemo(() => {
    const dias = data?.dias ?? [];
    if (!rango) return dias;
    return dias.filter(d => {
      const f = new Date(d.fecha);
      return f >= rango.desde && f < rango.hasta;
    });
  }, [data, rango]);

  const totalPaginas = Math.max(1, Math.ceil(diasFiltrados.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const diasPagina   = diasFiltrados.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA);

  // Al elegir un rango se vuelve a la primera página.
  const elegirRango = (v) => { setRangoFecha(v); setMostrarFecha(false); setPagina(1); };

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/gestion-maquinas')}
            aria-label="Volver"
            className="w-11 h-11 rounded-full border border-gray-300 text-gray-700 flex items-center justify-center hover:bg-gray-50 transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{data?.maquina?.nombre ?? '—'}</h1>
            <p className="text-sm text-gray-500">Información de uso</p>
          </div>
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="px-6 md:px-8 py-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="text-center text-gray-400 text-sm py-16">Cargando...</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        ) : data && data.dias.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <p className="text-center text-gray-400 text-sm py-16">Esta máquina aún no tiene uso registrado.</p>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ResumenCard label="Días usada" value={data.resumen.dias_usada} />
              <ResumenCard label="Usos" value={data.resumen.usos} />
              <ResumenCard label="Generado" value={fmtMoneda(data.resumen.generado)} />
              <ResumenCard label="Cargas" value={data.resumen.cargas} />
            </div>

            {/* Tabla por día */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-800 mr-auto">Uso por día</h2>
                <div ref={fechaRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setMostrarFecha(v => !v)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      rangoFecha !== 'TODAS'
                        ? 'border-blue bg-light-blue text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="3" y="5" width="18" height="16" rx="2" strokeWidth={2} />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                    {RANGO_LABEL[rangoFecha]}
                  </button>
                  {mostrarFecha && (
                    <div className="absolute right-0 top-12 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">Fecha</p>
                      <div className="flex flex-col gap-1">
                        {RANGOS_FECHA.map(r => (
                          <button
                            key={r.value}
                            type="button"
                            onClick={() => elegirRango(r.value)}
                            className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                              rangoFecha === r.value
                                ? 'bg-light-blue text-blue-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                      <th className="text-right px-4 py-2.5 font-medium">Usos</th>
                      <th className="text-right px-4 py-2.5 font-medium">Generado</th>
                      <th className="text-right px-4 py-2.5 font-medium">Cargas</th>
                      <th className="text-right px-4 py-2.5 font-medium">Empleados</th>
                      <th className="text-right px-4 py-2.5 font-medium">Clientes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {diasPagina.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                          No hay días en el rango seleccionado.
                        </td>
                      </tr>
                    ) : diasPagina.map((d) => (
                      <tr key={d.fecha} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(d.fecha)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.usos} onClick={() => setModal({ dia: d, metrica: 'usos' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-dark-blue">{fmtMoneda(d.generado)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.cargas} onClick={() => setModal({ dia: d, metrica: 'cargas' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.empleados} onClick={() => setModal({ dia: d, metrica: 'empleados' })} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <CeldaNumero value={d.clientes} onClick={() => setModal({ dia: d, metrica: 'clientes' })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPaginas > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm">
                  <button
                    type="button"
                    onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={paginaSegura <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Anterior
                  </button>
                  <span className="text-gray-500">Página {paginaSegura} de {totalPaginas}</span>
                  <button
                    type="button"
                    onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                    disabled={paginaSegura >= totalPaginas}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}
        {/* Espacio extra abajo para poder desplazarse y ver el dropdown de
            fecha completo sin que lo tape la barra inferior. */}
        {mostrarFecha && <div className="h-80" aria-hidden />}
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
