/**
 * Elegir las máquinas de una nota de Autoservicio, al darla de alta.
 *
 * Es el mismo gesto que "Asignar máquina" de Salidas: las máquinas libres de la
 * sucursal, partidas en Lavadoras y Secadoras, con su tamaño. La diferencia es
 * que aquí no se asigna nada todavía: lo elegido se queda en el formulario y
 * viaja con la nota al crearla, que es lo que permite cobrarla desde el alta
 * —ya se sabe qué máquina usó el cliente, y con ella su tarifa—.
 *
 * Aquí no van los PRECIOS: lo que se elige es qué máquina, y el dinero se lee
 * de un tirón donde se cobra —el renglón de cada máquina y el resumen de la
 * nota—, no repetido en cada opción de una lista de la que solo se marca una.
 *
 * Se pueden marcar VARIAS de una vez: cada una entra como una máquina más de la
 * nota (su propio renglón, con su precio), así que el mostrador elige de un
 * tirón todo lo que va a usar el cliente.
 *
 * Aquí solo se ofrece lo que está libre de verdad: ni en uso, ni apuntado ya en
 * otra nota abierta. En Salidas esas últimas sí se ofrecen —asignar no aparta,
 * y ahí el empleado tiene la ropa delante y decide si se arriesga a que el otro
 * inicie primero—, pero al dar de alta la nota se estaría vendiendo una máquina
 * que otro cliente puede arrancar antes, y aquí ya se cobra por ella. El
 * servidor lo vuelve a comprobar al guardar.
 */

import { marcaYTamano } from '../lib/estadoMaquina';

// Casilla de selección, igual que la del modal de Salidas.
function SelCheck({ on }) {
  return (
    <span className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
      on ? 'border-blue bg-blue text-white' : 'border-gray-300 bg-white'
    }`}>
      {on && (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

// Valor con que el renglón "Edredón" entra a la selección (2026-10-02). No es
// una máquina: es una carga de edredón que se cobra con su tarifa y cuya
// lavadora —la que esté libre— se asigna después, en Salidas.
export const SELECCION_EDREDON = 'edredon';

function FilaMaquina({ maquina, seleccionada, onToggle }) {
  // "LG · Mediana": con la marca se distingue qué máquina es de un vistazo.
  const tamano = marcaYTamano(maquina);
  return (
    <button
      type="button"
      onClick={() => onToggle(maquina.id)}
      className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
        seleccionada ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <SelCheck on={seleccionada} />
        <span className="font-medium text-gray-800 truncate">{maquina.nombre}</span>
      </span>
      <span className="flex items-center gap-2 flex-shrink-0">
        {tamano && <span className="text-xs text-gray-500">{tamano}</span>}
      </span>
    </button>
  );
}

export default function ElegirMaquinasModal({
  abierto,
  maquinas = [],
  seleccion = [],
  cargando = false,
  error = '',
  onToggle,
  onConfirmar,
  onCancelar,
  ofrecerEdredon = false,
}) {
  if (!abierto) return null;

  const lavadoras = maquinas.filter(m => m.tipo !== 'secadora');
  const secadoras = maquinas.filter(m => m.tipo === 'secadora');
  const marcada = (m) => seleccion.some(id => String(id) === String(m.id));
  const edredonMarcado = seleccion.some(id => String(id) === SELECCION_EDREDON);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">Agregar máquina</h3>
          <p className="text-sm text-gray-500 mt-1">
            Elige las máquinas que va a usar el cliente. Cada una entra con{' '}
            <span className="font-medium text-gray-700">su tarifa</span>; quedan asignadas y se
            inician después, en Salidas.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        {cargando ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
          </div>
        ) : lavadoras.length === 0 && secadoras.length === 0 && !ofrecerEdredon ? (
          <p className="text-sm text-gray-400 text-center py-6">No hay máquinas disponibles.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lavadoras</p>
              {lavadoras.length === 0 ? (
                <p className="text-sm text-gray-400">No hay lavadoras disponibles.</p>
              ) : (
                lavadoras.map(m => (
                  <FilaMaquina
                    key={m.id} maquina={m} seleccionada={marcada(m)} onToggle={onToggle}
                  />
                ))
              )}
              {/* Hasta abajo de las lavadoras: el Edredón se vende con su
                  tarifa y su lavadora se asigna en Salidas (2026-10-02). */}
              {ofrecerEdredon && (
                <FilaMaquina
                  maquina={{ id: SELECCION_EDREDON, nombre: 'Edredón', tipo: 'edredon' }}
                  seleccionada={edredonMarcado}
                  onToggle={onToggle}
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Secadoras</p>
              {secadoras.length === 0 ? (
                <p className="text-sm text-gray-400">No hay secadoras disponibles.</p>
              ) : (
                secadoras.map(m => (
                  <FilaMaquina
                    key={m.id} maquina={m} seleccionada={marcada(m)} onToggle={onToggle}
                  />
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={seleccion.length === 0}
            className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {seleccion.length > 1 ? `Agregar (${seleccion.length})` : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  );
}
