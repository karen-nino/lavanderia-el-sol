import CircularTimer from './CircularTimer';

const HEADER_BY_ESTADO = {
  disponible:    { cls: 'bg-blue text-white',  label: 'DISP' },
  en_uso:        { cls: 'bg-blue text-white',  label: 'EN USO' },
  mantenimiento: { cls: 'bg-red text-white',   label: 'MANT' },
};

export default function MachineCard({ maquina, onProcesar, onClick }) {
  const header = HEADER_BY_ESTADO[maquina.estado] ?? HEADER_BY_ESTADO.disponible;
  const interactivoCls = onClick
    ? 'cursor-pointer hover:shadow-lg transition-shadow'
    : '';
  const handleKeyDown = onClick
    ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }
    : undefined;
  const containerProps = onClick
    ? { role: 'button', tabIndex: 0, onClick, onKeyDown: handleKeyDown }
    : {};

  if (maquina.estado === 'disponible') {
    return (
      <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
        <div className={`flex items-center justify-center px-3 py-2 ${header.cls}`}>
          <span className="text-kpi-label uppercase tracking-wide">{maquina.nombre}</span>
        </div>
        <div className="p-card-pad flex flex-col items-center gap-3">
          <CircularTimer progress={0} label="00:00" />
          <p className="text-kpi-label text-grey uppercase tracking-wide">Disponible</p>
        </div>
      </div>
    );
  }

  if (maquina.estado === 'mantenimiento') {
    return (
      <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
        <div className={`flex items-center justify-center px-3 py-2 ${header.cls}`}>
          <span className="text-kpi-label uppercase tracking-wide">{maquina.nombre}</span>
        </div>
        <div className="p-card-pad flex flex-col items-center gap-3">
          <div className="w-24 h-24 rounded-pill bg-light-red flex items-center justify-center">
            <span className="text-card-title text-red">⚠</span>
          </div>
          <p className="text-kpi-label text-red uppercase tracking-wide">Mantenimiento</p>
        </div>
      </div>
    );
  }

  if (maquina.necesita_procesar) {
    return (
      <div {...containerProps} className={`rounded-card bg-light-green shadow-card overflow-hidden ${interactivoCls}`}>
        <div className="flex items-center justify-center px-3 py-2 bg-green text-white">
          <span className="text-kpi-label uppercase tracking-wide">{maquina.nombre}</span>
        </div>
        <div className="p-card-pad flex flex-col items-center gap-3">
          <p className="text-card-title text-green text-center">Lavado terminado</p>
          <button
            onClick={(e) => { e.stopPropagation(); onProcesar?.(maquina); }}
            className="w-full bg-green text-white text-section py-3 rounded-card-sm hover:opacity-90 transition-opacity"
          >
            PROCESAR
          </button>
        </div>
      </div>
    );
  }

  return (
    <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
      <div className={`flex items-center justify-center px-3 py-2 ${header.cls}`}>
        <span className="text-kpi-label uppercase tracking-wide">{maquina.nombre}</span>
      </div>
      <div className="p-card-pad flex flex-col items-center gap-3">
        <CircularTimer progress={maquina.progreso ?? 1} label={maquina.tiempo_restante ?? '—:—'} />
        <p className="text-kpi-label text-grey uppercase tracking-wide">En uso</p>
      </div>
    </div>
  );
}
