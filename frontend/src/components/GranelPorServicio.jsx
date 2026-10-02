import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Granel de cada servicio Por Encargo, en Salidas (migs. 132-134).
//
// Al crear la nota cada servicio sabe CUÁNTO lleva de cada tipo de granel
// (Ajustes → Servicios Por Encargo) pero no CUÁL producto: eso lo elige aquí el
// empleado, servicio por servicio. Elegir aparta la existencia; también puede
// cambiar el producto o las medidas. Mientras algún servicio tenga algo por
// elegir, el servidor no deja iniciar las lavadoras de la nota.

const NOMBRE_TAMANO = { chico: 'Chico', mediano: 'Mediano', grande: 'Grande', jumbo: 'Jumbo' };

const esEdredon = (c) => String(c?.tipo_prenda ?? '').toUpperCase() === 'EDREDON';
// Los servicios que llevan granel (los de ropa y el edredón).
const claveLigue = (c) => (esEdredon(c) ? 'edredon' : (['chico', 'mediano', 'grande'].includes(c?.tamano) ? c.tamano : null));
const nombreServicio = (c) => (esEdredon(c)
  ? (c.tamano_edredon ? `Edredón ${c.tamano_edredon}` : 'Edredón')
  : (NOMBRE_TAMANO[c?.tamano] ?? 'Servicio'));
const disponible = (p) => Number(p?.stock_disponible ?? p?.stock_actual) || 0;

export default function GranelPorServicio({ nota, puedeEditar, onCambio }) {
  const [catalogo, setCatalogo] = useState([]);
  const [tipos, setTipos]       = useState([]);
  const [ocupado, setOcupado]   = useState(null); // `${cargaId}-${tipoId}` en proceso
  const [error, setError]       = useState('');

  // El catálogo se vuelve a pedir cuando cambia la nota: lo que queda de cada
  // producto cambia al elegir.
  useEffect(() => {
    if (nota?.tipo_servicio !== 'POR_ENCARGO') return undefined;
    let vivo = true;
    Promise.all([api.get('/productos'), api.get('/etiquetas/tipos-granel')])
      .then(([prods, ts]) => { if (vivo) { setCatalogo(prods ?? []); setTipos(ts ?? []); } })
      .catch(() => { /* sin catálogo la sección no se puede armar; el resto de Salidas sigue */ });
    return () => { vivo = false; };
  }, [nota]);

  const porId = new Map(catalogo.map(p => [p.id, p]));
  const nombreTipo = (id) => tipos.find(t => t.id === id)?.nombre ?? 'Granel';
  const ordenTipo  = (id) => { const i = tipos.findIndex(t => t.id === id); return i < 0 ? 999 : i; };

  // Un renglón por tipo de granel que el servicio lleva: los que están por
  // elegir y los que ya tienen producto.
  const renglonesDe = (c) => {
    const renglones = new Map();
    for (const pe of (c.pendientes ?? [])) {
      renglones.set(pe.tipo_granel_id, { tipoId: pe.tipo_granel_id, cantidad: Number(pe.cantidad), producto: null });
    }
    for (const np of (c.productos ?? [])) {
      const tipoId = porId.get(np.producto_id)?.tipo_granel_id;
      if (tipoId == null) continue;
      renglones.set(tipoId, { tipoId, cantidad: Number(np.cantidad), producto: np });
    }
    return [...renglones.values()].sort((a, b) => ordenTipo(a.tipoId) - ordenTipo(b.tipoId));
  };

  // Los servicios de la nota que llevan granel, numerados cuando se repiten.
  const servicios = (nota?.cargas ?? []).filter(c => claveLigue(c));
  const conGranel = servicios
    .map(c => {
      const mismos = servicios.filter(x => nombreServicio(x) === nombreServicio(c));
      const etiqueta = mismos.length > 1 ? `${nombreServicio(c)} ${mismos.indexOf(c) + 1}` : nombreServicio(c);
      return { carga: c, etiqueta, renglones: renglonesDe(c) };
    })
    .filter(s => s.renglones.length > 0);

  if (nota?.tipo_servicio !== 'POR_ENCARGO' || conGranel.length === 0) return null;

  const porElegir = conGranel.some(s => s.renglones.some(r => !r.producto));

  // Opciones de un tipo: los graneles de ese tipo (sirven para cualquier
  // servicio, mig. 135), más el que ya tenga puesto aunque ya no sea de ese tipo.
  const opcionesDe = (tipoId, actual) => {
    const lista = catalogo.filter(p => p.tipo_granel_id === tipoId);
    if (actual && !lista.some(p => p.id === actual.producto_id)) {
      const p = porId.get(actual.producto_id);
      if (p) lista.push(p);
    }
    return lista;
  };

  const guardar = async (c, tipoId, productoId, cantidad) => {
    if (cantidad < 1) return;
    setOcupado(`${c.id}-${tipoId}`);
    setError('');
    try {
      await api.put(`/notas/${nota.id}/cargas/${c.id}/granel/${tipoId}`, {
        producto_id: productoId ?? null, cantidad,
      });
      await onCambio?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">Granel de cada servicio</h2>
        {porElegir && (
          <p className="text-xs text-amber-700 mt-0.5">
            Elige qué usa cada servicio. Mientras falte alguno no se puede iniciar la lavadora.
          </p>
        )}
      </div>
      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}
      <div className="divide-y divide-gray-100">
        {conGranel.map(({ carga: c, etiqueta, renglones }) => (
          <div key={c.id} className="px-4 py-3 space-y-3">
            <p className="text-sm font-semibold text-gray-900">{etiqueta}</p>
            {renglones.map(r => {
              const opciones = opcionesDe(r.tipoId, r.producto);
              const bloqueado = !puedeEditar || ocupado != null;
              const elegido = r.producto?.producto_id ?? null;
              // Lo que queda de un producto no cuenta lo que este mismo
              // servicio ya tiene apartado de él.
              const quedanDe = (p) => disponible(p) + (elegido === p.id ? r.cantidad : 0);
              return (
                <div key={r.tipoId} className="space-y-1.5">
                  <p className="text-sm text-gray-700">
                    {nombreTipo(r.tipoId)}
                    {!r.producto && (
                      <span className="ml-2 text-xs font-semibold text-amber-700">Por elegir</span>
                    )}
                  </p>
                  {opciones.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      No hay {nombreTipo(r.tipoId).toLowerCase()} en Inventario: dalo de alta o asígnale su tipo al producto.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      {/* El producto: lo que queda va entre paréntesis y el que
                          no alcanza para las medidas no se puede elegir. */}
                      <select
                        value={elegido ?? ''}
                        onChange={(e) => e.target.value && guardar(c, r.tipoId, Number(e.target.value), r.cantidad)}
                        disabled={bloqueado}
                        aria-label={`${nombreTipo(r.tipoId)} de ${etiqueta}`}
                        className={`flex-1 min-w-0 px-3 py-2.5 border rounded-lg bg-white text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500 ${
                          r.producto ? 'border-gray-300' : 'border-amber-300'
                        }`}
                      >
                        {!r.producto && <option value="">Elegir…</option>}
                        {opciones.map(p => (
                          <option key={p.id} value={p.id} disabled={elegido !== p.id && quedanDe(p) < r.cantidad}>
                            {p.nombre} ({quedanDe(p) > 0 ? quedanDe(p) : 'agotado'})
                          </option>
                        ))}
                      </select>
                      {/* Las medidas: del que está por elegir o del ya elegido. */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => guardar(c, r.tipoId, elegido, r.cantidad - 1)}
                          disabled={bloqueado || r.cantidad <= 1}
                          aria-label={`Menos medidas de ${nombreTipo(r.tipoId)}`}
                          className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-gray-900 tabular-nums">{r.cantidad}</span>
                        <button
                          type="button"
                          onClick={() => guardar(c, r.tipoId, elegido, r.cantidad + 1)}
                          disabled={bloqueado}
                          aria-label={`Más medidas de ${nombreTipo(r.tipoId)}`}
                          className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
