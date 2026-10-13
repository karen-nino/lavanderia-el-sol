import { useEffect, useId, useRef, useState } from 'react';

/**
 * Desplegable con la lista pintada por la app (la de un `<select>` nativo la
 * dibuja el sistema y no se parece al campo). Mide lo mismo que los campos de
 * formulario (`px-4 py-3.5`).
 *
 * Maneja a mano lo que el nativo da: teclado (flechas, Enter, Esc, Inicio/Fin),
 * cerrar al clicar fuera y roles ARIA.
 *
 * @param valor el valor elegido ('' si ninguno).
 * @param onChange recibe el valor, no un evento.
 * @param opciones [{ valor, etiqueta }], solo lo elegible.
 * @param marcador texto gris mientras no hay nada elegido.
 * @param deshabilitado, etiquetaAria, id, className
 */
export default function Desplegable({
  valor,
  onChange,
  opciones,
  marcador = 'Seleccionar',
  deshabilitado = false,
  etiquetaAria,
  id,
  className = '',
}) {
  const [abierto, setAbierto] = useState(false);
  // Opción "marcada" con el teclado, que no es la elegida hasta dar Enter.
  const [activo, setActivo] = useState(0);
  // Hacia arriba cuando abajo no cabe (p. ej. la última tarjeta en el teléfono).
  const [haciaArriba, setHaciaArriba] = useState(false);
  const caja = useRef(null);
  const disparador = useRef(null);
  const lista = useRef(null);
  const autoId = useId();
  const idLista = `${id ?? autoId}-lista`;

  const indiceElegido = Math.max(0, opciones.findIndex(o => o.valor === valor));
  const elegida = opciones.find(o => o.valor === valor) ?? null;

  // Cerrar al clicar fuera. `mousedown`: con `click`, un arrastre que termina
  // fuera dejaría la lista abierta.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  // La opción marcada tiene que verse aunque la lista tenga scroll.
  useEffect(() => {
    if (!abierto || !lista.current) return;
    // `scrollIntoView?.`: jsdom no lo implementa.
    lista.current.querySelector(`[data-i="${activo}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [abierto, activo]);

  const abrir = () => {
    if (deshabilitado) return;
    // Se decide el lado antes de pintar, para que la lista no salte.
    const r = disparador.current?.getBoundingClientRect();
    const alto = Math.min(opciones.length * 56 + 16, 320);
    setHaciaArriba(Boolean(r) && r.bottom + alto > window.innerHeight && r.top > alto);
    setActivo(indiceElegido);
    setAbierto(true);
  };

  const elegir = (i) => {
    onChange(opciones[i].valor);
    setAbierto(false);
    disparador.current?.focus();
  };

  const teclado = (e) => {
    if (deshabilitado) return;
    if (!abierto) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActivo(i => Math.min(i + 1, opciones.length - 1)); break;
      case 'ArrowUp':   e.preventDefault(); setActivo(i => Math.max(i - 1, 0)); break;
      case 'Home':      e.preventDefault(); setActivo(0); break;
      case 'End':       e.preventDefault(); setActivo(opciones.length - 1); break;
      case 'Enter':
      case ' ':         e.preventDefault(); elegir(activo); break;
      case 'Escape':    e.preventDefault(); setAbierto(false); disparador.current?.focus(); break;
      case 'Tab':       setAbierto(false); break;
      default: break;
    }
  };

  return (
    <div ref={caja} className={`relative ${className}`}>
      <button
        ref={disparador}
        id={id}
        type="button"
        disabled={deshabilitado}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={teclado}
        role="combobox"
        aria-expanded={abierto}
        aria-haspopup="listbox"
        aria-controls={abierto ? idLista : undefined}
        aria-label={etiquetaAria}
        className={`w-full px-4 py-3.5 border rounded-lg text-base text-left flex items-center justify-between gap-2 transition
          focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent
          ${deshabilitado
            ? 'bg-gray-50 text-gray-400 border-gray-300 cursor-not-allowed'
            : `bg-white ${abierto ? 'border-blue' : 'border-gray-300 hover:border-gray-400'}`}`}
      >
        <span className={`truncate ${elegida ? 'text-gray-900' : 'text-gray-400'}`}>
          {elegida?.etiqueta ?? marcador}
        </span>
        <svg
          className={`w-5 h-5 flex-shrink-0 text-gray-500 transition-transform ${abierto ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {abierto && (
        <ul
          ref={lista}
          id={idLista}
          role="listbox"
          aria-activedescendant={`${idLista}-${activo}`}
          className={`absolute z-30 w-full max-h-80 overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-lg
            ${haciaArriba ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {opciones.map((o, i) => {
            const puesta = o.valor === valor;
            return (
              <li
                key={o.valor}
                id={`${idLista}-${i}`}
                data-i={i}
                role="option"
                aria-selected={puesta}
                // `mousedown` corre antes de perder el foco: la lista no se cierra antes de elegir.
                onMouseDown={(e) => { e.preventDefault(); elegir(i); }}
                onMouseEnter={() => setActivo(i)}
                className={`px-4 py-3.5 text-base cursor-pointer flex items-center justify-between gap-2
                  border-b last:border-0 border-gray-100
                  ${puesta
                    ? 'bg-light-blue text-blue font-semibold'
                    : `text-gray-900 ${i === activo ? 'bg-gray-50' : ''}`}`}
              >
                <span className="truncate">{o.etiqueta}</span>
                {puesta && (
                  <svg className="w-5 h-5 flex-shrink-0 text-blue" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
