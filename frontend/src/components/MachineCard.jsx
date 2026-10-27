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

/** Nombre de la máquina en la cabecera de la tarjeta. */
function NombreMaquina({ maquina, className }) {
  return <span className={className}>{maquina.nombre}</span>;
}

export default function MachineCard({
  maquina,
  nota,
  onTerminarCiclo,
  onOtroCiclo,
  onEncender,
  otroCicloEnCurso = false,
  errorOtroCiclo = null,
  onClick,
}) {
  const folioTxt    = nota?.folio
    ? `#${String(nota.folio).split('-')[0]}`
    : (nota?.id != null ? `#${nota.id}` : null);
  // Autoservicio: su referencia o "Mostrador", como en la lista de Notas.
  const clienteTxt  = nota?.tipo_servicio === 'AUTOSERVICIO'
    ? (String(nota?.referencia ?? '').trim() || 'Mostrador')
    : formatearCliente(nota?.cliente_nombre, nota?.cliente_apellido);
  // En uso sin nota: alguien la prendió a mano (botón de Gestión o eWeLink).
  const encendidaAMano = Boolean(maquina.encendida_manual_at) && !nota;
  const infoNota = (folioTxt || clienteTxt) ? (
    <div className="w-full text-center">
      {/* El cliente en grande y el folio debajo. */}
      {clienteTxt && (
        <p className="text-card-title text-dark-grey text-xl font-bold truncate">{clienteTxt}</p>
      )}
      {folioTxt && (
        <p className="text-kpi-label text-grey text-sm font-medium truncate">{folioTxt}</p>
      )}
    </div>
  ) : encendidaAMano ? (
    <div className="w-full text-center">
      <p className="text-card-title text-dark-grey text-base font-bold">Encendida a mano</p>
      <p className="text-kpi-label text-grey text-sm font-medium">Sin nota</p>
    </div>
  ) : null;

  // En qué ciclo va la carga, en todas las caras de la tarjeta. "Ciclo 1 de 1"
  // no se muestra.
  const contadorCiclos = maquina.ciclos_carga != null && maquina.ciclos_max > 1 ? (
    <p className="text-kpi-label text-grey text-sm">
      Ciclo {maquina.ciclos_carga} de {maquina.ciclos_max}
    </p>
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

  const headerCls = 'flex flex-col items-center justify-center px-3 py-2.5 rounded-t-card';
  const nombreCls = 'text-xl font-bold leading-tight uppercase tracking-wide';

  if (maquina.estado === 'disponible') {
    return (
      <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
        <div className={`${headerCls} ${header.cls}`}>
          <NombreMaquina maquina={maquina} className={nombreCls} />
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
          <NombreMaquina maquina={maquina} className={nombreCls} />
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
    // Máquina que cumplió su ciclo: siempre en verde; el siguiente paso lo dice el
    // botón. Las lavadoras de `lavadoras_con_secado_ids` (hoy solo Autoservicio)
    // pasan a secado; las demás finalizan su carga y la secadora va en Salidas.
    const esSecadora = maquina.tipo === 'secadora';
    const debeSecar = Array.isArray(nota?.lavadoras_con_secado_ids)
      && nota.lavadoras_con_secado_ids.some(mid => String(mid) === String(maquina.id));
    const finalizaCarga = esSecadora || !debeSecar;

    // Un solo botón para los dos momentos en verde: primero ofrece el siguiente
    // ciclo (una carga son dos) y luego el paso de siempre.
    const ofreceOtroCiclo = Boolean(maquina.puede_otro_ciclo);
    const enPausa = ofreceOtroCiclo && maquina.espera_otro_ciclo > 0;
    // El siguiente ciclo empieza encendiendo la máquina; "Iniciar ciclo" viene después.
    // Las de botón Iniciar (Speed Queen en la demo) lo arrancan en un paso.
    const iniciaDirecto = ofreceOtroCiclo && Boolean(maquina.con_iniciar);
    const verbo = iniciaDirecto ? 'INICIAR' : 'ENCENDER';
    const etiquetaBoton = otroCicloEnCurso ? (iniciaDirecto ? 'INICIANDO…' : 'ENCENDIENDO…')
      : enPausa            ? `${verbo} EN ${maquina.espera_otro_ciclo}s`
      : ofreceOtroCiclo    ? (iniciaDirecto ? 'INICIAR CICLO' : 'ENCENDER MÁQUINA')
      : finalizaCarga      ? 'FINALIZAR CARGA'
      : 'INICIAR SECADO';
    // El color va con lo que pide el botón: ámbar si falta darle corriente, verde
    // si toca arrancar o cerrar la carga.
    const c = ofreceOtroCiclo && !iniciaDirecto
      ? { fondo: 'bg-amber-50', aro: 'ring-amber-400', cabecera: 'bg-amber-500',
          titulo: 'text-amber-700', boton: 'bg-amber-500 ring-amber-600' }
      : { fondo: 'bg-light-green', aro: 'ring-green', cabecera: 'bg-green',
          titulo: 'text-green', boton: 'bg-green ring-green-700' };
    return (
      <div
        {...containerProps}
        className={`rounded-card ${c.fondo} ${c.aro} shadow-card overflow-hidden ring-2 ring-inset ${interactivoCls}`}
      >
        <div className={`${headerCls} ${c.cabecera} text-white`}>
          <NombreMaquina maquina={maquina} className={nombreCls} />
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-3">
          <p className={`text-card-title ${c.titulo} text-center uppercase tracking-wide`}>
            {esSecadora ? <>Finalizó<br />secadora</> : <>Finalizó<br />lavadora</>}
          </p>
          {infoNota}
          {/* Durante la pausa sin corriente el botón muestra la cuenta atrás. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (iniciaDirecto) onOtroCiclo?.(maquina);
              else if (ofreceOtroCiclo) onEncender?.(maquina);
              else onTerminarCiclo?.(maquina);
            }}
            disabled={otroCicloEnCurso || enPausa}
            className={`w-full ${c.boton} ring text-white text-section py-8 rounded-card-sm shadow-card hover:opacity-90 transition-opacity mt-1 disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {etiquetaBoton}
          </button>
          {contadorCiclos}
          {errorOtroCiclo && (
            <p className="text-kpi-label text-red text-sm text-center">{errorOtroCiclo}</p>
          )}
        </div>
      </div>
    );
  }

  // Encendida y esperando que la arranquen: sin cronómetro todavía, en verde.
  if (maquina.esperando_arranque && nota) {
    return (
      <div
        {...containerProps}
        className={`rounded-card bg-light-green ring-green shadow-card overflow-hidden ring-2 ring-inset ${interactivoCls}`}
      >
        <div className={`${headerCls} bg-green text-white`}>
          <NombreMaquina maquina={maquina} className={nombreCls} />
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-3">
          <p className="text-card-title text-green text-center uppercase tracking-wide">
            Encendida
          </p>
          <p className="text-kpi-label text-green-700 text-sm text-center">
            Arráncala con su botón y dale a Iniciar ciclo.
          </p>
          {infoNota}
          <button
            onClick={(e) => { e.stopPropagation(); onOtroCiclo?.(maquina); }}
            disabled={otroCicloEnCurso}
            className="w-full bg-green ring ring-green-700 text-white text-section py-8 rounded-card-sm shadow-card hover:opacity-90 transition-opacity mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {otroCicloEnCurso ? 'INICIANDO…' : 'INICIAR CICLO'}
          </button>
          {contadorCiclos}
          {errorOtroCiclo && (
            <p className="text-kpi-label text-red text-sm text-center">{errorOtroCiclo}</p>
          )}
        </div>
      </div>
    );
  }

  // Con cronómetro: el reloj sube desde que se encendió y Finalizar siempre está
  // a la vista (lo decide quien tiene la ropa enfrente). Si llegó al tope, el
  // corte ya le quitó la luz y se dice en rojo.
  if (maquina.cronometro && nota) {
    // La secadora va en rojo, como con temporizador.
    const esSecadoraCrono = maquina.tipo === 'secadora';
    const debeSecar = !esSecadoraCrono && Array.isArray(nota?.lavadoras_con_secado_ids)
      && nota.lavadoras_con_secado_ids.some(mid => String(mid) === String(maquina.id));
    return (
      <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
        <div className={`${headerCls} ${esSecadoraCrono ? 'bg-red text-white' : header.cls}`}>
          <NombreMaquina maquina={maquina} className={nombreCls} />
        </div>
        <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-3">
          <CircularTimer
            progress={maquina.progreso ?? 0}
            label={maquina.tiempo_restante ?? '—:—'}
            color={maquina.tope_alcanzado || esSecadoraCrono ? 'red' : 'blue'}
          />
          {maquina.tope_alcanzado ? (
            <p className="text-kpi-label text-red text-sm text-center">
              Llegó al tope: se finaliza sola en unos segundos.
            </p>
          ) : maquina.programa_cumplido ? (
            /* Ya cumplió el programa elegido: falta finalizarla (la luz se corta en el tope). */
            <p className="text-kpi-label text-amber-600 text-sm text-center">
              {/* La de fichas puede llevar tiempo sumado en Salidas: su fin no es "un programa". */}
              {maquina.de_fichas
                ? 'Se le acabó el tiempo. Finalízala.'
                : `Terminó su programa de ${maquina.ciclo_elegido_minutos} min. Finalízala.`}
            </p>
          ) : maquina.ciclo_elegido_minutos ? (
            <p className="text-kpi-label text-sm text-center text-gray-500">
              {maquina.minutos_pagados
                ? `${maquina.minutos_pagados} min metidos`
                : `Programa de ${maquina.ciclo_elegido_minutos} min`}
            </p>
          ) : null}
          {infoNota}
          <button
            onClick={(e) => { e.stopPropagation(); onTerminarCiclo?.(maquina); }}
            className="w-full bg-green ring ring-green-700 text-white text-section py-6 rounded-card-sm shadow-card hover:opacity-90 transition-opacity mt-1"
          >
            {debeSecar ? 'INICIAR SECADO' : 'FINALIZAR'}
          </button>
        </div>
      </div>
    );
  }

  // Temporizador en marcha: secadora en rojo, lavadora en azul.
  const esSecadora = maquina.tipo === 'secadora';
  return (
    <div {...containerProps} className={`rounded-card bg-white shadow-card overflow-hidden ${interactivoCls}`}>
      <div className={`${headerCls} ${esSecadora ? 'bg-red text-white' : header.cls}`}>
        <NombreMaquina maquina={maquina} className={nombreCls} />
      </div>
      <div className="px-card-pad pt-5 pb-6 flex flex-col items-center gap-4">
        <CircularTimer
          progress={maquina.progreso ?? 1}
          label={maquina.tiempo_restante ?? '—:—'}
          color={esSecadora ? 'red' : 'blue'}
        />
        {/* El ciclo, pegado al bloque de la nota. */}
        <div className="w-full flex flex-col items-center gap-1">
          {infoNota}
          {contadorCiclos}
        </div>
      </div>
    </div>
  );
}
