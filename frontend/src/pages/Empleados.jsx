import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { esAdmin as esAdminFn, esAdminMain as esAdminMainFn } from '../lib/roles';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const FORM_INIT = { nombre: '', apellido: '', rol: 'operador', password: '' };

const ROL_LABEL = { admin_main: 'Admin Main', admin: 'Admin', operador: 'Empleado' };

const splitNombre = (full) => {
  const [n, ...resto] = (full ?? '').trim().split(' ');
  return { nombre: n ?? '', apellido: resto.join(' ') };
};

export default function Empleados() {
  const { usuario } = useAuth();
  const esAdmin     = esAdminFn(usuario?.rol);
  const esAdminMain = esAdminMainFn(usuario?.rol);

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

  // Modal editar
  const [editEmpleado, setEditEmpleado] = useState(null);
  const [editForm, setEditForm]         = useState(FORM_INIT);
  const [editando, setEditando]         = useState(false);
  const [editError, setEditError]       = useState('');

  // Modal eliminar
  const [deleteEmpleado, setDeleteEmpleado] = useState(null);
  const [eliminando, setEliminando]         = useState(false);
  const [deleteError, setDeleteError]       = useState('');

  // Modal info (mobile)
  const [infoEmpleado, setInfoEmpleado]     = useState(null);

  useEffect(() => {
    api.get('/usuarios')
      .then(data => setEmpleados(data ?? []))
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false));
  }, []);

  const filtrados = empleados.filter(e => {
    if (e.rol === 'admin_main') return false;
    if (filtroRol !== 'todos' && e.rol !== filtroRol) return false;
    return e.nombre.toLowerCase().includes(busqueda.toLowerCase());
  });

  const partirNombre = (e) => splitNombre(e.nombre);
  const nombreCompleto = (e) => e.nombre;

  // ── Crear ──────────────────────────────────────────────
  const abrirModal = () => { setForm(FORM_INIT); setFormError(''); setModalOpen(true); };
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
      const nombreCompletoStr = `${form.nombre} ${form.apellido}`.trim();
      const nuevo = await api.post('/usuarios', {
        nombre: nombreCompletoStr,
        password: form.password,
        rol: form.rol,
      });
      setEmpleados(prev => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      cerrarModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  // ── Editar ─────────────────────────────────────────────
  const abrirEditar = (emp) => {
    const { nombre, apellido } = partirNombre(emp);
    setEditEmpleado(emp);
    setEditForm({
      nombre,
      apellido,
      rol: emp.rol ?? 'operador',
      password: '',
    });
    setEditError('');
  };
  const cerrarEditar = () => setEditEmpleado(null);
  const handleEditChange = e => {
    const { name, value } = e.target;
    setEditForm(f => ({ ...f, [name]: value }));
  };

  const handleEditSubmit = async e => {
    e.preventDefault();
    setEditError('');
    setEditando(true);
    try {
      const payload = {
        nombre: `${editForm.nombre} ${editForm.apellido}`.trim(),
        rol: editForm.rol,
      };
      if (editForm.password) payload.password = editForm.password;
      const actualizado = await api.patch(`/usuarios/${editEmpleado.id}`, payload);
      setEmpleados(prev =>
        prev.map(emp => emp.id === actualizado.id ? actualizado : emp)
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
      cerrarEditar();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditando(false);
    }
  };

  // ── Eliminar ───────────────────────────────────────────
  const abrirEliminar = (emp) => { setDeleteEmpleado(emp); setDeleteError(''); };
  const cerrarEliminar = () => setDeleteEmpleado(null);

  const handleDelete = async () => {
    setDeleteError('');
    setEliminando(true);
    try {
      await api.delete(`/usuarios/${deleteEmpleado.id}`);
      setEmpleados(prev => prev.filter(emp => emp.id !== deleteEmpleado.id));
      cerrarEliminar();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div className="pt-10 pb-16 px-6 md:py-14 md:px-8 space-y-4">
      <div className="flex items-center justify-between">
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
            const { nombre, apellido } = partirNombre(emp);
            const iniciales = `${nombre[0] ?? ''}${apellido[0] ?? ''}`.toUpperCase();
            const esMismoUsuario = usuario?.id === emp.id;
            const empEsMain = emp.rol === 'admin_main';
            const puedeModificar = esAdmin && (!empEsMain || esAdminMain);
            const puedeEliminar  = puedeModificar && !esMismoUsuario;

            const cabecera = (
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-11 h-11 rounded-full bg-light-blue text-blue flex items-center justify-center text-sm font-semibold">
                  {iniciales || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm truncate">{nombreCompleto(emp)}</p>
                  <span className="inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {ROL_LABEL[emp.rol] ?? emp.rol}
                  </span>
                </div>
              </div>
            );

            return (
              <div key={emp.id}>
                {/* Mobile: card como botón que abre modal info */}
                <button
                  type="button"
                  onClick={() => setInfoEmpleado(emp)}
                  className="sm:hidden w-full text-left bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  {cabecera}
                </button>

                {/* Desktop: card con acciones inline */}
                <div className="hidden sm:flex flex-col gap-3 bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
                  {cabecera}
                  {puedeModificar && (
                    <div className="flex items-center justify-end gap-1 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => abrirEditar(emp)}
                        className="p-1.5 text-gray-400 hover:text-blue hover:bg-light-blue rounded-lg transition-colors"
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {puedeEliminar && (
                        <button
                          onClick={() => abrirEliminar(emp)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Info empleado (mobile) ─────────────────── */}
      {infoEmpleado && (() => {
        const { nombre, apellido } = partirNombre(infoEmpleado);
        const iniciales = `${nombre[0] ?? ''}${apellido[0] ?? ''}`.toUpperCase();
        const esMismoUsuario = usuario?.id === infoEmpleado.id;
        const empEsMain = infoEmpleado.rol === 'admin_main';
        const puedeModificar = esAdmin && (!empEsMain || esAdminMain);
        const puedeEliminar  = puedeModificar && !esMismoUsuario;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 sm:hidden">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900">Empleado</h2>
                <button onClick={() => setInfoEmpleado(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-5 space-y-5 overflow-y-auto">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-14 h-14 rounded-full bg-light-blue text-blue flex items-center justify-center text-lg font-semibold">
                    {iniciales || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 text-base">{nombreCompleto(infoEmpleado)}</p>
                    <span className="inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {ROL_LABEL[infoEmpleado.rol] ?? infoEmpleado.rol}
                    </span>
                  </div>
                </div>

                {puedeModificar ? (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { const e = infoEmpleado; setInfoEmpleado(null); abrirEditar(e); }}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-blue hover:opacity-90 text-white font-medium rounded-lg text-sm transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Editar
                    </button>
                    {puedeEliminar && (
                      <button
                        type="button"
                        onClick={() => { const e = infoEmpleado; setInfoEmpleado(null); abrirEliminar(e); }}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Eliminar
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center pt-1">No tienes permiso para modificar este empleado.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                <input type="password" name="password" required minLength={6} value={form.password} onChange={handleChange}
                  placeholder="••••••••" className={INPUT_CLS} />
                <p className="text-xs text-gray-500 mt-1">Mínimo 6 caracteres.</p>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Editar empleado</h2>
              <button onClick={cerrarEditar} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol</label>
                <select
                  name="rol"
                  value={editForm.rol}
                  onChange={handleEditChange}
                  disabled={editEmpleado.id === usuario?.id || editForm.rol === 'admin_main'}
                  className={`${INPUT_CLS} bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed`}
                >
                  <option value="operador">Empleado</option>
                  <option value="admin">Admin</option>
                  {editForm.rol === 'admin_main' && (
                    <option value="admin_main">Admin Main</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input name="nombre" required value={editForm.nombre} onChange={handleEditChange}
                  placeholder="Nombre" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Apellido</label>
                <input name="apellido" value={editForm.apellido} onChange={handleEditChange}
                  placeholder="Apellido" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva contraseña</label>
                <input type="password" name="password" minLength={6} value={editForm.password} onChange={handleEditChange}
                  placeholder="Dejar vacío para no cambiar" className={INPUT_CLS} />
                <p className="text-xs text-gray-500 mt-1">Mínimo 6 caracteres.</p>
              </div>
              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{editError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={cerrarEditar}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={editando}
                  className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors">
                  {editando ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmar eliminar ─────────────────────── */}
      {deleteEmpleado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 text-center mb-1">Eliminar empleado</h3>
              <p className="text-sm text-gray-500 text-center mb-4">
                ¿Eliminar a <span className="font-medium text-gray-700">{nombreCompleto(deleteEmpleado)}</span>?
                Esta acción no se puede deshacer.
              </p>
              {deleteError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{deleteError}</div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={cerrarEliminar}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={handleDelete} disabled={eliminando}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors">
                  {eliminando ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
