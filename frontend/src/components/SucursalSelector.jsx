import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { esAdmin } from '../lib/roles';
import { api } from '../lib/api';

const PinIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
    <circle cx="12" cy="11" r="2.5" strokeWidth={2} />
  </svg>
);

const ChevronIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// Selector de la sucursal que administra un admin. Solo se muestra a los
// administradores; a los empleados el backend los fuerza a su sucursal.
// variant "header": chip compacto (encabezado de escritorio).
// variant "menu":  fila de ancho completo (modal de menú / móvil).
export default function SucursalSelector({ variant = 'header' }) {
  const { usuario, sucursalActiva, setSucursalActiva } = useAuth();
  const [sucursales, setSucursales] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!esAdmin(usuario?.rol) || usuario?.es_prueba) return;
    let activo = true;
    api.get('/sucursales')
      .then((d) => { if (activo) setSucursales(d ?? []); })
      .catch(() => {});
    return () => { activo = false; };
  }, [usuario?.rol, usuario?.es_prueba]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // El usuario de prueba tiene una sola sucursal (la oculta) y no puede salir
  // de ella: no se le muestra el selector.
  if (!esAdmin(usuario?.rol) || usuario?.es_prueba) return null;

  const activa = sucursalActiva || usuario?.sucursal;
  const actual = sucursales.find((s) => s.slug === activa);
  const label = actual?.nombre ?? 'Sucursal';

  const seleccionar = (slug) => {
    setOpen(false);
    setSucursalActiva(slug); // recarga si cambió
  };

  const triggerCls =
    variant === 'menu'
      ? 'w-full flex items-center gap-3 px-3 py-3 rounded-card-sm text-dark-blue hover:bg-light-blue/60 transition-colors'
      : 'flex items-center gap-2 px-3 py-2 rounded-pill bg-light-blue/60 text-dark-blue hover:bg-light-blue transition-colors';

  return (
    <div ref={ref} className={variant === 'menu' ? 'relative w-full' : 'relative'}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={triggerCls}>
        {variant === 'menu' ? (
          <span className="w-10 h-10 rounded-card-sm bg-light-blue/60 text-blue flex items-center justify-center">
            {PinIcon}
          </span>
        ) : (
          <span className="text-blue">{PinIcon}</span>
        )}
        <span className={`font-medium ${variant === 'menu' ? 'text-base flex-1 text-left' : 'text-sm'}`}>
          {label}
        </span>
        <span className="text-grey">{ChevronIcon}</span>
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 min-w-[14rem] bg-white rounded-card-sm shadow-xl border border-light-blue/60 p-1 ${
            variant === 'menu' ? 'left-0 right-0' : 'right-0'
          }`}
        >
          {sucursales.map((s) => {
            const activo = s.slug === activa;
            return (
              <button
                key={s.slug}
                type="button"
                onClick={() => seleccionar(s.slug)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-card-sm text-left text-sm transition-colors ${
                  activo ? 'bg-light-blue text-blue font-semibold' : 'text-dark-blue hover:bg-light-blue/50'
                }`}
              >
                <span className={activo ? 'text-blue' : 'text-grey'}>{PinIcon}</span>
                <span className="flex-1">{s.nombre}</span>
                {activo && (
                  <svg className="w-4 h-4 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
