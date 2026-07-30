import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

// Barra de ancho completo con el nombre de la sucursal activa. Se coloca justo
// debajo de la cabecera de cada página (excepto el Dashboard). El slug viene
// del contexto de sesión; el nombre legible se resuelve contra /sucursales.
export default function SucursalBar() {
  const { usuario, sucursalActiva } = useAuth();
  const [nombre, setNombre] = useState('');

  useEffect(() => {
    let activo = true;
    api.get('/sucursales')
      .then((list) => {
        if (!activo) return;
        const slug = sucursalActiva || usuario?.sucursal;
        setNombre((list ?? []).find((s) => s.slug === slug)?.nombre ?? '');
      })
      .catch(() => {});
    return () => { activo = false; };
  }, [sucursalActiva, usuario?.sucursal]);

  if (!nombre) return null;
  return (
    <div className="bg-blue text-white text-center py-1 px-4">
      <span className="text-xs font-semibold tracking-wider">{nombre}</span>
    </div>
  );
}
