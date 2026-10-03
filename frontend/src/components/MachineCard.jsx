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

// Tamaño dicho para el mostrador.
const TAMANO_LABEL = { mediana: 'Mediana', jumbo: 'Jumbo' };

// Nombre de la máquina en la cabecera y, debajo, su marca y tamaño
// (2026-10-03): "LG · Mediana". Sin modelo, a pedido. Si no cabe se corta y el
// texto completo queda en el title.
function NombreMaquina({ maquina, className }) {
  const tamano = TAMANO_LABEL[String(maquina.tamano ?? '').toLowerCase()] ?? null;
  const detalle = [maquina.marca, tamano].filter(Boolean).join(' · ');
  return (
    <>
      <span className={className}>{maquina.nombre}</span>
      {detalle && (
        <span className="max-w-full truncate text-xs font-medium opacity-90 leading-tight" title={detalle}>
          {detalle}
        </span>
      )}
    </>
  );
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

  // En qué ciclo va la carga. Va en las tres caras de la tarjeta —lavando,
  // encendida esperando y terminada— porque la pregunta es la misma en todas:
  // si a esta máquina le queda otra vuelta o ya va de salida. Antes solo
  // aparecía al terminar, que es cuando ya no sirve para planear nada.
  //
  // "Ciclo 1 de 1" no dice nada: una secadora, o una lavadora sin tiempo de
  // marca, corren una sola vuelta y el contador sobra.
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
  const nombreCls = 'text-section uppercase tracking-wide';

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
    // Máquina que cumplió su ciclo: SIEMPRE en verde, sea Autoservicio o Por
    // Encargo. El verde comunica "esta máquina ya terminó", que es lo mismo en
    // los dos casos; lo único que cambia es el siguiente paso, y eso lo dice el
    // botón. Antes la lavadora que pasaba a secado se pintaba de rojo, y dos
    // tarjetas en el mismo estado se veían como si una tuviera un problema.
    //
    // El siguiente paso lo manda el servidor en `lavadoras_con_secado_ids`:
    // son las lavadoras que encadenan el secado al terminar. Hoy solo las de
    // Autoservicio, donde el cliente espera su ropa y se pasa de una máquina a
    // la otra en el momento; en Por Encargo la lavadora finaliza su carga y la
    // secadora se asigna y arranca aparte, desde Salidas (2026-09-22).
    const esSecadora = maquina.tipo === 'secadora';
    const debeSecar = Array.isArray(nota?.lavadoras_con_secado_ids)
      && nota.lavadoras_con_secado_ids.some(mid => String(mid) === String(maquina.id));
    const finalizaCarga = esSecadora || !debeSecar;

    // Un solo botón para los dos momentos en que la tarjeta se pone verde
    // (mig. 108). La primera vez ofrece el siguiente ciclo —una carga de ropa
    // son dos ciclos seguidos—; la segunda ya lleva al paso de siempre. Tener
    // dos botones a la vez hacía elegir entre continuar y cerrar cada vez que
    // terminaba un ciclo, y el 99% de las veces la respuesta es la misma.
    const ofreceOtroCiclo = Boolean(maquina.puede_otro_ciclo);
    const enPausa = ofreceOtroCiclo && maquina.espera_otro_ciclo > 0;
    // El siguiente ciclo empieza igual que el primero: la máquina se quedó sin
    // corriente al terminar, así que primero hay que encenderla. "Iniciar
    // ciclo" llega después, cuando ya está arrancada.
    const etiquetaBoton = otroCicloEnCurso ? 'ENCENDIENDO…'
      : enPausa            ? `ENCENDER EN ${maquina.espera_otro_ciclo}s`
      : ofreceOtroCiclo    ? 'ENCENDER MÁQUINA'
      : finalizaCarga      ? 'FINALIZAR CARGA'
      : 'INICIAR SECADO';
    // El color va con lo que pide el botón, no con el estado de la tarjeta:
    // **ámbar mientras falte algo por hacer** —darle corriente— y **verde
    // cuando lo que toca es arrancar o cerrar la carga**. Por eso esta misma
    // tarjeta es ámbar si ofrece encender y verde si ya solo queda finalizar.
    const c = ofreceOtroCiclo
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
          {/* Mientras corre la pausa sin corriente el botón no desaparece: se
              queda con la cuenta atrás, para que no parezca que no hay nada que
              hacer. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (ofreceOtroCiclo) onEncender?.(maquina);
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

  // Encendida y esperando a que la arranquen (mig. 110). Es el paso intermedio
  // del siguiente ciclo: ya tiene corriente pero nadie ha apretado su botón, así
  // que no hay cronómetro que mostrar. Va en verde: la corriente ya está dada y
  // lo único que queda es arrancar el ciclo.
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

  // Máquina con cronómetro (2026-10-02): el reloj cuenta hacia arriba desde que
  // se encendió y el botón para finalizarla está siempre a la vista, porque
  // aquí nadie avisa que el lavado terminó: lo decide quien tiene la ropa
  // enfrente. Finalizar le corta la luz. Si llegó al tope sin que nadie la
  // finalizara, el corte ya se la quitó y se dice en rojo.
  if (maquina.cronometro && nota) {
    // La secadora conserva su rojo, igual que con temporizador.
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
          {maquina.tope_alcanzado && (
            <p className="text-kpi-label text-red text-sm text-center">
              Llegó al tope y se le cortó la luz.
            </p>
          )}
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

  // Temporizador en marcha. La secadora en uso va en tonos rojos (encabezado
  // y aro del contador); las lavadoras conservan el azul.
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
        {/* Juntos y con poco aire: el ciclo se lee como parte del bloque de la
            nota, no como un dato suelto al final de la tarjeta. */}
        <div className="w-full flex flex-col items-center gap-1">
          {infoNota}
          {contadorCiclos}
        </div>
      </div>
    </div>
  );
}
