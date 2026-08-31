import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { esAdmin, ROL_LABEL } from '../lib/roles';
import { api } from '../lib/api';
import { formatHora12, formatFechaHora12 } from '../lib/fecha';
import SucursalSelector from './SucursalSelector';

const navIconCls = 'w-6 h-6';

const Icon = {
  brand: (
    <svg width="24" height="24" className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 4a3 3 0 110 6 3 3 0 010-6zm-1 8h2v3l3 .5v6h-2v-5l-2-.3v5h-2v-5l-2 .3v5H8v-6l3-.5v-3z" />
    </svg>
  ),
  dashboard: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3"  y="3"  width="7" height="7" rx="1.5" strokeWidth={2} />
      <rect x="14" y="3"  width="7" height="7" rx="1.5" strokeWidth={2} />
      <rect x="3"  y="14" width="7" height="7" rx="1.5" strokeWidth={2} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" strokeWidth={2} />
    </svg>
  ),
  maquinas: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth={2} />
      <circle cx="12" cy="13" r="4" strokeWidth={2} />
      <circle cx="8"  cy="6.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  notas: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="5" y="3" width="14" height="18" rx="2" strokeWidth={2} />
      <line x1="9"  y1="8"  x2="15" y2="8"  strokeWidth={2} strokeLinecap="round" />
      <line x1="9"  y1="12" x2="15" y2="12" strokeWidth={2} strokeLinecap="round" />
      <line x1="9"  y1="16" x2="13" y2="16" strokeWidth={2} strokeLinecap="round" />
    </svg>
  ),
  clientes: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="9"  cy="8" r="3" strokeWidth={2} />
      <circle cx="17" cy="9" r="2.5" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 20c0-3 2.5-5 6-5s6 2 6 5M15 20c0-2 1.8-4 4-4s2 2 2 4" />
    </svg>
  ),
  inventario: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10 2h4v3.2c0 .5.14 1 .4 1.44l1.2 2.02c.26.44.4.94.4 1.45V20a2 2 0 01-2 2H10a2 2 0 01-2-2V10.11c0-.51.14-1.01.4-1.45l1.2-2.02c.26-.43.4-.93.4-1.44V2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 13h8" />
    </svg>
  ),
  ventas: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v16h16" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 20v-4M12 20v-8M16 20V9" />
    </svg>
  ),
  caja: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="8" width="18" height="12" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18M7 8V5h6l2 3" />
      <circle cx="17" cy="14" r="1" fill="currentColor" />
    </svg>
  ),
  empleados: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  ajustes: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  logout: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  bell: (
    <svg width="32" height="32" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  menu: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  menuSm: (
    <svg width="20" height="20" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  close: (
    <svg width="20" height="20" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M6 6l12 12M6 18L18 6" />
    </svg>
  ),
};

const navItems = [
  { to: '/',           label: 'Dashboard',  icon: Icon.dashboard,  end: true },
  { to: '/maquinas',   label: 'Máquinas',   icon: Icon.maquinas },
  { to: '/notas',      label: 'Notas',      icon: Icon.notas },
  { to: '/clientes',   label: 'Clientes',   icon: Icon.clientes },
  { to: '/inventario', label: 'Inventario', icon: Icon.inventario },
];

// Navegación de escritorio: una sola lista ordenada por prioridad. El sidebar
// muestra los que quepan verticalmente y el resto pasa al menú de overflow, sin
// duplicar botones entre el sidebar y el modal.
const buildDesktopNav = (isAdmin) => [
  { to: '/',                 label: 'Dashboard',           icon: Icon.dashboard, end: true },
  { to: '/maquinas',         label: 'Máquinas',            icon: Icon.maquinas },
  { to: '/notas',            label: 'Notas',               icon: Icon.notas },
  { to: '/clientes',         label: 'Clientes',            icon: Icon.clientes },
  { to: '/inventario',       label: 'Inventario',          icon: Icon.inventario },
  ...(isAdmin ? [{ to: '/ventas', label: 'Ventas', icon: Icon.ventas }] : []),
  { to: '/caja',             label: 'Caja',                icon: Icon.caja },
  { to: '/gestion-maquinas', label: 'Gestión de máquinas', short: 'Gestión', icon: Icon.maquinas },
  ...(isAdmin ? [{ to: '/empleados', label: 'Empleados', icon: Icon.empleados }] : []),
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function SidebarItem({ to, label, short, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group flex flex-col items-center py-1 ${isActive ? 'gap-1.5' : 'gap-0'}`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`w-12 h-12 rounded-card-sm flex items-center justify-center transition-colors ${
              isActive
                ? 'bg-blue text-white'
                : 'bg-transparent text-dark-blue group-hover:bg-light-blue/60'
            }`}
          >
            {icon}
          </span>
          <span className={`text-[11px] font-medium ${isActive ? 'text-blue' : 'text-dark-blue'}`}>
            {short ?? label}
          </span>
        </>
      )}
    </NavLink>
  );
}

// Botón del pie del sidebar (Menú, Ajustes, Cerrar sesión).
function SidebarPieBoton({ icon, label, onClick, peligro = false, activo = false }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 py-1 w-full"
    >
      {/* Activo: igual que un ítem de navegación. En rojo (peligro): igual que
          Cerrar sesión dentro del menú. */}
      <span
        className={`w-12 h-12 rounded-card-sm flex items-center justify-center transition-colors ${
          activo
            ? 'bg-blue text-white'
            : peligro
              ? 'bg-red/10 text-red group-hover:bg-red/20'
              : 'text-dark-blue group-hover:bg-light-blue/60'
        }`}
      >
        {icon}
      </span>
      <span
        className={`text-[11px] font-medium leading-tight text-center ${
          activo ? 'text-blue' : peligro ? 'text-red' : 'text-dark-blue'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

// Hueco del alto de un botón del pie: reserva el espacio sin mostrar nada.
const RanuraVacia = () => (
  <div className="invisible" aria-hidden="true">
    <SidebarPieBoton icon={Icon.menu} label="—" />
  </div>
);

// Sidebar de escritorio: muestra los ítems de navegación que quepan; los que no,
// pasan al botón Menú, que abre el modal con esos accesos. Reporta al padre los
// ítems que no caben.
//
// El pie tiene SIEMPRE dos ranuras: si cambiara de alto según lo que muestre,
// cambiaría el espacio medido para los íconos y la capacidad oscilaría (con dos
// botones cabe menos → aparece overflow → vuelve un botón → cabe más…).
function DesktopSidebar({ items, onMenu, onOverflowChange, onSettings, onLogout }) {
  const { pathname } = useLocation();
  const slotRef = useRef(null);
  const [capacity, setCapacity] = useState(items.length);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    const GAP = 12; // gap-3 entre ítems
    const medir = () => {
      const primerItem = slot.firstElementChild;
      const itemH = primerItem?.offsetHeight ?? 64;
      const slotH = slot.clientHeight;
      const cap = Math.max(1, Math.floor((slotH + GAP) / (itemH + GAP)));
      setCapacity(cap);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [items.length]);

  const visibles = items.slice(0, capacity);
  const overflow = items.slice(capacity);

  useEffect(() => {
    onOverflowChange?.(overflow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overflow.map((i) => i.to).join('|')]);

  return (
    <aside className="hidden md:flex md:flex-col md:flex-shrink-0 w-24 bg-white border-r border-light-blue/60 py-8 px-2">
      <div className="flex justify-center mb-6 flex-shrink-0">
        <div className="w-12 h-12 rounded-card-sm bg-dark-blue flex items-center justify-center">
          {Icon.brand}
        </div>
      </div>

      <div ref={slotRef} className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
        {visibles.map((item) => (
          <SidebarItem key={item.to} {...item} />
        ))}
      </div>

      {/* Ranura de arriba: Ajustes solo cuando cabe todo y el usuario es admin.
          Ranura de abajo (la de siempre): Menú si algo no cupo, Salir si no.
          Las ranuras sin botón se dejan invisibles pero ocupando su lugar. */}
      <div className="flex-shrink-0 mt-3 flex flex-col gap-2">
        {overflow.length === 0 && onSettings ? (
          <SidebarPieBoton
            icon={Icon.ajustes}
            label="Ajustes"
            onClick={onSettings}
            activo={pathname.startsWith('/ajustes')}
          />
        ) : (
          <RanuraVacia />
        )}
        {overflow.length > 0 ? (
          <SidebarPieBoton icon={Icon.menu} label="Menú" onClick={onMenu} />
        ) : (
          <SidebarPieBoton icon={Icon.logout} label="Salir" onClick={onLogout} peligro />
        )}
      </div>
    </aside>
  );
}

function DesktopHeader({ usuario, sucursalNombre, now }) {
  const fecha = now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const hora  = formatHora12(now);
  return (
    <header className="hidden md:flex items-start justify-between w-full max-w-7xl mx-auto px-8 pt-14">
      <div className="flex items-center gap-2">
        <div className="w-12 h-12 rounded-pill bg-grey/30 flex items-center justify-center text-white font-bold text-lg">
          {usuario?.nombre?.[0]?.toUpperCase() ?? 'A'}
        </div>
        <div>
          <p className="text-kpi-label text-grey">{ROL_LABEL[usuario?.rol] ?? 'Usuario'}</p>
          <p className="text-2xl font-bold text-dark-blue">{[usuario?.nombre, usuario?.apellido].filter(Boolean).join(' ') || '—'}</p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <SucursalSelector />
        <div className="flex items-center gap-1 mt-2">
          <span className="w-2 h-2 rounded-pill bg-green" />
          <span className="text-kpi-label font-bold text-green uppercase tracking-wide">{sucursalNombre}</span>
        </div>
        <p className="text-sm font-medium text-grey mt-1">{fecha}</p>
        <p className="text-2xl font-bold text-dark-blue">{hora}</p>
      </div>
    </header>
  );
}

function MobileTopbar({ usuario, sucursalNombre, alertas, onAlerts }) {
  const count = alertas.length;
  const tieneAlertas = count > 0;
  const hayCritica = alertas.some(a => a.severity === 'agotado');
  const colorCls = tieneAlertas
    ? (hayCritica ? 'bg-light-red text-red' : 'bg-light-bronce text-bronce')
    : 'text-dark-blue';
  return (
    <header className="md:hidden flex items-start justify-between px-6 pt-10 pb-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-kpi-label text-grey">{ROL_LABEL[usuario?.rol] ?? 'Usuario'}</p>
          <p className="text-xl font-bold text-dark-blue pb-2">{[usuario?.nombre, usuario?.apellido].filter(Boolean).join(' ') || 'Usuario'}</p>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-pill bg-green" />
            <span className="text-kpi-label font-bold text-green uppercase tracking-wide">{sucursalNombre}</span>
          </div>
        </div>
      </div>
      <button
        onClick={onAlerts}
        aria-label={tieneAlertas ? `Ver ${count} alerta(s)` : 'Ver alertas'}
        className="relative pt-1 flex items-center justify-center"
      >
        <span className={`w-11 h-11 flex items-center justify-center rounded-pill transition-colors ${colorCls}`}>
          {Icon.bell}
        </span>
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[20px] h-5 px-1 bg-red text-white text-[11px] font-bold rounded-pill flex items-center justify-center ring-2 ring-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
    </header>
  );
}

const sevCls = (sev) =>
    sev === 'agotado'   ? 'bg-light-red text-red'
  : sev === 'ciclo'     ? 'bg-light-blue text-blue'
  : sev === 'cancelada' ? 'bg-light-red text-red'
  : sev === 'eliminada' ? 'bg-light-red text-red'
  : sev === 'pago'      ? 'bg-light-red text-red'
  : 'bg-light-bronce text-bronce';
const sevBadge = (sev) =>
    sev === 'agotado'   ? 'Agotado'
  : sev === 'ciclo'     ? 'Ciclo detenido'
  : sev === 'cancelada' ? 'Nota cancelada'
  : sev === 'eliminada' ? 'Nota eliminada'
  : sev === 'pago'      ? 'Pago revertido'
  : 'Por agotarse';
const AlertTriangle = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

function AlertsModal({ open, onClose, alertas, onSelect, onDismiss, onDismissAll }) {
  const [detalle, setDetalle] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  if (!open) return null;

  const cerrar = () => { setDetalle(null); setConfirmAll(false); onClose(); };
  // El botón "Descartar todas" solo tiene sentido con más de una descartable;
  // con una sola basta su propia X.
  const hayDescartables = alertas.filter(a => a.dismissable).length > 1;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-blue/40 p-4"
      onClick={cerrar}
    >
      <div
        className="w-full max-w-sm bg-white rounded-card shadow-xl p-5 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {detalle ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setDetalle(null)}
                  aria-label="Volver"
                  className="w-8 h-8 rounded-pill flex items-center justify-center text-grey hover:bg-light-blue/60 transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-card-title text-dark-blue font-bold truncate">{detalle.title}</h2>
              </div>
              <button
                onClick={cerrar}
                aria-label="Cerrar alertas"
                className="w-8 h-8 rounded-pill flex items-center justify-center text-grey hover:bg-light-blue/60 flex-shrink-0"
              >
                {Icon.close}
              </button>
            </div>

            <div className="overflow-y-auto space-y-4">
              <div className="flex items-center gap-3">
                <span className={`flex-shrink-0 w-10 h-10 rounded-pill flex items-center justify-center ${sevCls(detalle.severity)}`}>
                  {AlertTriangle}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill ${sevCls(detalle.severity)}`}>
                  {sevBadge(detalle.severity)}
                </span>
              </div>

              <div className="divide-y divide-gray-100 border border-gray-100 rounded-card-sm">
                {(detalle.detalles ?? []).map((d) => (
                  <div key={d.label} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <span className="text-xs text-grey flex-shrink-0">{d.label}</span>
                    <span className="text-sm font-medium text-dark-blue text-right">{d.value}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                {detalle.dismissable && onDismiss && (
                  <button
                    type="button"
                    onClick={() => { onDismiss(detalle); setDetalle(null); }}
                    className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    Descartar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { onSelect(detalle); setDetalle(null); }}
                  className="flex-1 bg-blue hover:opacity-90 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {detalle.accionLabel ?? 'Ver'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-card-title text-dark-blue font-bold">
                Alertas{alertas.length > 0 ? ` (${alertas.length})` : ''}
              </h2>
              <button
                onClick={cerrar}
                aria-label="Cerrar alertas"
                className="w-8 h-8 rounded-pill flex items-center justify-center text-grey hover:bg-light-blue/60"
              >
                {Icon.close}
              </button>
            </div>

            {hayDescartables && onDismissAll && (
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={() => setConfirmAll(true)}
                  className="text-xs font-semibold text-blue hover:opacity-80 transition-opacity"
                >
                  Descartar todas
                </button>
              </div>
            )}

            {alertas.length === 0 ? (
              <p className="text-sm text-grey text-center py-8">No hay alertas activas.</p>
            ) : (
              <div className="space-y-2 overflow-y-auto">
                {alertas.map(a => (
                  <div
                    key={a.key}
                    className="flex items-center gap-2 p-3 rounded-card-sm border border-gray-100 hover:bg-light-blue/40 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setDetalle(a)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                    >
                      <span className={`flex-shrink-0 w-9 h-9 rounded-pill flex items-center justify-center ${sevCls(a.severity)}`}>
                        {AlertTriangle}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-dark-blue truncate">{a.title}</p>
                        <p className="text-xs text-grey truncate">{a.description}</p>
                      </div>
                    </button>
                    <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-pill ${sevCls(a.severity)}`}>
                      {sevBadge(a.severity)}
                    </span>
                    {a.dismissable && onDismiss && (
                      <button
                        type="button"
                        onClick={() => onDismiss(a)}
                        aria-label="Descartar alerta"
                        className="flex-shrink-0 w-7 h-7 rounded-pill flex items-center justify-center text-grey hover:bg-gray-100 hover:text-dark-blue transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>

    {/* Confirmación antes de descartar todas las notificaciones */}
    {confirmAll && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-dark-blue/40 p-4"
        onClick={() => setConfirmAll(false)}
      >
        <div
          className="w-full max-w-xs bg-white rounded-card shadow-xl p-5 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <h3 className="text-card-title text-dark-blue font-bold">Descartar todas</h3>
            <p className="text-sm text-grey mt-1">
              Se ocultarán todas las notificaciones de la campana. Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmAll(false)}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => { onDismissAll(); setConfirmAll(false); }}
              className="flex-1 bg-red text-white font-medium py-2.5 rounded-lg text-sm hover:opacity-90 transition-opacity"
            >
              Descartar todas
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function MenuItemButton({ label, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-3 rounded-card-sm text-dark-blue hover:bg-light-blue/60 transition-colors"
    >
      <span className="w-10 h-10 rounded-card-sm bg-light-blue/60 text-blue flex items-center justify-center">
        {icon}
      </span>
      <span className="text-base font-medium">{label}</span>
    </button>
  );
}

// Modal Menú. En móvil muestra el menú completo (sucursal, accesos, ajustes,
// cerrar sesión). En desktop solo los accesos de navegación que no cupieron en
// el sidebar; el resto (ajustes/cerrar sesión) vive en el menú de cuenta.
function MenuModal({ open, onClose, mobileItems = [], desktopItems = [], onSettings, onLogout }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-blue/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-card shadow-xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-card-title text-dark-blue font-bold">Menú</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar menú"
            className="w-8 h-8 rounded-pill flex items-center justify-center text-grey hover:bg-light-blue/60"
          >
            {Icon.close}
          </button>
        </div>

        {/* Móvil: menú completo */}
        <div className="md:hidden flex flex-col gap-2">
          <SucursalSelector variant="menu" />
          {mobileItems.map((item) => (
            <MenuItemButton key={item.label} {...item} />
          ))}
          {onSettings && (
            <MenuItemButton label="Ajustes" icon={Icon.ajustes} onClick={onSettings} />
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-3 px-3 py-3 rounded-card-sm text-red hover:bg-red/10 transition-colors"
          >
            <span className="w-10 h-10 rounded-card-sm bg-red/10 text-red flex items-center justify-center">
              {Icon.logout}
            </span>
            <span className="text-base font-medium">Cerrar sesión</span>
          </button>
        </div>

        {/* Desktop: los accesos de navegación que no cupieron en el sidebar,
            más Ajustes y Cerrar sesión. */}
        <div className="hidden md:flex flex-col gap-2">
          {desktopItems.map((item) => (
            <MenuItemButton key={item.label} {...item} />
          ))}
          {onSettings && (
            <MenuItemButton label="Ajustes" icon={Icon.ajustes} onClick={onSettings} />
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-3 px-3 py-3 rounded-card-sm text-red hover:bg-red/10 transition-colors"
          >
            <span className="w-10 h-10 rounded-card-sm bg-red/10 text-red flex items-center justify-center">
              {Icon.logout}
            </span>
            <span className="text-base font-medium">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileBottomNav({ items, onMenu }) {
  return (
    <nav className="md:hidden flex items-center justify-around bg-white shadow-bottom-nav py-2 flex-shrink-0">
      {items.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-card-sm min-w-[56px] transition-colors ${
              isActive ? 'text-blue' : 'text-grey'
            }`
          }
        >
          {icon}
          <span className="text-[10px] font-medium">{label}</span>
        </NavLink>
      ))}
      <button
        onClick={onMenu}
        className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-card-sm min-w-[56px] text-grey transition-colors"
      >
        {Icon.menu}
        <span className="text-[10px] font-medium">Menú</span>
      </button>
    </nav>
  );
}

export default function Layout() {
  const { usuario, logout, sucursalActiva } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // true si el usuario que quiere salir es quien abrió la caja y sigue abierta.
  const [cajaSinCerrar, setCajaSinCerrar] = useState(false);
  const [productos, setProductos] = useState([]);
  const [notificaciones, setNotificaciones] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  // Alertas de stock ocultadas manualmente (por firma id+stock). Es solo de
  // sesión: reaparecen si cambia el stock o al recargar.
  const [stockOcultas, setStockOcultas] = useState(() => new Set());
  const isDashboard = location.pathname === '/';

  useEffect(() => {
    let activo = true;
    const cargar = () => {
      api.get('/productos')
        .then(data => { if (activo) setProductos(data ?? []); })
        .catch(() => {});
      api.get('/notificaciones')
        .then(data => { if (activo) setNotificaciones(data ?? []); })
        .catch(() => {});
    };
    cargar();
    // Refresco periódico para que las notificaciones aparezcan sin navegar.
    const id = setInterval(cargar, 60_000);
    return () => { activo = false; clearInterval(id); };
  }, [location.pathname]);

  // Lista de sucursales para mostrar el nombre de la sucursal actual en el
  // encabezado (el usuario guarda solo el slug).
  useEffect(() => {
    let activo = true;
    api.get('/sucursales')
      .then(data => { if (activo) setSucursales(data ?? []); })
      .catch(() => {});
    return () => { activo = false; };
  }, []);

  // Sucursal actual: la activa (admin) o la propia del usuario. Se muestra su
  // nombre; si aún no cargó la lista, se cae al slug como respaldo.
  const sucursalSlug = sucursalActiva || usuario?.sucursal || null;
  const sucursalNombre =
    sucursales.find(s => s.slug === sucursalSlug)?.nombre ?? sucursalSlug ?? '—';

  const alertas = useMemo(() => {
    const orden = { agotado: 0, por_agotarse: 1 };
    const stock = productos
      .filter(p => p.estado_stock && p.estado_stock !== 'ok')
      // Firma con el stock actual: si el stock cambia, la firma cambia y la
      // alerta vuelve a mostrarse aunque se hubiera ocultado.
      .filter(p => !stockOcultas.has(`producto-${p.id}:${p.stock_actual}`))
      .sort((a, b) => (orden[a.estado_stock] ?? 99) - (orden[b.estado_stock] ?? 99))
      .map(p => {
        const disponible = Number(p.stock_actual) - Number(p.stock_reservado ?? 0);
        return {
          key:         `producto-${p.id}`,
          dismissKey:  `producto-${p.id}:${p.stock_actual}`,
          dismissable: true,
          title:       (p.tipo_liquido === 'marca' && p.marca) ? p.marca : p.nombre,
          description: `Stock: ${Number(p.stock_actual).toFixed(2)} ${p.unidad}`,
          severity:    p.estado_stock,
          to:          `/inventario?highlight=${p.id}`,
          accionLabel: 'Ver en inventario',
          detalles: [
            { label: 'Producto',     value: p.nombre },
            { label: 'Estado',       value: p.estado_stock === 'agotado' ? 'Agotado' : 'Por agotarse' },
            { label: 'Stock actual', value: `${Number(p.stock_actual).toFixed(2)} ${p.unidad}` },
            { label: 'Disponible',   value: `${disponible.toFixed(2)} ${p.unidad}` },
            ...(p.marca ? [{ label: 'Marca', value: p.marca }] : []),
          ],
        };
      });
    // Alertas del líquido a granel (bidón) por acabarse o agotado.
    const granel = productos
      .filter(p => p.tipo_liquido === 'granel' && p.estado_granel && p.estado_granel !== 'ok')
      .filter(p => !stockOcultas.has(`granel-${p.id}:${p.stock_granel_tapas}`))
      .sort((a, b) => (orden[a.estado_granel] ?? 99) - (orden[b.estado_granel] ?? 99))
      .map(p => ({
        key:         `granel-${p.id}`,
        dismissKey:  `granel-${p.id}:${p.stock_granel_tapas}`,
        dismissable: true,
        title:       `${(p.tipo_liquido === 'marca' && p.marca) ? p.marca : p.nombre} — granel`,
        description: p.estado_granel === 'agotado' ? 'Sin líquido a granel' : 'Granel por acabarse',
        severity:    p.estado_granel,
        to:          `/inventario?highlight=${p.id}`,
        accionLabel: 'Ver en inventario',
        detalles: [
          { label: 'Producto', value: p.nombre },
          { label: 'Estado',   value: p.estado_granel === 'agotado' ? 'Sin granel' : 'Granel por acabarse' },
        ],
      }));

    const notifs = notificaciones.map(n => {
      const fechaHora = formatFechaHora12(n.created_at);
      // Cada tipo de notificación tiene su título, color, destino y detalles.
      const cfg =
          n.tipo === 'nota_cancelada'
            ? { title: 'Nota cancelada', severity: 'cancelada', to: '/notas', accionLabel: 'Ver notas',
                detalles: [
                  { label: 'Nota',          value: n.nota_folio ?? '—' },
                  { label: 'Cancelada por', value: n.usuario_nombre ?? '—' },
                  { label: 'Fecha y hora',  value: fechaHora },
                ] }
        : n.tipo === 'nota_eliminada'
            ? { title: 'Nota eliminada', severity: 'eliminada', to: '/notas', accionLabel: 'Ver notas',
                detalles: [
                  { label: 'Nota',          value: n.nota_folio ?? '—' },
                  { label: 'Eliminada por', value: n.usuario_nombre ?? '—' },
                  { label: 'Fecha y hora',  value: fechaHora },
                ] }
        : n.tipo === 'pago_revertido'
            ? { title: 'Pago revertido', severity: 'pago', to: '/notas', accionLabel: 'Ver notas',
                detalles: [
                  { label: 'Revertido por', value: n.usuario_nombre ?? '—' },
                  { label: 'Fecha y hora',  value: fechaHora },
                ] }
        : { title: 'Ciclo detenido', severity: 'ciclo', to: '/maquinas', accionLabel: 'Ver máquinas',
            detalles: [
              { label: 'Máquina',      value: n.maquina_nombre ?? '—' },
              { label: 'Detenida por', value: n.usuario_nombre ?? '—' },
              { label: 'Fecha y hora', value: fechaHora },
            ] };
      return {
        key:         `notif-${n.id}`,
        id:          n.id,
        description: n.mensaje,
        dismissable: true,
        ...cfg,
      };
    });
    return [...stock, ...granel, ...notifs];
  }, [productos, notificaciones, stockOcultas]);

  const handleDismissAlerta = async (a) => {
    // Alerta de stock (sin id): se oculta solo en esta sesión.
    if (!a.id) {
      setStockOcultas(prev => new Set(prev).add(a.dismissKey));
      return;
    }
    setNotificaciones(prev => prev.filter(n => n.id !== a.id));
    try { await api.post(`/notificaciones/${a.id}/descartar`); } catch { /* la lista ya se actualizó localmente */ }
  };

  // Descarta todo lo visible: las notificaciones en la base y las alertas de
  // stock se ocultan en esta sesión (reaparecen si cambia el stock o al recargar).
  const handleDismissTodas = async () => {
    setStockOcultas(prev => {
      const next = new Set(prev);
      alertas.forEach(a => { if (!a.id && a.dismissKey) next.add(a.dismissKey); });
      return next;
    });
    setNotificaciones([]);
    try { await api.post('/notificaciones/descartar-todas'); } catch { /* la lista ya se actualizó localmente */ }
  };

  const handleSelectAlerta = (a) => {
    setAlertsOpen(false);
    navigate(a.to);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    setCajaSinCerrar(false);
    // Si el propio usuario abrió la caja y sigue abierta, se le advierte antes
    // de cerrar sesión. Si la consulta falla, no se bloquea el cierre.
    try {
      const data = await api.get('/caja/actual');
      if (data?.abierta && String(data.caja?.usuario_apertura_id) === String(usuario?.id)) {
        setCajaSinCerrar(true);
      }
    } catch { /* ignorar */ }
    setConfirmLogout(true);
  };

  const confirmarLogout = () => {
    setConfirmLogout(false);
    logout();
    navigate('/login');
  };

  const irACaja = () => {
    setConfirmLogout(false);
    navigate('/caja?tab=corte');
  };

  const handleSettings = () => {
    setMenuOpen(false);
    navigate('/ajustes');
  };

  const goTo = (to) => {
    setMenuOpen(false);
    navigate(to);
  };

  const isAdmin = esAdmin(usuario?.rol);
  const desktopNav = useMemo(() => buildDesktopNav(isAdmin), [isAdmin]);

  const mobileBottomItems = navItems.filter((item) => item.to !== '/inventario');

  // Menú móvil: accesos que no están en la barra inferior (igual que antes).
  const menuExtraItems = [
    { label: 'Caja',                icon: Icon.caja,       onClick: () => goTo('/caja') },
    { label: 'Inventario',          icon: Icon.inventario, onClick: () => goTo('/inventario') },
    { label: 'Gestión de máquinas', icon: Icon.maquinas,   onClick: () => goTo('/gestion-maquinas') },
    ...(isAdmin
      ? [
          { label: 'Ventas',    icon: Icon.ventas,    onClick: () => goTo('/ventas') },
          { label: 'Empleados', icon: Icon.empleados, onClick: () => goTo('/empleados') },
        ]
      : []),
  ];

  // Accesos de navegación que no cupieron en el sidebar (desktop) → modal Menú.
  const [desktopOverflow, setDesktopOverflow] = useState([]);
  const desktopMenuItems = desktopOverflow.map((item) => ({
    label: item.label,
    icon: item.icon,
    onClick: () => goTo(item.to),
  }));

  return (
    <div className="flex h-full overflow-hidden">
      <DesktopSidebar
        items={desktopNav}
        onMenu={() => setMenuOpen(true)}
        onOverflowChange={setDesktopOverflow}
        onSettings={isAdmin ? handleSettings : undefined}
        onLogout={handleLogout}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {isDashboard && (
            <>
              <MobileTopbar usuario={usuario} sucursalNombre={sucursalNombre} alertas={alertas} onAlerts={() => setAlertsOpen(true)} />
              <DesktopHeader usuario={usuario} sucursalNombre={sucursalNombre} now={now} />
            </>
          )}
          <Outlet />
        </main>

        <MobileBottomNav
          items={mobileBottomItems}
          onMenu={() => setMenuOpen(true)}
        />
      </div>

      <MenuModal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        mobileItems={menuExtraItems}
        desktopItems={desktopMenuItems}
        onSettings={isAdmin ? handleSettings : undefined}
        onLogout={handleLogout}
      />

      <AlertsModal
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        alertas={alertas}
        onSelect={handleSelectAlerta}
        onDismiss={handleDismissAlerta}
        onDismissAll={handleDismissTodas}
      />

      {confirmLogout && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Cerrar sesión</h3>
            {cajaSinCerrar ? (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-sm text-amber-800">
                  Abriste la caja y aún se ha cerrado. Realiza el corte antes de salir.
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">¿Seguro que quieres cerrar sesión?</p>
            )}
            {!isAdmin && (
              <div className="flex items-start gap-2 bg-light-blue/50 border border-blue/20 rounded-lg p-3">
                <svg className="w-4 h-4 text-blue flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 2" />
                </svg>
                <p className="text-xs text-gray-600">
                  Se registrará esta hora como tu <span className="font-medium text-gray-800">hora de salida</span> del día.
                </p>
              </div>
            )}
            {cajaSinCerrar ? (
              // Con caja abierta se apilan: la acción recomendada (ir a Caja)
              // arriba, luego salir de todos modos y cancelar.
              <div className="space-y-2.5">
                <button
                  onClick={irACaja}
                  className="w-full bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  Ir a Caja
                </button>
                <button
                  onClick={confirmarLogout}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  Cerrar sesión de todos modos
                </button>
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarLogout}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
