import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const ESTADOS = ['TODOS', 'EN_ESPERA', 'EN_PROCESO', 'LISTA', 'FINALIZADA', 'DEBE', 'CANCELADA'];

const FILTRO_LABEL = {
  TODOS:      'Todos',
  DEBE:       'Pagos Pendientes',
  FINALIZADA: 'Finalizadas',
  CANCELADA:  'Canceladas',
};

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

const BADGE_ESTADO = {
  EN_ESPERA:  { label: 'En Espera',  cls: 'bg-gray-100 text-gray-600'       },
  EN_PROCESO: { label: 'En Proceso', cls: 'bg-blue-100 text-blue-800'       },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800' },
  PAGADA:     { label: 'Pagada',     cls: 'bg-emerald-100 text-emerald-800' },
  FINALIZADA: { label: 'Finalizada', cls: 'bg-green-800 text-white'         },
  CANCELADA:  { label: 'Cancelada',  cls: 'bg-red-100 text-red-700'         },
};

const BADGE_MODALIDAD = {
  AUTOSERVICIO: { label: 'Autoservicio', cls: 'bg-light-blue text-blue-700' },
  EDREDON:      { label: 'Edredón',      cls: 'bg-sky-100 text-sky-700'       },
  POR_ENCARGO:  { label: 'Por encargo',  cls: 'bg-amber-100 text-amber-700'   },
};

const BADGE_PAGO = {
  DEBE:   { label: 'Debe',   cls: 'bg-red-100 text-red-700'     },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700' },
};

function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

function fmtCliente(n) {
  if (!n.cliente_nombre) return null;
  const ap = (n.cliente_apellido ?? '').trim();
  return ap ? `${n.cliente_nombre} ${ap.charAt(0).toUpperCase()}.` : n.cliente_nombre;
}

export default function Notas() {
  const navigate                              = useNavigate();

  const [notas,             setNotas]             = useState([]);
  const [filtro,            setFiltro]            = useState('TODOS');
  const [rangoFecha,        setRangoFecha]        = useState('TODAS');
  const [busqueda,          setBusqueda]          = useState('');
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [mostrarEstado,     setMostrarEstado]     = useState(false);
  const [mostrarFecha,      setMostrarFecha]      = useState(false);
  const estadoRef = useRef(null);
  const fechaRef  = useRef(null);

  useEffect(() => {
    api.get('/notas')
      .then(setNotas)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!mostrarEstado && !mostrarFecha) return;
    const onMouseDown = (e) => {
      if (mostrarEstado && estadoRef.current && !estadoRef.current.contains(e.target)) {
        setMostrarEstado(false);
      }
      if (mostrarFecha && fechaRef.current && !fechaRef.current.contains(e.target)) {
        setMostrarFecha(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mostrarEstado, mostrarFecha]);

  // Minúsculas y sin acentos, para que la búsqueda los ignore (igual que en Clientes).
  const normalizar = (s) =>
    (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = normalizar(busqueda.trim());
  const rango = useMemo(() => calcularRangoFecha(rangoFecha), [rangoFecha]);
  const filtradas = notas.filter(n => {
    if (filtro === 'DEBE') {
      if (n.estado_pago !== 'DEBE') return false;
    } else if (filtro !== 'TODOS' && n.estado !== filtro) {
      return false;
    }
    if (rango) {
      const fecha = new Date(n.created_at);
      if (fecha < rango.desde || fecha >= rango.hasta) return false;
    }
    if (!q) return true;
    const folio    = normalizar(n.folio ?? `#${n.id}`);
    const cliente  = normalizar(n.cliente_nombre);
    const apellido = normalizar(n.cliente_apellido);
    const telefono = normalizar(n.cliente_telefono);
    return folio.includes(q) || cliente.includes(q) || apellido.includes(q) || telefono.includes(q);
  });

  return (
    <div className="pt-10 pb-16 px-6 md:py-14 md:px-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notas</h1>
          <p className="text-sm text-gray-500">{filtradas.length} resultado(s)</p>
        </div>
        <div className="flex items-center gap-3">
          <div ref={estadoRef} className="relative">
            <button
              onClick={() => { setMostrarEstado(v => !v); setMostrarFecha(false); }}
              aria-label="Filtrar por estado"
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                filtro !== 'TODOS'
                  ? 'border-blue bg-light-blue text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M4 6h16M7 12h10M10 18h4" />
              </svg>
            </button>

            {mostrarEstado && (
              <div className="absolute right-0 top-12 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">Estado</p>
                <div className="flex flex-col gap-1">
                  {ESTADOS.map(e => (
                    <button
                      key={e}
                      onClick={() => { setFiltro(e); setMostrarEstado(false); }}
                      className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                        filtro === e
                          ? 'bg-light-blue text-blue-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {FILTRO_LABEL[e] ?? BADGE_ESTADO[e]?.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div ref={fechaRef} className="relative">
            <button
              onClick={() => { setMostrarFecha(v => !v); setMostrarEstado(false); }}
              aria-label="Filtrar por fecha"
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                rangoFecha !== 'TODAS'
                  ? 'border-blue bg-light-blue text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="16" rx="2" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </button>

            {mostrarFecha && (
              <div className="absolute right-0 top-12 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">Fecha</p>
                <div className="flex flex-col gap-1">
                  {RANGOS_FECHA.map(r => (
                    <button
                      key={r.value}
                      onClick={() => { setRangoFecha(r.value); setMostrarFecha(false); }}
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

          <Link
            to="/notas/nueva"
            aria-label="Nueva nota"
            className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Buscar por folio, cliente o teléfono..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full pl-11 pr-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent bg-white transition"
        />
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {!loading && !error && filtradas.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 text-center py-12">
          <p className="text-gray-400 text-sm">
            {busqueda ? 'No se encontraron notas con ese criterio' : 'No hay notas con este filtro'}
          </p>
        </div>
      )}

      {!loading && !error && filtradas.length > 0 && (
        <>
          {/* Tabla — desktop */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Folio</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Pago</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtradas.map(n => {
                      const badgeEstado    = BADGE_ESTADO[n.estado]       ?? BADGE_ESTADO.EN_PROCESO;
                      const badgeModalidad = BADGE_MODALIDAD[n.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
                      const badgePago      = BADGE_PAGO[n.estado_pago];
                      return (
                        <tr
                          key={n.id}
                          onClick={() => navigate(`/notas/${n.id}`)}
                          className="hover:bg-light-blue transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">
                            #{n.folio?.split('-')[0] ?? n.id}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeModalidad.cls}`}>
                              {badgeModalidad.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">
                              {fmtCliente(n) ?? <span className="text-gray-400 italic">Anónimo</span>}
                            </p>
                            {n.cliente_telefono && (
                              <p className="text-xs text-gray-400">{n.cliente_telefono}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeEstado.cls}`}>
                              {badgeEstado.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {badgePago && (
                              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgePago.cls}`}>
                                {badgePago.label}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {fmtMonto(n.precio_total)}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {fmtFecha(n.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
              </table>
            </div>
          </div>

          {/* Cards — mobile */}
          <div className="md:hidden space-y-3">
            {filtradas.map(n => {
              const badgeEstado    = BADGE_ESTADO[n.estado]       ?? BADGE_ESTADO.EN_PROCESO;
              const badgeModalidad = BADGE_MODALIDAD[n.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
              const badgePago      = BADGE_PAGO[n.estado_pago];
              return (
                <div
                  key={n.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 space-y-1.5 active:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/notas/${n.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs text-gray-400">#{n.folio?.split('-')[0] ?? n.id}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeModalidad.cls}`}>
                      {badgeModalidad.label}
                    </span>
                  </div>
                  <p className="font-medium text-gray-800 text-sm">
                    {fmtCliente(n) ?? <span className="text-gray-400 italic">Anónimo</span>}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeEstado.cls}`}>
                        {badgeEstado.label}
                      </span>
                      {badgePago && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgePago.cls}`}>
                          {badgePago.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {fmtFecha(n.created_at)}
                      {n.precio_total ? ` · ${fmtMonto(n.precio_total)}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

    </div>
  );
}
