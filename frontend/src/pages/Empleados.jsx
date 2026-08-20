import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { esAdmin as esAdminFn, esAdminMain as esAdminMainFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';
import EmpleadoEditModal from '../components/EmpleadoEditModal';
import EmpleadoDeleteModal from '../components/EmpleadoDeleteModal';
import NombreEmpleado from '../components/NombreEmpleado';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const FORM_INIT = { nombre: '', apellido: '', rol: 'operador', password: '', sucursal: '' };

const ROL_LABEL = { admin_main: 'Admin Main', admin: 'Admin', operador: 'Empleado' };

// Usuarios de prueba: no están ligados a una sucursal y en la lista de
// Empleados solo los ve el admin_main. Se identifican con la bandera es_prueba
// de la base (no por el nombre), así se pueden renombrar sin perder la marca.
const esUsuarioPrueba = (e) => e?.es_prueba === true;

export default function Empleados() {
  const navigate = useNavigate();
  const { usuario, sucursalActiva } = useAuth();
  const esAdmin     = esAdminFn(usuario?.rol);
  const esAdminMain = esAdminMainFn(usuario?.rol);

  const [sucursales, setSucursales]     = useState([]);

  const [empleados, setEmpleados]       = useState([]);
  const [cargando, setCargando]         = useState(true);
  const [errorCarga, setErrorCarga]     = useState('');
  const [busqueda, setBusqueda]         = useState('');
  const [filtroRol, setFiltroRol]       = useState('todos');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const filtrosRef = useRef(null);

  useEffect(() => {
    if (!mostrarFiltros) return;
    const onMouseDown = (e) => {
      if (filtrosRef.current && !filtrosRef.current.contains(e.target)) {
        setMostrarFiltros(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mostrarFiltros]);

  // Modal crear
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState(FORM_INIT);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState('');
  const [verPassword, setVerPassword] = useState(false);

  // Modal editar / eliminar (usan componentes reutilizables)
  const [editEmpleado, setEditEmpleado]     = useState(null);
  const [deleteEmpleado, setDeleteEmpleado] = useState(null);

  // Abre la página de desempeño del empleado.
  const abrirDesempeno = (emp) => navigate(`/empleados/${emp.id}/desempeno`);

  useEffect(() => {
    api.get('/usuarios')
      .then(data => setEmpleados(data ?? []))
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    api.get('/sucursales')
      .then(data => setSucursales(data ?? []))
      .catch(() => {});
  }, []);

  // Sucursal que se está viendo. Los operadores se limitan a ella; los admins
  // son globales y se muestran siempre.
  const sucursalVista = sucursalActiva || usuario?.sucursal || null;

  const filtrados = empleados
    .filter(e => {
      const prueba = esUsuarioPrueba(e);
      // Los usuarios de prueba solo los ve el admin_main (y siempre, sin
      // importar la sucursal activa).
      if (prueba && !esAdminMain) return false;
      // El admin_main se oculta de la lista, salvo el propio usuario (para
      // que siempre vea su tarjeta).
      if (e.rol === 'admin_main' && e.id !== usuario?.id) return false;
      // Solo empleados (operadores) de la sucursal activa; los admins son
      // globales y los usuarios de prueba se ven en cualquier sucursal.
      if (!prueba && !esAdminFn(e.rol) && sucursalVista && e.sucursal !== sucursalVista) return false;
      if (filtroRol !== 'todos' && e.rol !== filtroRol) return false;
      const nombreCompleto = `${e.nombre} ${e.apellido ?? ''}`.toLowerCase();
      return nombreCompleto.includes(busqueda.toLowerCase());
    })
    // Orden: el usuario actual hasta arriba, luego los usuarios de prueba y
    // por último el resto (alfabético).
    .sort((a, b) => {
      if (a.id === usuario?.id) return -1;
      if (b.id === usuario?.id) return 1;
      const pa = esUsuarioPrueba(a);
      const pb = esUsuarioPrueba(b);
      if (pa !== pb) return pa ? -1 : 1;
      return a.nombre.localeCompare(b.nombre);
    });

  // ── Crear ──────────────────────────────────────────────
  const abrirModal = () => {
    setForm({ ...FORM_INIT, sucursal: sucursalActiva || usuario?.sucursal || '' });
    setFormError('');
    setModalOpen(true);
  };
  const cerrarModal = () => setModalOpen(false);
  const handleChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setFormError('');
    setGuardando(true);
    try {
      const nuevo = await api.post('/usuarios', {
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        password: form.password,
        rol: form.rol,
        // Un admin es global: no lleva sucursal.
        sucursal: esAdminFn(form.rol) ? '' : form.sucursal,
      });
      setEmpleados(prev => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      cerrarModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  // ── Editar / Eliminar (callbacks de los modales) ───────
  const onEmpleadoGuardado = (actualizado) => {
    setEmpleados(prev =>
      prev.map(emp => emp.id === actualizado.id ? actualizado : emp)
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
    );
    setEditEmpleado(null);
  };

  const onEmpleadoEliminado = (id) => {
    setEmpleados(prev => prev.filter(emp => emp.id !== id));
    setDeleteEmpleado(null);
  };

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Empleados</h1>
          <p className="text-sm text-gray-500">{filtrados.length} empleado(s)</p>
        </div>
        <div ref={filtrosRef} className="relative flex items-center gap-3">
          <button
            onClick={() => setMostrarFiltros(v => !v)}
            aria-label="Filtros"
            className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
              filtroRol !== 'todos'
                ? 'border-blue bg-light-blue text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M4 6h16M7 12h10M10 18h4" />
            </svg>
          </button>

          {esAdmin && (
            <button
              onClick={abrirModal}
              aria-label="Nuevo empleado"
              className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}

          {mostrarFiltros && (
            <div className="absolute right-0 top-12 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">Filtrar por rol</p>
              <div className="flex flex-col gap-1">
                {[
                  { v: 'todos',    label: 'Todos' },
                  { v: 'admin',    label: 'Admin' },
                  { v: 'operador', label: 'Empleado' },
                ].map(opt => (
                  <button
                    key={opt.v}
                    onClick={() => { setFiltroRol(opt.v); setMostrarFiltros(false); }}
                    className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                      filtroRol === opt.v
                        ? 'bg-light-blue text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 space-y-4">

      {/* Búsqueda */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue bg-white"
        />
      </div>

      {errorCarga && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{errorCarga}</div>
      )}

      {cargando ? (
        <div className="text-center text-gray-400 text-sm py-10">Cargando...</div>
      ) : filtrados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <p className="text-center text-gray-400 text-sm py-10">
            {busqueda ? 'No se encontraron empleados con ese criterio' : 'No hay empleados registrados'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtrados.map(emp => {
            const iniciales = `${emp.nombre?.[0] ?? ''}${emp.apellido?.[0] ?? ''}`.toUpperCase();
            const esMismoUsuario = usuario?.id === emp.id;
            const esPrueba = esUsuarioPrueba(emp);

            const cabecera = (
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold ${
                  esMismoUsuario ? 'bg-blue text-white'
                    : esPrueba ? 'bg-amber-500 text-white'
                    : 'bg-light-blue text-blue'
                }`}>
                  {iniciales || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <NombreEmpleado nombre={emp.nombre} apellido={emp.apellido} className="font-semibold text-gray-900 text-sm" />
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    {esMismoUsuario ? (
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-blue text-white font-medium">Mi cuenta</span>
                    ) : esPrueba ? (
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Prueba</span>
                    ) : (
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {ROL_LABEL[emp.rol] ?? emp.rol}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );

            return (
              <div key={emp.id}>
                {/* Mobile: card como botón que abre la página de detalles */}
                <button
                  type="button"
                  onClick={() => abrirDesempeno(emp)}
                  className={`sm:hidden w-full text-left rounded-xl shadow-sm border p-4 transition-colors ${
                    esMismoUsuario
                      ? 'bg-light-blue border-blue/40 hover:bg-light-blue/80'
                      : esPrueba
                        ? 'bg-amber-50 border-amber-300 hover:bg-amber-100'
                        : 'bg-white border-gray-100 hover:bg-gray-50 active:bg-gray-100'
                  }`}
                >
                  {cabecera}
                </button>

                {/* Desktop: toda la tarjeta es el botón que abre los detalles */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => abrirDesempeno(emp)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      abrirDesempeno(emp);
                    }
                  }}
                  className={`hidden sm:flex flex-col gap-3 rounded-xl shadow-sm border p-4 cursor-pointer hover:shadow-md transition-shadow ${
                    esMismoUsuario ? 'bg-light-blue border-blue/40'
                      : esPrueba ? 'bg-amber-50 border-amber-300'
                      : 'bg-white border-gray-100'
                  }`}
                >
                  {cabecera}
                </div>
              </div>
            );
          })}
        </div>
      )}

      </div>

      {/* ── Modal: Nuevo empleado ─────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Nuevo empleado</h2>
              <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol</label>
                <select name="rol" value={form.rol} onChange={handleChange} className={`${INPUT_CLS} bg-white`}>
                  <option value="operador">Empleado</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {/* Un administrador es global: no se liga a una sucursal. */}
              {!esAdminFn(form.rol) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Sucursal <span className="text-red-500">*</span>
                  </label>
                  <select name="sucursal" required value={form.sucursal} onChange={handleChange} className={`${INPUT_CLS} bg-white`}>
                    <option value="" disabled>Selecciona una sucursal</option>
                    {sucursales.map(s => (
                      <option key={s.slug} value={s.slug}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input name="nombre" required value={form.nombre} onChange={handleChange}
                  placeholder="Nombre" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Apellido</label>
                <input name="apellido" value={form.apellido} onChange={handleChange}
                  placeholder="Apellido" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Contraseña <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input type={verPassword ? 'text' : 'password'} name="password" required minLength={6} value={form.password} onChange={handleChange}
                    placeholder="••••••••" className={`${INPUT_CLS} pr-11`} />
                  <button type="button" onClick={() => setVerPassword(v => !v)}
                    aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1">
                    {verPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Mínimo 8 caracteres.</p>
              </div>
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{formError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={cerrarModal}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={guardando}
                  className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors">
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Editar empleado ────────────────────────── */}
      {editEmpleado && (
        <EmpleadoEditModal
          empleado={editEmpleado}
          sucursales={sucursales}
          onClose={() => setEditEmpleado(null)}
          onSaved={onEmpleadoGuardado}
        />
      )}

      {/* ── Modal: Confirmar eliminar ─────────────────────── */}
      {deleteEmpleado && (
        <EmpleadoDeleteModal
          empleado={deleteEmpleado}
          onClose={() => setDeleteEmpleado(null)}
          onDeleted={onEmpleadoEliminado}
        />
      )}

    </div>
  );
}
