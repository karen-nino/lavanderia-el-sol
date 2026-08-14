import { useLayoutEffect, useRef, useState } from 'react';

// Muestra "nombre apellido" completo. Solo en MÓVIL, si no cabe en el ancho
// disponible, corta el apellido a cinco letras (en vez de bajar de renglón o
// salir con "..."). Ej.: "Sofía Monrraz" → "Sofía Monrr.". En escritorio nunca
// se acorta: se muestra el nombre completo. Se mide con un nodo oculto que
// siempre lleva el nombre completo.
//   nombre / apellido: partes del nombre del empleado (apellido opcional)
//   className: clases de tipografía (tamaño, peso, color); se aplican tanto al
//              texto visible como al medidor para que la medición coincida.
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
