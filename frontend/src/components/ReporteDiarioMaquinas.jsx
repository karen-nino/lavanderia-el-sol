import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fechaLarga } from '../lib/exportUtils';
import {
  tipoMaquinaTexto, esSecadora, textoDuracion, textoMoneda, horarioPasada, totalesReporte, SERVICIO_TEXTO,
} from '../lib/reporteMaquinas';
import { imprimirReporteMaquinas, descargarReporteMaquinasExcel } from '../lib/exportReporteMaquinas';

/** Día de hoy en 'YYYY-MM-DD' (hora local del equipo). */
const hoyISO = () => new Date().toLocaleDateString('en-CA');

/** 'YYYY-MM-DD' → Date local (new Date(iso) correría un día). */
function fechaLocalISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "Lunes, 03 de Agosto de 2026" a partir de 'YYYY-MM-DD'. */
function fechaLegible(iso) {
  const s = fechaLocalISO(iso).toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Vueltas de una máquina en el día: horario, nota, tiempo y lo que generó cada una. */
function PasadasModal({ maquina, fecha, onClose }) {
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Vueltas de {maquina.nombre}</h3>
            <p className="text-sm text-gray-500 truncate">{tipoMaquinaTexto(maquina)} · {fechaLarga(fechaLocalISO(fecha))}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto py-1">
          {maquina.pasadas.map(p => (
            <div key={p.id} className="px-5 py-2.5 border-b border-gray-50 last:border-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => { onClose(); navigate(`/notas/${p.nota_id}`); }}
                  className="block max-w-full text-sm font-medium text-blue hover:underline underline-offset-2 truncate text-left"
                >
                  Nota {p.folio ?? `#${p.nota_id}`}
                </button>
                <p className="text-sm text-gray-400 truncate">
                  {[SERVICIO_TEXTO[p.tipo_servicio], p.cliente].filter(Boolean).join(' · ')}
                </p>
                <p className="text-sm text-gray-500">
                  {horarioPasada(p)}
                  {p.segundos != null && ` · ${textoDuracion(p.segundos)}`}
                  {p.llego_tope && <span className="text-amber-700"> · al tope</span>}
                </p>
              </div>
              <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{textoMoneda(p.precio)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Reporte diario de Máquinas (admin y empleados): por máquina, las vueltas del
 * día, el tiempo encendida, las veces al tope, sus notas y lo generado.
 */
export default function ReporteDiarioMaquinas() {
  const [fecha, setFecha] = useState(hoyISO);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    let activo = true;
    api.get(`/maquinas/reporte-diario?fecha=${fecha}`)
      .then(d => { if (activo) { setData(d); setError(''); } })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [fecha]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  const maquinas = data?.maquinas ?? [];
  const totales = totalesReporte(maquinas);

  const grupo = (titulo, lista) => {
    if (lista.length === 0) return null;
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">{titulo}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-sm text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Máquina</th>
                <th className="px-4 py-3 text-left">Vueltas</th>
                <th className="px-4 py-3 text-left">Tiempo encendida</th>
                <th className="px-4 py-3 text-left">Al tope</th>
                <th className="px-4 py-3 text-right">Generado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map(m => (
                <tr key={m.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{m.nombre}</p>
                    <p className="text-sm text-gray-400 whitespace-nowrap">{tipoMaquinaTexto(m)}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {/* Al tocarlas, cada vuelta con su nota. */}
                    {m.usos > 0 ? (
                      <button type="button" onClick={() => setDetalle(m)}
                        className="text-left text-blue hover:text-blue-700 hover:underline underline-offset-2 transition-colors whitespace-nowrap">
                        {m.usos} {m.usos === 1 ? 'vuelta' : 'vueltas'}
                      </button>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{m.usos > 0 ? textoDuracion(m.segundos) : <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-700">{m.topes > 0 ? m.topes : <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-right text-gray-800 font-medium whitespace-nowrap">
                    {m.usos > 0 ? textoMoneda(m.generado) : <span className="text-gray-400 font-normal">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Día y Exportar, en un mismo renglón y del mismo alto (como en Inventario). */}
      <div className="flex items-center gap-3">
        {/* El calendario va invisible encima para que la caja pueda decir "Hoy". */}
        <label className="relative flex-1 min-w-0 h-11 flex items-center justify-between gap-2 px-4 rounded-lg border border-gray-300 bg-white text-base text-gray-800 hover:bg-gray-50 transition-colors cursor-pointer">
          <span className="truncate">
            <span className="text-gray-500">Día: </span>
            <span className="font-medium">{fecha === hoyISO() ? 'Hoy' : fecha.split('-').reverse().join('/')}</span>
          </span>
          <svg className="w-5 h-5 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          <input
            type="date" value={fecha} max={hoyISO()}
            onChange={(e) => setFecha(e.target.value || hoyISO())}
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* sin showPicker */ } }}
            aria-label="Día del reporte"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>

        <div ref={exportRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setExportOpen(v => !v)}
            disabled={maquinas.length === 0}
            aria-haspopup="menu" aria-expanded={exportOpen}
            className="h-11 flex items-center gap-1.5 px-4 rounded-lg text-base font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar
          </button>
          {exportOpen && (
            <div role="menu" className="absolute right-0 mt-1 z-20 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => { setExportOpen(false); imprimirReporteMaquinas(data); }}
                className="w-full flex items-center gap-2 px-3 py-3.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Exportar PDF
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); descargarReporteMaquinasExcel(data); }}
                className="w-full flex items-center gap-2 px-3 py-3.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Descargar Excel
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-500 -mt-1">{fechaLegible(fecha)}</p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      ) : maquinas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No hay máquinas en esta sucursal.</p>
      ) : (
        <>
          {/* Resumen del día. */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Vueltas', totales.usos],
              ['Tiempo encendida', totales.usos ? textoDuracion(totales.segundos) : '—'],
              ['Generado', textoMoneda(totales.generado)],
            ].map(([titulo, valor]) => (
              <div key={titulo} className="bg-white rounded-xl border border-gray-200 px-4 py-3 min-w-0">
                <p className="text-sm text-gray-500 truncate">{titulo}</p>
                <p className="text-base font-bold text-gray-900 truncate">{valor}</p>
              </div>
            ))}
          </div>
          {grupo('Lavadoras', maquinas.filter(m => !esSecadora(m)))}
          {grupo('Secadoras', maquinas.filter(esSecadora))}
        </>
      )}

      {detalle && <PasadasModal maquina={detalle} fecha={fecha} onClose={() => setDetalle(null)} />}
    </div>
  );
}
