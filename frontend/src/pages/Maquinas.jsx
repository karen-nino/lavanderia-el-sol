import MaquinasEnUso from '../components/MaquinasEnUso';

export default function Maquinas() {
  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="px-6 md:px-8 pt-10 md:pt-14 pb-4">
          <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
        </div>
      </div>

      {/* Contenido */}
      <div className="px-6 md:px-8 py-6">
        <MaquinasEnUso />
      </div>
    </div>
  );
}
