import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { esAdmin, ROL_LABEL } from '../lib/roles';
import { api } from '../lib/api';
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
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  ventas: (
    <svg width="24" height="24" className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12m-7 3a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
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
      <circle cx="9" cy="8" r="3" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 20c0-3 2.5-5 6-5s6 2 6 5" />
      <rect x="14" y="9" width="7" height="6" rx="1.5" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M17 9V7.5h2V9" />
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

const ventasItem = { to: '/ventas', label: 'Ventas', icon: Icon.ventas };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function SidebarItem({ to, label, icon, end }) {
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
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

function DesktopSidebar({ items, onMenu }) {
  return (
    <aside className="hidden md:flex md:flex-col md:flex-shrink-0 w-24 bg-white border-r border-light-blue/60 py-8 px-2">
      <div className="flex justify-center mb-6">
        <div className="w-12 h-12 rounded-card-sm bg-dark-blue flex items-center justify-center">
          {Icon.brand}
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-3">
        {items.map((item) => (
          <SidebarItem key={item.to} {...item} />
        ))}
      </nav>

      <button
        onClick={onMenu}
        className="group flex flex-col items-center gap-1.5 py-1"
      >
        <span className="w-12 h-12 rounded-card-sm flex items-center justify-center text-dark-blue group-hover:bg-light-blue/60 transition-colors">
          {Icon.menu}
        </span>
        <span className="text-[11px] font-medium text-dark-blue">Menú</span>
      </button>
    </aside>
  );
}

function DesktopHeader({ usuario, now }) {
  const fecha = now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const hora  = now.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
  return (
    <header className="hidden md:flex items-start justify-between px-8 pt-14">
      <div className="flex items-center gap-2">
        <div className="w-12 h-12 rounded-pill bg-grey/30 flex items-center justify-center text-white font-bold text-lg">
          {usuario?.nombre?.[0]?.toUpperCase() ?? 'A'}
        </div>
        <div>
          <p className="text-kpi-label text-grey">{ROL_LABEL[usuario?.rol] ?? 'Usuario'}</p>
          <p className="text-2xl font-bold text-dark-blue">{usuario?.nombre ?? '—'}</p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <SucursalSelector />
        <div className="flex items-center gap-1 mt-2">
          <span className="w-2 h-2 rounded-pill bg-green" />
          <span className="text-kpi-label font-bold text-green uppercase tracking-wide">Conectado</span>
        </div>
        <p className="text-sm font-medium text-grey mt-1">{fecha}</p>
        <p className="text-2xl font-bold text-dark-blue">{hora}</p>
      </div>
    </header>
  );
}

function MobileTopbar({ usuario, alertas, onAlerts }) {
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
          <p className="text-xl font-bold text-dark-blue pb-2">{usuario?.nombre ?? 'Usuario'}</p>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-pill bg-green" />
            <span className="text-kpi-label font-bold text-green uppercase tracking-wide">Conectado</span>
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

function MenuModal({ open, onClose, extraItems = [], onSettings, onLogout }) {
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

        <div className="flex flex-col gap-2">
          <SucursalSelector variant="menu" />
          {extraItems.map(({ label, icon, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className="flex items-center gap-3 px-3 py-3 rounded-card-sm text-dark-blue hover:bg-light-blue/60 transition-colors"
            >
              <span className="w-10 h-10 rounded-card-sm bg-light-blue/60 text-blue flex items-center justify-center">
                {icon}
              </span>
              <span className="text-base font-medium">{label}</span>
            </button>
          ))}
          {onSettings && (
            <button
              onClick={onSettings}
              className="flex items-center gap-3 px-3 py-3 rounded-card-sm text-dark-blue hover:bg-light-blue/60 transition-colors"
            >
              <span className="w-10 h-10 rounded-card-sm bg-light-blue/60 text-blue flex items-center justify-center">
                {Icon.ajustes}
              </span>
              <span className="text-base font-medium">Ajustes</span>
            </button>
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
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [productos, setProductos] = useState([]);
  const [notificaciones, setNotificaciones] = useState([]);
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

  const alertas = useMemo(() => {
    const orden = { agotado: 0, por_agotarse: 1 };
    const stock = productos
      .filter(p => p.estado_stock && p.estado_stock !== 'ok')
      .sort((a, b) => (orden[a.estado_stock] ?? 99) - (orden[b.estado_stock] ?? 99))
      .map(p => {
        const disponible = Number(p.stock_actual) - Number(p.stock_reservado ?? 0);
        return {
          key:         `producto-${p.id}`,
          title:       p.nombre,
          description: `Stock: ${Number(p.stock_actual).toFixed(2)} ${p.unidad}`,
          severity:    p.estado_stock,
          to:          `/inventario?highlight=${p.id}`,
          accionLabel: 'Ver en inventario',
          detalles: [
            { label: 'Producto',     value: p.nombre },
            { label: 'Estado',       value: p.estado_stock === 'agotado' ? 'Agotado' : 'Por agotarse' },
            { label: 'Stock actual', value: `${Number(p.stock_actual).toFixed(2)} ${p.unidad}` },
            { label: 'Disponible',   value: `${disponible.toFixed(2)} ${p.unidad}` },
            ...(p.categoria ? [{ label: 'Categoría', value: p.categoria }] : []),
          ],
        };
      });
    const notifs = notificaciones.map(n => {
      const fechaHora = new Date(n.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
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
    return [...stock, ...notifs];
  }, [productos, notificaciones]);

  const handleDismissAlerta = async (a) => {
    setNotificaciones(prev => prev.filter(n => n.id !== a.id));
    try { await api.post(`/notificaciones/${a.id}/descartar`); } catch { /* la lista ya se actualizó localmente */ }
  };

  // Descarta todas las notificaciones a la vez (las alertas de stock no son
  // descartables: reflejan el inventario en vivo y se quedan).
  const handleDismissTodas = async () => {
    setNotificaciones([]);
    try { await api.post('/notificaciones/descartar-todas'); } catch { /* la lista ya se actualizó localmente */ }
  };

  const handleSelectAlerta = (a) => {
    setAlertsOpen(false);
    navigate(a.to);
  };

  const handleLogout = () => {
    setMenuOpen(false);
    setConfirmLogout(true);
  };

  const confirmarLogout = () => {
    setConfirmLogout(false);
    logout();
    navigate('/login');
  };

  const handleSettings = () => {
    setMenuOpen(false);
    navigate('/ajustes');
  };

  const goTo = (to) => {
    setMenuOpen(false);
    navigate(to);
  };

  const sidebarItems = esAdmin(usuario?.rol)
    ? [...navItems, ventasItem]
    : navItems;

  const mobileBottomItems = navItems.filter((item) => item.to !== '/inventario');

  const menuExtraItems = [
    { label: 'Caja',                icon: Icon.caja,       onClick: () => goTo('/caja') },
    { label: 'Inventario',          icon: Icon.inventario, onClick: () => goTo('/inventario') },
    { label: 'Gestión de máquinas', icon: Icon.maquinas,   onClick: () => goTo('/gestion-maquinas') },
    ...(esAdmin(usuario?.rol)
      ? [
          { label: 'Ventas',    icon: Icon.ventas,    onClick: () => goTo('/ventas') },
          { label: 'Empleados', icon: Icon.empleados, onClick: () => goTo('/empleados') },
        ]
      : []),
  ];

  return (
    <div className="flex h-full overflow-hidden">
      <DesktopSidebar items={sidebarItems} onMenu={() => setMenuOpen(true)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {isDashboard && (
            <>
              <MobileTopbar usuario={usuario} alertas={alertas} onAlerts={() => setAlertsOpen(true)} />
              <DesktopHeader usuario={usuario} now={now} />
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
        extraItems={menuExtraItems}
        onSettings={esAdmin(usuario?.rol) ? handleSettings : undefined}
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
            <p className="text-sm text-gray-500">¿Seguro que quieres cerrar sesión?</p>
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
          </div>
        </div>
      )}
    </div>
  );
}
