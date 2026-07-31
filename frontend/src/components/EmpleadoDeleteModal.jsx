import { useState } from 'react';
import { api } from '../lib/api';

// Modal de confirmación para eliminar un empleado. Reutilizable desde la lista
// de Empleados y desde la página de detalles del empleado.
//   empleado:   usuario a eliminar (con id, nombre)
//   onClose():  cerrar sin eliminar
//   onDeleted(id): tras eliminar con éxito, con el id eliminado
export default function EmpleadoDeleteModal({ empleado, onClose, onDeleted }) {
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setError('');
    setEliminando(true);
    try {
      await api.delete(`/usuarios/${empleado.id}`);
      onDeleted(empleado.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setEliminando(false);
    }
  };

  return (
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
            ¿Eliminar a <span className="font-medium text-gray-700">{empleado.nombre}</span>?
            Esta acción no se puede deshacer.
          </p>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
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
  );
}
