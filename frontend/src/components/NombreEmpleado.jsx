import { useLayoutEffect, useRef, useState } from 'react';

/**
 * "Nombre Apellido"; solo en móvil, si no cabe, el apellido se corta a cinco
 * letras ("Sofía Monrr."). Se mide con un nodo oculto con el nombre completo.
 *
 * @param nombre, apellido partes del nombre (apellido opcional).
 * @param className tipografía, aplicada al texto y al medidor.
 */
export default function NombreEmpleado({ nombre, apellido, className = '' }) {
  const visibleRef = useRef(null);
  const medidorRef = useRef(null);
  const [cortar, setCortar] = useState(false);
  const [esMovil, setEsMovil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );

  const full  = [nombre, apellido].filter(Boolean).join(' ') || '—';
  const corto = apellido ? `${nombre} ${apellido.slice(0, 5)}.` : full;

  useLayoutEffect(() => {
    const medir = () => {
      const movil = window.matchMedia('(max-width: 767px)').matches;
      setEsMovil(movil);
      // En escritorio nunca se acorta.
      if (!movil) { setCortar(false); return; }
      if (!visibleRef.current || !medidorRef.current) return;
      setCortar(medidorRef.current.scrollWidth > visibleRef.current.clientWidth);
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [full]);

  return (
    <span className="relative block min-w-0">
      <span ref={visibleRef} className={`block ${esMovil ? 'truncate' : ''} ${className}`}>
        {cortar ? corto : full}
      </span>
      {/* Nodo oculto para medir el ancho del nombre completo. */}
      <span
        ref={medidorRef}
        aria-hidden
        className={`absolute -left-[9999px] top-0 whitespace-nowrap invisible ${className}`}
      >
        {full}
      </span>
    </span>
  );
}
