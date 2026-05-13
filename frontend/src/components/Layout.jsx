import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navIconCls = 'w-6 h-6';

const Icon = {
  brand: (
    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 4a3 3 0 110 6 3 3 0 010-6zm-1 8h2v3l3 .5v6h-2v-5l-2-.3v5h-2v-5l-2 .3v5H8v-6l3-.5v-3z" />
    </svg>
  ),
  dashboard: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3"  y="3"  width="7" height="7" rx="1.5" strokeWidth={2} />
      <rect x="14" y="3"  width="7" height="7" rx="1.5" strokeWidth={2} />
      <rect x="3"  y="14" width="7" height="7" rx="1.5" strokeWidth={2} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" strokeWidth={2} />
    </svg>
  ),
  maquinas: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth={2} />
      <circle cx="12" cy="13" r="4" strokeWidth={2} />
      <circle cx="8"  cy="6.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  notas: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="5" y="3" width="14" height="18" rx="2" strokeWidth={2} />
      <line x1="9"  y1="8"  x2="15" y2="8"  strokeWidth={2} strokeLinecap="round" />
      <line x1="9"  y1="12" x2="15" y2="12" strokeWidth={2} strokeLinecap="round" />
      <line x1="9"  y1="16" x2="13" y2="16" strokeWidth={2} strokeLinecap="round" />
    </svg>
  ),
  clientes: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="9"  cy="8" r="3" strokeWidth={2} />
      <circle cx="17" cy="9" r="2.5" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 20c0-3 2.5-5 6-5s6 2 6 5M15 20c0-2 1.8-4 4-4s2 2 2 4" />
    </svg>
  ),
  inventario: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  ventas: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12m-7 3a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  ),
  ajustes: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  logout: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  bell: (
    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  menu: (
    <svg className={navIconCls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  menuSm: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  close: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <p className="text-kpi-label text-grey capitalize">{usuario?.rol ?? 'Usuario'}</p>
          <p className="text-2xl font-bold text-dark-blue">{usuario?.nombre ?? '—'}</p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-pill bg-green" />
          <span className="text-kpi-label font-bold text-green uppercase tracking-wide">Conectado</span>
        </div>
        <p className="text-sm font-medium text-grey mt-1">{fecha}</p>
        <p className="text-2xl font-bold text-dark-blue">{hora}</p>
      </div>
    </header>
  );
}

function MobileTopbar({ usuario, onAlerts }) {
  return (
    <header className="md:hidden flex items-start justify-between px-6 pt-10 pb-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-kpi-label text-grey">Admin</p>
          <p className="text-xl font-bold text-dark-blue pb-2">{usuario?.nombre ?? 'Usuario'}</p>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-pill bg-green" />
            <span className="text-kpi-label font-bold text-green uppercase tracking-wide">Conectado</span>
          </div>
        </div>
      </div>
      <button
        onClick={onAlerts}
        aria-label="Ver alertas"
        className="pt-1 text-dark-blue flex items-center justify-center"
      >
        {Icon.bell}
      </button>
    </header>
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
        className="w-full max-w-sm bg-white rounded-card shadow-xl p-5"
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
          <button
            onClick={onSettings}
            className="flex items-center gap-3 px-3 py-3 rounded-card-sm text-dark-blue hover:bg-light-blue/60 transition-colors"
          >
            <span className="w-10 h-10 rounded-card-sm bg-light-blue/60 text-blue flex items-center justify-center">
              {Icon.ajustes}
            </span>
            <span className="text-base font-medium">Ajustes</span>
          </button>
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
  const isDashboard = location.pathname === '/';

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate('/login');
  };

  const handleSettings = () => {
    setMenuOpen(false);
    navigate('/configuracion');
  };

  const goTo = (to) => {
    setMenuOpen(false);
    navigate(to);
  };

  const sidebarItems = usuario?.rol === 'admin'
    ? [...navItems, ventasItem]
    : navItems;

  const mobileBottomItems = navItems.filter((item) => item.to !== '/inventario');

  const menuExtraItems = [
    { label: 'Inventario', icon: Icon.inventario, onClick: () => goTo('/inventario') },
    ...(usuario?.rol === 'admin'
      ? [{ label: 'Ventas', icon: Icon.ventas, onClick: () => goTo('/ventas') }]
      : []),
  ];

  return (
    <div className="flex h-full bg-light-blue/30 overflow-hidden">
      <DesktopSidebar items={sidebarItems} onMenu={() => setMenuOpen(true)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {isDashboard && (
            <>
              <MobileTopbar usuario={usuario} />
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
        onSettings={handleSettings}
        onLogout={handleLogout}
      />
    </div>
  );
}
