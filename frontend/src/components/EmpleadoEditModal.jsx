import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

// Modal para editar un empleado. Reutilizable desde la lista de Empleados y
// desde la página de detalles del empleado.
//   empleado:  usuario a editar (con id, nombre, apellido, rol, sucursal, es_prueba)
//   sucursales: catálogo para el selector
//   onClose():  cerrar sin guardar
//   onSaved(actualizado): tras guardar con éxito, con el usuario actualizado
export default function EmpleadoEditModal({ empleado, sucursales = [], onClose, onSaved }) {
  const { usuario } = useAuth();
  const [form, setForm] = useState({
    nombre: empleado.nombre ?? '',
    apellido: empleado.apellido ?? '',
    rol: empleado.rol ?? 'operador',
    password: '',
    sucursal: empleado.sucursal ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const esPrueba = empleado?.es_prueba === true;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        // Un admin es global: no lleva sucursal.
        sucursal: esAdminFn(form.rol) ? '' : form.sucursal,
      };
      // Solo se manda el rol cuando de verdad cambió. Si no, editar la propia
      // cuenta (con el rol bloqueado) dispararía "No puedes cambiar tu propio
      // rol" en el backend y no dejaría guardar ni el nombre ni el apellido.
      if (form.rol !== empleado.rol) payload.rol = form.rol;
      if (form.password) payload.password = form.password;
      const actualizado = await api.patch(`/usuarios/${empleado.id}`, payload);
      onSaved(actualizado);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Editar empleado</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol</label>
            <select
              name="rol"
              value={form.rol}
              onChange={handleChange}
              disabled={empleado.id === usuario?.id || form.rol === 'admin_main'}
              className={`${INPUT_CLS} bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed`}
            >
              <option value="operador">Empleado</option>
              <option value="admin">Admin</option>
              {form.rol === 'admin_main' && <option value="admin_main">Admin Main</option>}
            </select>
          </div>
          {/* Un administrador y un usuario de prueba son globales: no se ligan a
              una sucursal. */}
          {!esAdminFn(form.rol) && !esPrueba && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Sucursal <span className="text-red-500">*</span>
              </label>
              <select name="sucursal" required value={form.sucursal} onChange={handleChange} className={`${INPUT_CLS} bg-white`}>
                <option value="" disabled>Selecciona una sucursal</option>
                {sucursales.map((s) => (
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva contraseña</label>
            <input type="password" name="password" minLength={6} value={form.password} onChange={handleChange}
              placeholder="Dejar vacío para no cambiar" className={INPUT_CLS} />
            <p className="text-xs text-gray-500 mt-1">Mínimo 8 caracteres.</p>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando}
              className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
