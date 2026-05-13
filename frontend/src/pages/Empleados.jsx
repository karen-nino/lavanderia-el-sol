import { useState } from 'react';

const Icon = {
  empleados: (
    <svg className="w-7 h-7 text-grey" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 20c0-3 2.5-5 6-5s6 2 6 5" />
      <rect x="14" y="9" width="7" height="6" rx="1.5" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M17 9V7.5h2V9" />
    </svg>
  ),
  search: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 21l-4-4m-2-6a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  ),
  filter: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  ),
  plus: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  edit: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  trash: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M3 7h18M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
    </svg>
  ),
};

const MOCK_EMPLEADOS = [
  { id: 1, nombre: 'Patricia Jiménez',    rol: 'Empleado' },
  { id: 2, nombre: 'Alejandro Guzman',    rol: 'Empleado' },
  { id: 3, nombre: 'Pedro Esquivar',      rol: 'Empleado' },
  { id: 4, nombre: 'Fernando Zuñiga',     rol: 'Empleado' },
  { id: 5, nombre: 'Alberto Farrera',     rol: 'Empleado' },
  { id: 6, nombre: 'Humberto de la Rosa', rol: 'Empleado' },
  { id: 7, nombre: 'Patricia Jiménez',    rol: 'Empleado' },
];

export default function Empleados() {
  const [empleados, setEmpleados] = useState(MOCK_EMPLEADOS);
  const [busqueda, setBusqueda]   = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const filtrados = empleados.filter(e =>
    e.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleEliminar = (id) => {
    if (!confirm('¿Eliminar este empleado?')) return;
    setEmpleados(prev => prev.filter(e => e.id !== id));
  };

  const handleEditar = () => {
    alert('Edición de empleados próximamente disponible.');
  };

  const handleAgregar = () => {
    alert('Alta de empleados próximamente disponible.');
  };

  return (
    <div className="pt-10 pb-16 px-6 md:py-10 md:px-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex flex-col items-start">
          <div className='flex flex-row items-center gap-1'>
            {Icon.empleados}
            <h1 className="text-xl font-bold text-dark-blue leading-tight">Empleados</h1>
          </div>
            <p className="text-sm text-grey">Todos los Empleados</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setSearchOpen(s => !s)}
            aria-label="Buscar"
            className="w-11 h-11 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center"
          >
            {Icon.search}
          </button>
          <button
            aria-label="Filtrar"
            className="w-11 h-11 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center"
          >
            {Icon.filter}
          </button>
          <button
            onClick={handleAgregar}
            aria-label="Agregar empleado"
            className="w-11 h-11 rounded-pill bg-blue text-white flex items-center justify-center"
          >
            {Icon.plus}
          </button>
        </div>
      </div>

      {searchOpen && (
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar empleado..."
          autoFocus
          className="w-full px-4 py-3 border border-grey/30 rounded-lg text-base text-dark-blue placeholder-grey/60 focus:outline-none focus:border-blue mb-4"
        />
      )}

      {/* Tabla */}
      <div className="-mx-6 md:-mx-8 overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[2fr_1.2fr_120px] bg-dark-blue/90 text-white px-5 py-3 gap-3">
            <span className="text-sm font-bold">Nombre</span>
            <span className="text-sm font-bold">Rol</span>
            <span className="text-sm font-bold">Acción</span>
          </div>

          {filtrados.length === 0 ? (
            <div className="bg-white px-5 py-10 text-center text-sm text-grey">
              Sin resultados.
            </div>
          ) : (
            filtrados.map((e, idx) => (
              <div
                key={e.id}
                className={`grid grid-cols-[2fr_1.2fr_120px] items-center px-5 py-4 gap-3 ${
                  idx % 2 === 0 ? 'bg-light-blue/20' : 'bg-white'
                }`}
              >
                <span className="text-base text-dark-blue">{e.nombre}</span>
                <span className="text-base text-grey">{e.rol}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEditar(e.id)}
                    aria-label="Editar"
                    className="w-10 h-10 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center"
                  >
                    {Icon.edit}
                  </button>
                  <button
                    onClick={() => handleEliminar(e.id)}
                    aria-label="Eliminar"
                    className="w-10 h-10 rounded-pill border border-grey/40 text-red flex items-center justify-center"
                  >
                    {Icon.trash}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
