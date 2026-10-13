import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { esAdmin } from '../lib/roles';
import { api } from '../lib/api';

/**
 * Barra con el nombre de la sucursal activa, bajo la cabecera de cada página
 * (salvo el Dashboard). La ven los admins y los usuarios de prueba.
 */
export default function SucursalBar() {
  const { usuario, sucursalActiva } = useAuth();
  const [nombre, setNombre] = useState('');
  const puedeVer = esAdmin(usuario?.rol) || usuario?.es_prueba === true;

  useEffect(() => {
    if (!puedeVer) return;
    let activo = true;
    api.get('/sucursales')
      .then((list) => {
        if (!activo) return;
        const slug = sucursalActiva || usuario?.sucursal || null;
        setNombre((list ?? []).find((s) => s.slug === slug)?.nombre ?? '');
      })
      .catch(() => {});
    return () => { activo = false; };
  }, [puedeVer, sucursalActiva, usuario?.sucursal, usuario?.es_prueba]);

  if (!puedeVer || !nombre) return null;
  return (
    <div className="bg-blue text-white text-center py-1 px-4">
      <span className="text-xs font-semibold tracking-wider">{nombre}</span>
    </div>
  );
}
