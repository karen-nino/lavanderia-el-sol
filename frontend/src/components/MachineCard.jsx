import CircularTimer from './CircularTimer';

const HEADER_BY_ESTADO = {
  disponible:    { cls: 'bg-blue text-white',  label: 'DISP' },
  en_uso:        { cls: 'bg-blue text-white',  label: 'EN USO' },
  mantenimiento: { cls: 'bg-red text-white',   label: 'MANT' },
};

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
  // Una máquina puede estar en uso sin nota: alguien la prendió a mano, con el
  // botón de Gestión o desde eWeLink (mig. 104). Sin decirlo, la tarjeta sale
  // en blanco y parece un error.
  const encendidaAMano = Boolean(maquina.encendida_manual_at) && !nota;
  const infoNota = (folioTxt || clienteTxt) ? (
    <div className="w-full text-center">
      {folioTxt && (
        <p className="text-card-title text-dark-grey text-xl font-bold truncate">{folioTxt}</p>
      )}
      {clienteTxt && (
        <p className="text-kpi-label text-grey text-sm font-medium truncate">{clienteTxt}</p>
      )}
    </div>
  ) : encendidaAMano ? (
    <div className="w-full text-center">
      <p className="text-card-title text-dark-grey text-base font-bold">Encendida a mano</p>
      <p className="text-kpi-label text-grey text-sm font-medium">Sin nota</p>
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
    // Máquina que cumplió su ciclo: SIEMPRE en verde, sea Autoservicio o Por
    // Encargo. El verde comunica "esta máquina ya terminó", que es lo mismo en
    // los dos casos; lo único que cambia es el siguiente paso, y eso lo dice el
    // botón. Antes la lavadora que pasaba a secado se pintaba de rojo, y dos
    // tarjetas en el mismo estado se veían como si una tuviera un problema.
    //
    // El siguiente paso lo decide la CARGA, no el tipo de servicio: un
    // Autoservicio creado con lavadora y secadora también pasa a secado (antes
    // se daba por hecho que no, y su lavadora ofrecía "Finalizar carga"
    // saltándose el secado pagado).
    const esSecadora = maquina.tipo === 'secadora';
    const debeSecar = Array.isArray(nota?.lavadoras_con_secado_ids)
      && nota.lavadoras_con_secado_ids.some(mid => String(mid) === String(maquina.id));
    const finalizaCarga = esSecadora || !debeSecar;
    return (
      <div
        {...containerProps}
        className={`rounded-card bg-light-green ring-green shadow-card overflow-hidden ring-2 ring-inset ${interactivoCls}`}
      >
        <div className={`${headerCls} bg-green text-white`}>
          <span className={nombreCls}>{maquina.nombre}</span>
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-3">
          <p className="text-card-title text-green text-center uppercase tracking-wide">
            {esSecadora ? <>Finalizó<br />secadora</> : <>Finalizó<br />lavadora</>}
          </p>
          {infoNota}
          <button
            onClick={(e) => { e.stopPropagation(); onTerminarCiclo?.(maquina); }}
            className="w-full bg-green ring ring-green-700 text-white text-section py-8 rounded-card-sm shadow-card hover:opacity-90 transition-opacity mt-1"
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
      </div>
    </div>
  );
}
