import CircularTimer from './CircularTimer';

const HEADER_BY_ESTADO = {
  disponible:    { cls: 'bg-blue text-white',  label: 'DISP' },
  en_uso:        { cls: 'bg-blue text-white',  label: 'EN USO' },
  mantenimiento: { cls: 'bg-red text-white',   label: 'MANT' },
};

// Indicador del enlace con el Sonoff. Solo se muestra si la máquina tiene un
// dispositivo enlazado o falló; una máquina sin Sonoff configurado no dibuja
// nada (para no ensuciar la tarjeta). Estados: 'enlazada' | 'sin_enlazar' | 'error'.
const SONOFF_INDICADOR = {
  enlazada:    { dot: 'bg-green', texto: 'text-green', label: 'Sonoff OK' },
  error:       { dot: 'bg-red',   texto: 'text-red',   label: 'Sin conexión' },
  sin_enlazar: { dot: 'bg-grey',  texto: 'text-grey',  label: 'Sin Sonoff' },
};

function SonoffIndicador({ estado, mostrarSinEnlazar = false }) {
  if (estado == null) return null;
  if (estado === 'sin_enlazar' && !mostrarSinEnlazar) return null;
  const cfg = SONOFF_INDICADOR[estado];
  if (!cfg) return null;
  return (
    <div className="flex items-center gap-1.5" title={`Enlace Sonoff: ${cfg.label}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
      <span className={`text-xs font-medium uppercase tracking-wide ${cfg.texto}`}>{cfg.label}</span>
    </div>
  );
}

function formatearCliente(nombre, apellido) {
  const n = nombre?.trim();
  const a = apellido?.trim();
  if (!n && !a) return null;
  if (!n) return a;
  if (!a) return n;
  return `${n} ${a[0].toUpperCase()}.`;
}

export default function MachineCard({ maquina, nota, onTerminarCiclo, onClick }) {
  const folioTxt    = nota?.folio
    ? `#${String(nota.folio).split('-')[0]}`
    : (nota?.id != null ? `#${nota.id}` : null);
  const clienteTxt  = nota?.tipo_servicio === 'AUTOSERVICIO'
    ? 'Autoservicio'
    : formatearCliente(nota?.cliente_nombre, nota?.cliente_apellido);
  const infoNota = (folioTxt || clienteTxt) ? (
    <div className="w-full text-center">
      {folioTxt && (
        <p className="text-card-title text-dark-grey text-xl font-bold truncate">{folioTxt}</p>
      )}
      {clienteTxt && (
        <p className="text-kpi-label text-grey text-sm font-medium truncate">{clienteTxt}</p>
      )}
    </div>
  ) : null;

  const header = HEADER_BY_ESTADO[maquina.estado] ?? HEADER_BY_ESTADO.disponible;
  const interactivoCls = onClick
    ? 'cursor-pointer hover:shadow-card-hover transition-shadow'
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

  const headerCls = 'flex items-center justify-center px-3 py-2.5 rounded-t-card';
  const nombreCls = 'text-section uppercase tracking-wide';

  if (maquina.estado === 'disponible') {
    return (
      <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
        <div className={`${headerCls} ${header.cls}`}>
          <span className={nombreCls}>{maquina.nombre}</span>
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-4">
          <CircularTimer progress={0} label="00:00" />
          <p className="text-kpi-label text-grey uppercase tracking-wide">Disponible</p>
        </div>
      </div>
    );
  }

  if (maquina.estado === 'mantenimiento') {
    return (
      <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
        <div className={`${headerCls} ${header.cls}`}>
          <span className={nombreCls}>{maquina.nombre}</span>
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-4">
          <div className="w-28 h-28 rounded-pill bg-light-red flex items-center justify-center">
            <span className="text-card-title text-red">⚠</span>
          </div>
          <p className="text-kpi-label text-red uppercase tracking-wide">Mantenimiento</p>
        </div>
      </div>
    );
  }

  if (maquina.necesita_terminar_ciclo) {
    // Secadora que terminó, o lavadora cuya carga no lleva secado: se finaliza
    // la carga, en verde. Lavadora cuya carga SÍ debe secar: el siguiente paso
    // es iniciar el secado (elegir secadora), en tonos rojos.
    //
    // Lo decide la carga, no el tipo de servicio: un Autoservicio creado con
    // lavadora y secadora también pasa a secado (antes se daba por hecho que no
    // y su lavadora ofrecía "Finalizar carga", saltándose el secado pagado).
    const esSecadora = maquina.tipo === 'secadora';
    const debeSecar = Array.isArray(nota?.lavadoras_con_secado_ids)
      && nota.lavadoras_con_secado_ids.some(mid => String(mid) === String(maquina.id));
    const finalizaCarga = esSecadora || !debeSecar;
    const tono = finalizaCarga
      ? { card: 'bg-light-green ring-green', header: 'bg-green', titulo: 'text-green', boton: 'bg-green ring ring-green-700' }
      : { card: 'bg-white ring-white',     header: 'bg-red',   titulo: 'text-red',   boton: 'bg-red-500 ring ring-red-700' };
    return (
      <div
        {...containerProps}
        className={`rounded-card ${tono.card} shadow-card overflow-hidden ring-2 ring-inset ${interactivoCls}`}
      >
        <div className={`${headerCls} ${tono.header} text-white`}>
          <span className={nombreCls}>{maquina.nombre}</span>
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-3">
          <p className={`text-card-title ${tono.titulo} text-center uppercase tracking-wide`}>
            {finalizaCarga
              ? (esSecadora ? <>Finalizó<br />secadora</> : <>Finalizó<br />lavadora</>)
              : <>Iniciar<br />secadora</>}
          </p>
          {infoNota}
          <button
            onClick={(e) => { e.stopPropagation(); onTerminarCiclo?.(maquina); }}
            className={`w-full ${tono.boton} text-white text-section py-8 rounded-card-sm shadow-card hover:opacity-90 transition-opacity mt-1`}
          >
            {finalizaCarga ? 'FINALIZAR CARGA' : 'INICIAR SECADO'}
          </button>
        </div>
      </div>
    );
  }

  // Temporizador en marcha. La secadora en uso va en tonos rojos (encabezado
  // y aro del contador); las lavadoras conservan el azul.
  const esSecadora = maquina.tipo === 'secadora';
  return (
    <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
      <div className={`${headerCls} ${esSecadora ? 'bg-red text-white' : header.cls}`}>
        <span className={nombreCls}>{maquina.nombre}</span>
      </div>
      <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-4">
        <CircularTimer
          progress={maquina.progreso ?? 1}
          label={maquina.tiempo_restante ?? '—:—'}
          color={esSecadora ? 'red' : 'blue'}
        />
        {infoNota}
        <SonoffIndicador estado={maquina.sonoff_estado} mostrarSinEnlazar />
      </div>
    </div>
  );
}
