import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';
import FichasPanel from '../components/FichasPanel';

/**
 * Fichas de la sucursal (botón del menú, solo si la sucursal usa fichas): las
 * disponibles, las que quedaron dentro de cada máquina para recogerlas y los
 * últimos movimientos.
 */
export default function Fichas() {
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/fichas').then(setResumen).catch(err => setError(err.message));
  }, []);

  return (
    <div className="min-h-full bg-slate-100">
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4">
          <h1 className="text-xl font-bold text-gray-900">Fichas</h1>
          <p className="text-sm text-gray-500">Inventario de fichas de la sucursal</p>
        </div>
      </div>

      <SucursalBar />

      <div className="max-w-movil md:max-w-3xl mx-auto px-6 md:px-8 py-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
        {!resumen && !error && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
          </div>
        )}
        {resumen && !resumen.usa_fichas && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
            Esta sucursal no usa fichas.
            {esAdmin && (
              <> Actívalas en <Link to="/ajustes/fichas" className="font-medium text-blue hover:underline">Ajustes → Fichas</Link>.</>
            )}
          </div>
        )}
        {resumen?.usa_fichas && <FichasPanel resumen={resumen} onResumen={setResumen} esAdmin={esAdmin} />}
      </div>
    </div>
  );
}
