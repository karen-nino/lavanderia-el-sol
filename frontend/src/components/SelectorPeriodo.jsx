import { useEffect, useRef, useState } from 'react';
import { PERIODOS, MESES, etiquetaPeriodo } from '../lib/periodo';

/**
 * Selector de período, igual al del historial de Caja: un botón que abre su
 * panel (Hoy, Esta semana, Mes y Año con su rejilla, Personalizado con Desde y
 * Hasta). `valor` = { periodo, anio, mes, desde, hasta } (ver lib/periodo);
 * `anios` = los años que se ofrecen.
 */
export default function SelectorPeriodo({ valor, onCambio, anios }) {
  const [abierto, setAbierto] = useState(false);
  const [subFiltro, setSubFiltro] = useState(null); // null | 'mes' | 'anio'
  const ref = useRef(null);

  // Se cierra al hacer clic fuera.
  useEffect(() => {
    if (!abierto) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) { setAbierto(false); setSubFiltro(null); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [abierto]);

  const elegir = (cambios) => {
    onCambio({ ...valor, ...cambios });
    setAbierto(false);
    setSubFiltro(null);
  };
  const listaAnios = anios?.length ? anios : [valor.anio];

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => { setAbierto(v => !v); setSubFiltro(null); }}
          aria-haspopup="menu"
          aria-expanded={abierto}
          className="w-full h-11 flex items-center justify-between gap-2 px-4 rounded-lg border border-gray-300 bg-white text-base text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span className="truncate">
            <span className="hidden sm:inline text-gray-500">Período: </span>
            <span className="font-medium">{etiquetaPeriodo(valor)}</span>
          </span>
          <svg className={`w-4 h-4 flex-shrink-0 text-gray-500 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {abierto && (
          <div role="menu" className="absolute left-0 top-full mt-2 z-20 w-full min-w-[15rem] bg-white border border-gray-200 rounded-xl shadow-lg p-2 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col gap-1">
              {PERIODOS.map((op) => {
                const activo = valor.periodo === op.id;
                const opCls = `flex items-center justify-between text-left text-base px-3 py-3 rounded-lg transition-colors ${
                  activo ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                }`;
                // Mes y Año despliegan su rejilla aquí mismo.
                if (op.id === 'mes' || op.id === 'anio') {
                  const sub = subFiltro === op.id;
                  const opciones = op.id === 'mes'
                    ? MESES.map((nombre, idx) => ({ k: idx, t: nombre.slice(0, 3) }))
                    : listaAnios.map((y) => ({ k: y, t: y }));
                  return (
                    <div key={op.id}>
                      <button type="button" onClick={() => setSubFiltro(sub ? null : op.id)} aria-expanded={sub} className={`w-full ${opCls}`}>
                        <span>
                          {op.id === 'mes' ? 'Mes' : 'Año'}
                          {activo && `: ${op.id === 'mes' ? MESES[valor.mes] : valor.anio}`}
                        </span>
                        <svg className={`w-4 h-4 transition-transform ${sub ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {sub && (
                        <div className="grid grid-cols-3 gap-1 mt-1 mb-1">
                          {opciones.map(({ k, t }) => {
                            const sel = activo && (op.id === 'mes' ? valor.mes === k : valor.anio === k);
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => elegir(op.id === 'mes' ? { periodo: 'mes', mes: k } : { periodo: 'anio', anio: k })}
                                className={`text-sm px-2 py-2.5 rounded-lg transition-colors ${sel ? 'bg-blue text-white font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <button key={op.id} type="button" onClick={() => elegir({ periodo: op.id })} className={opCls}>
                    {op.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {valor.periodo === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Desde</label>
            <input type="date" value={valor.desde} onChange={(e) => onCambio({ ...valor, desde: e.target.value })}
              className="h-11 border border-gray-300 rounded-lg px-3 text-base" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Hasta</label>
            <input type="date" value={valor.hasta} onChange={(e) => onCambio({ ...valor, hasta: e.target.value })}
              className="h-11 border border-gray-300 rounded-lg px-3 text-base" />
          </div>
        </div>
      )}
    </div>
  );
}
