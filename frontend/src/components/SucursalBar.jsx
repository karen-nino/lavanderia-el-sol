import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { esAdmin } from '../lib/roles';
import { api } from '../lib/api';

// Barra de ancho completo con el nombre de la sucursal activa. Se coloca justo
// debajo de la cabecera de cada página (excepto el Dashboard). El slug viene
// del contexto de sesión; el nombre legible se resuelve contra /sucursales.
// La ven los administradores (admin y admin_main) y los usuarios de prueba
// (para tener siempre a la vista que están en el entorno de pruebas); los
// empleados reales no la ven.
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
