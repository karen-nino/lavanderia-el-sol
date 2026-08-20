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
  const [verPassword, setVerPassword] = useState(false);

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
            <div className="relative">
              <input type={verPassword ? 'text' : 'password'} name="password" minLength={6} value={form.password} onChange={handleChange}
                placeholder="Dejar vacío para no cambiar" className={`${INPUT_CLS} pr-11`} />
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
