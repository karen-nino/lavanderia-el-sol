import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const PinIcon = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
    <circle cx="12" cy="11" r="2.5" strokeWidth={2} />
  </svg>
);

const ChevronIcon = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

// Pantalla completa que un admin ve al iniciar sesión para elegir a qué
// sucursal quiere entrar. La monta SucursalGate cuando el usuario es admin
// (no admin_main) y todavía no tiene una sucursal activa. Al elegir, fija la
// sucursal sin recargar y el gate deja pasar al panel.
export default function SeleccionarSucursal() {
  const { setSucursalActiva, logout } = useAuth();
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    api.get('/sucursales')
      .then((d) => { if (activo) setSucursales(d ?? []); })
      .catch(() => {})
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  const elegir = (slug) => setSucursalActiva(slug, { reload: false });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-dark-blue flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3 select-none">🫧</div>
          <h1 className="text-2xl font-bold text-white">Lavandería El Sol</h1>
          <p className="text-slate-400 text-sm mt-1">¿A qué sucursal quieres entrar?</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          {cargando ? (
            <div className="py-8 text-center text-base text-gray-400">Cargando sucursales...</div>
          ) : sucursales.length === 0 ? (
            <div className="py-8 text-center text-base text-gray-400">
              No hay sucursales disponibles.
            </div>
          ) : (
            <div className="space-y-3">
              {sucursales.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => elegir(s.slug)}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-xl border border-gray-200 text-left hover:border-blue hover:bg-light-blue/50 transition-colors group"
                >
                  <span className="w-10 h-10 rounded-lg bg-light-blue/70 text-blue flex items-center justify-center shrink-0">
                    {PinIcon}
                  </span>
                  <span className="flex-1 text-base font-medium text-dark-blue">{s.nombre}</span>
                  <span className="text-gray-300 group-hover:text-blue transition-colors">{ChevronIcon}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={logout}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
