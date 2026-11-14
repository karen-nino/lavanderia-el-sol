import { useState } from 'react';
import { api } from '../lib/api';
import { textoFichas } from '../lib/fichas';
import Selector from './Selector';
import ConfirmacionModal from './ConfirmacionModal';

const BOTON_CLS = 'flex-shrink-0 px-5 py-3.5 rounded-lg bg-blue text-white text-base font-medium hover:opacity-90 disabled:opacity-40';

/** Valor del Selector para "Sin tipo" (el Selector trata '' como nada elegido). */
const SIN_TIPO = 'sin';

/**
 * Campo de cuántas fichas hay con su Guardar: `valor` es el guardado y
 * `onGuardar(n)` guarda el nuevo; "Guardado ✓" un momento al terminar.
 */
function CampoTotal({ valor, etiquetaAria, inputCls, deshabilitado, onGuardar }) {
  const [texto, setTexto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);
  const actual = texto ?? String(valor);
  const cambio = actual !== String(valor);
  const guardar = async () => {
    setGuardando(true);
    try {
      if (await onGuardar(Number(actual))) {
        setTexto(null);
        setOk(true);
        setTimeout(() => setOk(false), 2200);
      }
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" inputMode="numeric" min="0" step="1" value={actual}
        aria-label={etiquetaAria}
        disabled={deshabilitado}
        onChange={e => setTexto(e.target.value)}
        className={inputCls}
      />
      <span className="text-sm text-gray-500 flex-shrink-0">fichas</span>
      <button
        type="button"
        disabled={deshabilitado || !cambio || actual === '' || guardando}
        onClick={guardar}
        className={BOTON_CLS}
      >
        {ok ? 'Guardado ✓' : guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}

/**
 * Ajustes → Fichas, dentro de una sucursal que usa fichas (mig. 179): sus
 * tipos de ficha con cuántas hay de cada uno, el conteo "Sin tipo" para las
 * máquinas que no tienen, y el tipo de cada máquina. `sucursal` es el renglón
 * de GET /fichas/sucursales; `onFila` recibe el renglón nuevo tras cada cambio.
 */
export default function TiposFicha({ sucursal: s, inputCls, soloConsulta = false, onFila }) {
  const [error, setError] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [renombrando, setRenombrando] = useState(null); // { id, nombre }
  const [porQuitar, setPorQuitar] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [guardandoMaq, setGuardandoMaq] = useState(null);

  /** Llama a la API y pasa el renglón nuevo; devuelve si salió bien. */
  const enviar = async (llamada) => {
    setError('');
    try {
      const fila = await llamada();
      if (fila) onFila(fila);
      return Boolean(fila);
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const agregar = async () => {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setAgregando(true);
    if (await enviar(() => api.post(`/fichas/sucursales/${s.slug}/tipos`, { nombre }))) setNuevo('');
    setAgregando(false);
  };

  const renombrar = async () => {
    const nombre = renombrando.nombre.trim();
    if (!nombre) return;
    setProcesando(true);
    if (await enviar(() => api.patch(`/fichas/tipos/${renombrando.id}`, { nombre }))) setRenombrando(null);
    setProcesando(false);
  };

  const quitar = async () => {
    setProcesando(true);
    if (await enviar(() => api.delete(`/fichas/tipos/${porQuitar.id}`))) setPorQuitar(null);
    setProcesando(false);
  };

  const elegirTipo = async (maquina, valor) => {
    setGuardandoMaq(maquina.id);
    await enviar(() => api.patch(`/fichas/maquinas/${maquina.id}`, {
      ficha_tipo_id: valor === SIN_TIPO ? null : Number(valor),
    }));
    setGuardandoMaq(null);
  };

  const sinTipo = s.maquinas.filter(m => m.ficha_tipo_id == null);
  /* "Sin tipo" solo hace falta si hay máquinas sin tipo, fichas en ese conteo o ningún tipo. */
  const verSinTipo = s.tipos.length === 0 || sinTipo.length > 0 || s.fichas_disponibles !== 0 || s.fichas_dentro > 0;
  const opcionesTipo = [
    ...s.tipos.map(t => ({ valor: String(t.id), etiqueta: t.nombre })),
    { valor: SIN_TIPO, etiqueta: 'Sin tipo', detalle: 'conteo general' },
  ];

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      {/* Tipos de ficha: cada uno con su conteo. */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1.5">Tipos de ficha</p>
        {s.tipos.length > 0 && (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {s.tipos.map(t => (
              <div key={t.id} className="px-3 py-3 space-y-2">
                {renombrando?.id === t.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text" value={renombrando.nombre} autoFocus maxLength={60}
                      aria-label="Nombre del tipo de ficha"
                      onChange={e => setRenombrando({ id: t.id, nombre: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); renombrar(); } }}
                      className={inputCls}
                    />
                    <button type="button" onClick={renombrar} disabled={procesando || !renombrando.nombre.trim()}
                      className="text-sm font-medium text-blue px-2 disabled:opacity-40">Guardar</button>
                    <button type="button" onClick={() => setRenombrando(null)}
                      className="text-sm text-gray-400 px-2">Cancelar</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-gray-800 truncate">{t.nombre}</p>
                      {t.dentro > 0 && <p className="text-sm text-gray-500">{textoFichas(t.dentro)} dentro de las máquinas</p>}
                    </div>
                    {!soloConsulta && (
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button type="button" onClick={() => { setError(''); setRenombrando({ id: t.id, nombre: t.nombre }); }}
                          className="text-sm font-medium text-blue hover:underline">Renombrar</button>
                        <button type="button" onClick={() => { setError(''); setPorQuitar(t); }}
                          className="text-sm font-medium text-red-600 hover:underline">Quitar</button>
                      </div>
                    )}
                  </div>
                )}
                <CampoTotal
                  valor={t.disponibles}
                  etiquetaAria={`Fichas ${t.nombre} disponibles`}
                  inputCls={inputCls}
                  deshabilitado={soloConsulta}
                  onGuardar={(n) => enviar(() => api.patch(`/fichas/tipos/${t.id}`, { disponibles: n }))}
                />
              </div>
            ))}
          </div>
        )}
        {!soloConsulta && (
          <div className={`flex items-center gap-2 ${s.tipos.length > 0 ? 'mt-2' : ''}`}>
            <input
              type="text" value={nuevo} maxLength={60}
              placeholder="Agregar tipo de ficha"
              aria-label={`Agregar tipo de ficha en ${s.nombre}`}
              onChange={e => setNuevo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }}
              className={inputCls}
            />
            <button type="button" onClick={agregar} disabled={agregando || !nuevo.trim()} className={BOTON_CLS}>
              {agregando ? 'Agregando…' : 'Agregar'}
            </button>
          </div>
        )}
        <p className="text-sm text-gray-400 mt-1">
          Las que hay de cada tipo para usar, sin contar las que están dentro de las máquinas.
        </p>
      </div>

      {/* Conteo general, para las máquinas que no tienen tipo. */}
      {verSinTipo && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1.5">{s.tipos.length > 0 ? 'Fichas sin tipo' : 'Fichas disponibles'}</p>
          <CampoTotal
            valor={s.fichas_disponibles}
            etiquetaAria={`Fichas sin tipo en ${s.nombre}`}
            inputCls={inputCls}
            deshabilitado={soloConsulta}
            onGuardar={(n) => enviar(() => api.patch(`/fichas/sucursales/${s.slug}`, { fichas_disponibles: n }))}
          />
          <p className="text-sm text-gray-400 mt-1">
            {s.tipos.length > 0
              ? 'Las usan las máquinas que no tienen tipo de ficha. Si ya todas tienen, ponlo en 0.'
              : 'Las que hay para usar, sin contar las que están dentro de las máquinas.'}
            {s.fichas_dentro > 0 ? ` Dentro de las máquinas: ${s.fichas_dentro}.` : ''}
          </p>
        </div>
      )}

      {/* El tipo de ficha de cada máquina. */}
      {s.maquinas.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1.5">Máquinas</p>
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {s.maquinas.map(m => (
              <div key={m.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                <p className="text-base font-medium text-gray-800 min-w-0 truncate">{m.nombre}</p>
                <Selector
                  className="w-48 sm:w-56 flex-shrink-0"
                  claseCampo={inputCls}
                  valor={m.ficha_tipo_id == null ? SIN_TIPO : String(m.ficha_tipo_id)}
                  onChange={(v) => elegirTipo(m, v)}
                  titulo={`Tipo de ficha de ${m.nombre}`}
                  etiquetaAria={`Tipo de ficha de ${m.nombre}`}
                  deshabilitado={soloConsulta || guardandoMaq === m.id}
                  opciones={opcionesTipo}
                />
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-400 mt-1">Al iniciarla salen de las de su tipo y al recogerlas vuelven a él.</p>
        </div>
      )}

      {porQuitar && (
        <ConfirmacionModal
          titulo={`Quitar ${porQuitar.nombre}`}
          mensaje="Sus máquinas quedan sin tipo y usan las fichas sin tipo. El historial conserva el nombre."
          textoConfirmar="Quitar"
          procesando={procesando}
          error={error}
          onClose={() => { setPorQuitar(null); setError(''); }}
          onConfirm={quitar}
        />
      )}
    </div>
  );
}
