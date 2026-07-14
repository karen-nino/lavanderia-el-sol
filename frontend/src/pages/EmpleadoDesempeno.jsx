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

export default function EmpleadoDesempeno() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

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
                        <td className="px-4 py-2.5 text-right">{d.notas}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-dark-blue">{fmtMoneda(d.vendido)}</td>
                        <td className="px-4 py-2.5 text-right">{d.maquinas}</td>
                        <td className="px-4 py-2.5 text-right">{d.cargas}</td>
                        <td className="px-4 py-2.5 text-right">{d.productos}</td>
                        <td className="px-4 py-2.5 text-right">{d.clientes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
