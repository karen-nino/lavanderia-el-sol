import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Selector from './Selector';

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

  // La ventana con tarjetas para elegir el producto de un renglón. Se abre
  // desde "Elegir" o desde "Cambiar": cambia solo el botón que la dispara.
  const selectorDe = (r, opciones, elegido, quedanDe, bloqueado, c, etiqueta, disparador) => (
    <Selector
      valor={elegido ?? ''}
      onChange={(v) => guardar(c, r.tipoId, Number(v), r.cantidad)}
      deshabilitado={bloqueado}
      titulo={`${nombreTipo(r.tipoId)} · ${etiqueta}`}
      opciones={opciones.map(p => ({
        valor: p.id,
        etiqueta: p.nombre,
        // Lo que queda, en medidas; el que no alcanza no se elige.
        detalle: quedanDe(p) > 0 ? `quedan ${quedanDe(p)}` : 'agotado',
        deshabilitado: elegido !== p.id && quedanDe(p) < r.cantidad,
      }))}
      disparador={disparador}
    />
  );

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
                <div key={r.tipoId} className="flex items-center justify-between gap-3">
                  {/* Sin producto, a la derecha va solo "Elegir", en el lugar de
                      las medidas; elegido, abajo del nombre sale cuál es (con
                      "Cambiar") y a la derecha las medidas (2026-10-02). */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{nombreTipo(r.tipoId)}</p>
                    {opciones.length === 0 ? (
                      <p className="text-xs text-gray-400 mt-0.5">
                        No hay {nombreTipo(r.tipoId).toLowerCase()} en Inventario: dalo de alta o asígnale su tipo al producto.
                      </p>
                    ) : r.producto && selectorDe(r, opciones, elegido, quedanDe, bloqueado, c, etiqueta,
                      ({ abrir, elegida, deshabilitado }) => (
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {elegida?.etiqueta ?? r.producto.nombre}
                          {' · '}
                          <button
                            type="button"
                            onClick={abrir}
                            disabled={deshabilitado}
                            aria-label={`Cambiar ${nombreTipo(r.tipoId).toLowerCase()} de ${etiqueta}`}
                            className="font-medium text-blue hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            Cambiar
                          </button>
                        </p>
                      ))}
                  </div>

                  {!r.producto ? (
                    opciones.length > 0 && selectorDe(r, opciones, elegido, quedanDe, bloqueado, c, etiqueta,
                      ({ abrir, deshabilitado }) => (
                        <button
                          type="button"
                          onClick={abrir}
                          disabled={deshabilitado}
                          aria-label={`Elegir ${nombreTipo(r.tipoId).toLowerCase()} de ${etiqueta}`}
                          className="h-9 px-5 rounded-full bg-light-blue text-blue text-sm font-semibold hover:bg-blue hover:text-white disabled:opacity-40 transition-colors flex-shrink-0"
                        >
                          Elegir
                        </button>
                      ))
                  ) : (
                    // Las medidas del producto elegido.
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
