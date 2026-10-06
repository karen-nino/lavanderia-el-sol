// Manual de uso de la app, en el código y no en la base de datos: así se
// actualiza en el mismo commit que el cambio que describe y no queda desfasado
// sin que nadie lo note. Para agregar un artículo basta sumarlo a su sección.
//
// Cada artículo lleva:
//   id      → ancla de la URL (/manual#cobrar-una-nota), para mandarlo por chat
//   titulo  → lo que se ve y por donde se busca primero
//   cuerpo  → texto plano; los saltos de línea se respetan al pintarlo
//   claves  → palabras con que la gente lo buscaría aunque no estén escritas
//             ("cobrar" para el artículo que habla de "liquidar")

export const SECCIONES_MANUAL = [
  {
    id: 'empezar',
    titulo: 'Empezar el día',
    articulos: [
      {
        id: 'entrar',
        titulo: 'Entrar a la app',
        claves: ['login', 'contraseña', 'iniciar sesion', 'entrada', 'checador'],
        cuerpo: `Escribe tu nombre en el campo Usuario y elige el tuyo de la lista que aparece. Luego pon tu contraseña y toca Iniciar sesión.

Tu primer inicio de sesión del día queda registrado como tu HORA DE ENTRADA. No hay que checar en ningún otro lado: entrar a la app es checar.

Si no encuentras tu nombre en la lista, avísale al administrador: puede que tu cuenta esté desactivada.`,
      },
      {
        id: 'abrir-la-caja',
        titulo: 'Abrir la caja',
        claves: ['fondo', 'apertura', 'empezar', 'dinero inicial'],
        cuerpo: `Antes de crear la primera nota hay que abrir la caja: SIN CAJA ABIERTA NO SE PUEDE CREAR NINGUNA NOTA. Ve a Caja → Corte y toca Abrir caja.

La caja funciona por TURNOS: abrir la caja es empezar tu turno, y hacer el corte es terminarlo.

El fondo NO se captura: la app lo trae del corte del turno anterior, porque el dinero que quedó en el cajón es con el que empiezas tú. Lo ves arriba ("Quedó del corte anterior") y el campo está bloqueado. Si el efectivo del cajón no coincide, un administrador es quien puede ajustarlo.

Hay UNA caja abierta a la vez por sucursal: si un compañero ya la abrió, ese es SU turno y todos cobran sobre la misma. Para entregar el cajón, él hace su corte y luego tú abres el tuyo.

Si se te olvida y entras a Nueva nota, en lugar del formulario sale un aviso amarillo con el botón Abrir caja; al abrirla aparece el formulario.

Si nadie cerró la caja de ayer, la app la cierra sola a medianoche y la deja marcada como "Sin conteo". Eso no es un error: es para que hoy puedas abrir la tuya y las ventas no se revuelvan con las del día anterior. En ese caso el fondo que propone es el que DEBERÍA haber en el cajón (nadie lo contó), así que cuenta el efectivo antes de abrir.`,
      },
    ],
  },

  {
    id: 'notas',
    titulo: 'Notas',
    articulos: [
      {
        id: 'nota-autoservicio',
        titulo: 'Crear una nota de autoservicio',
        claves: ['nueva nota', 'cliente lava', 'maquinita', 'registrar'],
        cuerpo: `Autoservicio es cuando el cliente lava su propia ropa y se la lleva.

1. Toca el botón azul (+) en Inicio, o entra a Notas y elige Nueva nota.
2. Elige Autoservicio.
3. Toca **Agregar máquina**: sale la lista de las que están libres, con su tamaño y su precio. Marca todas las que va a usar el cliente —L1 y S2, las que sean— y toca Agregar. Cada una entra como una máquina de la nota, con su tarifa.
4. Agrega los productos que se lleve (jabón, suavizante, bolsas) con el botón Agregar producto.
5. El Resumen te dice lo que va a pagar. Toca Aceptar: la nota se guarda pendiente de cobro y la app te deja **en Salidas**, con sus máquinas listas para encender.

SE ELIGE LA MÁQUINA, NO EL TIPO. Ya no se dice "una lavadora mediana" para escoger cuál después: se escoge L3 de una vez, y por eso el alta ya sabe cuánto cobrar. Si te equivocaste, el bote de basura del renglón la quita.

LA LISTA SOLO TRAE LAS QUE ESTÁN LIBRES. Si una máquina está en uso, o ya la apuntó otra nota que sigue abierta, no aparece: la nota cobra por esa máquina desde el alta, y no se puede vender dos veces.

LA MÁQUINA QUEDA APUNTADA, NO ARRANCADA. Se inicia en Salidas, con su botón.

EL COBRO SE HACE DESPUÉS, EN LA NOTA. Abre la nota y toca Liquidar: ahí eliges cómo pagó. La máquina se puede arrancar aunque todavía no haya pagado, igual que por encargo.

Si la nota ya terminó todas sus cargas, al liquidarla se cierra sola: el cliente ya se llevó su ropa y no hay nada que entregar.

El cliente no se identifica: la nota queda a nombre de Mostrador. Si quieres mandarle el ticket, pídele su teléfono en la pantalla del ticket.`,
      },
      {
        id: 'nota-por-encargo',
        titulo: 'Crear una nota por encargo',
        claves: ['encargo', 'dejar ropa', 'servicio completo', 'edredon'],
        cuerpo: `Por encargo es cuando el cliente deja su ropa y el negocio la lava, la seca y la entrega.

1. Toca Nueva nota y elige Por Encargo.
2. Elige el cliente, dalo de alta ahí mismo, o toca Mostrador si no lo vas a registrar. Con Mostrador la nota queda a ese nombre: si luego quieres mandarle el ticket o avisarle que ya está, la app te pide su teléfono en ese momento, igual que en autoservicio.
3. Di cuántos servicios son de cada tamaño: Chico, Mediano, Grande y Edredón. Cada servicio ya incluye su lavado, su secado, el jabón, el suavizante y la bolsa.
4. Si quieres, captura el detalle de cada servicio: el tipo de tela, o el tamaño del edredón. Los dos son opcionales.
5. Lo que el servicio trae dentro sale en "Incluido en los servicios": ahí puedes servir más jabón o quitar la bolsa. Eso NO se cobra aparte.
6. Si el cliente compra algo (un suavizante de marca, bolsas de más), agrégalo en Productos: eso SÍ se cobra encima del servicio.
7. Pon la fecha de entrega y elige si te paga ahora o al entregar.

Aquí el cobro también puede esperar: en el encargo se suele cobrar al entregar.

El precio de cada servicio lo configura el administrador en Ajustes → Servicios Por Encargo, y no depende de en qué máquina acabe lavándose: la máquina se le asigna después, en Salidas.`,
      },
      {
        id: 'nota-productos',
        titulo: 'Vender productos (sin lavado)',
        claves: ['venta', 'productos', 'jabon', 'suavizante', 'bolsa', 'mostrador', 'sin lavar'],
        cuerpo: `Cuando alguien solo viene a comprar: un suavizante, unas bolsas. Sin lavadora y sin secadora.

1. Toca Nueva nota y elige Productos.
2. Agrega lo que se lleva con el botón Agregar producto y ajusta las cantidades.
3. Toca Aceptar, elige cómo pagó y confirma.

La venta es ANÓNIMA, como el autoservicio: no se captura cliente. Si te piden el ticket, se manda por WhatsApp pidiendo el teléfono en esa pantalla.

LA VENTA SE COBRA AL MOMENTO. No se puede dejar a deber: la nota nace pagada y FINALIZADA en el mismo acto, porque el cliente se lleva lo que compró ahí mismo. No aparece en Salidas ni en Máquinas, y el producto sale del inventario de inmediato.

Los líquidos se venden por BOTELLA entera (no por medida, que es como se cobran dentro de un encargo) y las bolsas por pieza.

Si te equivocaste, la venta no se edita ni se cancela: un administrador la ELIMINA desde la nota y el producto vuelve al inventario.`,
      },
      {
        id: 'cobrar-una-nota',
        titulo: 'Cobrar una nota (liquidar)',
        claves: ['cobrar', 'pagar', 'liquidar', 'efectivo', 'transferencia', 'tarjeta'],
        cuerpo: `Abre la nota y toca Liquidar nota. Elige cómo te pagó: Efectivo o Transferencia.

LA FORMA DE PAGO ES OBLIGATORIA y no es un trámite: el corte del día separa el dinero del cajón de lo que entró por transferencia. Si la marcas mal, al hacer el corte va a aparecer un faltante que no existe.

Si te equivocaste al registrarla, un administrador puede corregirla con "Corregir forma de pago" en la nota, PERO solo mientras la caja donde se cobró siga abierta. Una vez hecho el corte, las cifras quedan congeladas y ya no se puede.

Si cambias algo que mueve el total de una nota ya cobrada (agregas un producto, quitas una carga), la nota vuelve a quedar pendiente y la app te avisa en ámbar cuánto falta cobrar.`,
      },
      {
        id: 'estados-de-una-nota',
        titulo: 'Qué significa cada estado',
        claves: ['en espera', 'lavando', 'secando', 'por entregar', 'finalizada', 'colores'],
        cuerpo: `EN ESPERA — la nota está capturada pero ninguna máquina ha arrancado.

LAVANDO — al menos una lavadora de la nota está corriendo.

SECANDO — ya no hay lavadoras corriendo, pero sí una secadora.

POR ENTREGAR — todas las cargas terminaron y la ropa espera a que el cliente venga por ella. Solo aparece en Por Encargo y Edredón.

FINALIZADA — se acabó. En AUTOSERVICIO la nota llega aquí SOLA en cuanto termina su última carga, sin pasar por Por Entregar: el cliente está en el local y se lleva su ropa él mismo, no hay nada que entregar después. Una venta de PRODUCTOS nace directamente aquí: no hay nada que lavar ni que esperar.

CANCELADA — la nota se anuló. Solo un administrador puede cancelar, y solo si todavía no se ha cobrado.`,
      },
      {
        id: 'buscar-una-nota',
        titulo: 'Buscar una nota',
        claves: ['encontrar', 'filtro', 'folio', 'ayer', 'buscador'],
        cuerpo: `Entra a Notas. Arriba tienes el buscador y dos filtros.

El buscador encuentra por FOLIO, por nombre del cliente o por teléfono. No hace falta escribir los acentos.

El filtro de fecha arranca en Hoy. Cámbialo a Ayer, Últimos 7 días, Este mes, o elige un mes o un año concretos.

El filtro de estado te deja ver solo las que están Por Entregar, las que están Por Cobrar, las canceladas, etc.

Los filtros se quedan puestos: si entras a una nota y regresas con la flecha, la lista sigue como la dejaste.`,
      },
    ],
  },

  {
    id: 'maquinas',
    titulo: 'Máquinas y salidas',
    articulos: [
      {
        id: 'asignar-maquina',
        titulo: 'Asignar una máquina a una carga',
        claves: ['salidas', 'poner lavadora', 'secadora', 'que maquina'],
        cuerpo: `EN AUTOSERVICIO la máquina ya se eligió al hacer la nota: aquí solo se inicia. Lo que sigue es meter la ropa y darle a Encender / Iniciar.

EN POR ENCARGO la nota vende SERVICIOS (Chico, Mediano, Grande, Edredón) y las máquinas son cosa de esta pantalla: se ponen con + Agregar, las que te acomoden, y van sin cobro porque lo cobrado es el servicio.

Abre la nota y entra a Salidas (o entra desde la lista de máquinas). Si ves botones Asignar Lav. / Asignar Sec., es una nota vieja de autoservicio que se quedó con el tipo apuntado y sin máquina: ésa se pone por ahí.

Si hace falta una máquina EXTRA (la ropa quedó húmeda y necesita más secado, o hay que volver a lavarla), usa + Agregar. Esa máquina va SIN COBRO: no cambia el total de la nota. Siempre se suma a una carga que ya existe, y una carga admite otra lavadora u otra secadora aunque ya haya pasado por una; lo único que no cabe es una segunda máquina del mismo tipo al mismo tiempo.

Si el cliente quiere más servicio que el que pagó, eso es una nota nueva, no una máquina agregada aquí.`,
      },
      {
        id: 'iniciar-y-terminar',
        titulo: 'Iniciar y terminar un ciclo',
        claves: ['arrancar', 'prender', 'acabar', 'terminar carga', 'secado'],
        cuerpo: `Con la máquina asignada, toca Iniciar. A partir de ahí la tarjeta muestra el tiempo corriendo.

Cuando la máquina acaba, su tarjeta se pone VERDE y el botón te dice el siguiente paso:

· INICIAR SECADO — si esa carga lleva secado.
· FINALIZAR CARGA — si ya no lleva nada más.

Todas las máquinas que cumplen su ciclo se ven igual, sean de autoservicio o de encargo; lo único que cambia es ese botón.

Cuando terminas la ÚLTIMA carga de la nota, la nota se cierra sola: pasa a Por Entregar, o directo a Finalizada si es autoservicio.

Si una máquina se queda encendida y nadie la libera, el cierre automático de medianoche la suelta.`,
      },
      {
        id: 'maquina-ocupada',
        titulo: 'Cuando dos notas quieren la misma máquina',
        claves: ['ocupada', 'ya la tiene', 'conflicto', 'cambiar maquina'],
        cuerpo: `Asignar una máquina NO la aparta. Dos notas pueden tener apuntada la misma lavadora mientras nadie la arranque.

SE LA QUEDA QUIEN LE DA A "INICIAR" PRIMERO.

Si otro compañero te ganó, al intentar iniciar te aparece un aviso diciendo QUÉ NOTA se la quedó (con su folio) y un botón Cambiar máquina para mandar tu carga a otra.

En los selectores, las máquinas que otra nota tiene apuntadas salen marcadas con un "también en 0018-020926", para que sepas de antemano cuáles están peleadas.`,
      },
    ],
  },

  {
    id: 'entregar',
    titulo: 'Entregar al cliente',
    articulos: [
      {
        id: 'entregar-la-ropa',
        titulo: 'Entregar la ropa',
        claves: ['finalizar', 'dar la ropa', 'recoger', 'terminar nota'],
        cuerpo: `Cuando el cliente viene por su ropa, abre su nota y toca Finalizar.

NO SE PUEDE FINALIZAR UNA NOTA QUE DEBE DINERO. Si está pendiente, la app te muestra Liquidar en vez de Finalizar: cobra primero.

Al finalizar, los productos que llevaba la nota (jabón, bolsas) se descuentan del inventario.

Esto aplica a Por Encargo y Edredón. Las de autoservicio ya se cerraron solas cuando terminó su última carga.`,
      },
      {
        id: 'mandar-el-ticket',
        titulo: 'Mandar el ticket por WhatsApp',
        claves: ['ticket', 'recibo', 'nota impresa', 'whatsapp', 'comprobante'],
        cuerpo: `Abre la nota y toca el ícono verde de WhatsApp, arriba a la derecha. Verás el ticket como le va a llegar al cliente.

El ticket se manda como IMAGEN, no como texto. Desde el celular se abre la hoja de compartir y eliges el chat. Desde una computadora se descarga la imagen y se abre WhatsApp Web.

Como es imagen, no se puede dejar el chat preseleccionado: hay que elegir el contacto al compartir.

Si la nota no tiene teléfono, la pantalla del ticket te deja capturarlo ahí mismo.

Lo que sale impreso (el R.F.C. del negocio y la nota en letra chica del pie) lo configura el administrador en Ajustes → Ticket. Hay TRES notas al pie y cada ticket lleva la suya: una para Autoservicio, otra para Por Encargo y Edredón, y otra para las ventas de Productos. La que se deje vacía no se imprime.`,
      },
    ],
  },

  {
    id: 'inventario',
    titulo: 'Inventario',
    articulos: [
      {
        id: 'productos-existencias',
        titulo: 'Ver y ajustar existencias',
        claves: ['stock', 'jabon', 'suavizante', 'entradas', 'salidas', 'agotado'],
        cuerpo: `En Inventario ves cada producto con lo que queda. La app distingue dos cosas que se ven parecido:

· EXISTENCIA — lo que hay en el estante.
· APARTADO — lo que ya está comprometido en notas que aún no se entregan.

Para registrar una compra o una merma usa Entrada o Salida en el producto: cada movimiento queda en su Historial de movimientos, con quién y cuándo.

Cuando un producto baja de su mínimo, aparece un aviso en la campana del Inicio.

Un producto que ya se usó en notas NO se borra: se ARCHIVA. Así el historial viejo sigue cuadrando.`,
      },
      {
        id: 'granel-y-bolsas',
        titulo: 'Granel, bidones y bolsas',
        claves: ['bidon', 'rellenar', 'medidas', 'botella', 'bolsa', 'rollo'],
        cuerpo: `Los líquidos se manejan de dos formas:

· A GRANEL — se mide en MEDIDAS. Cuando llenas un bidón, usa Rellenar bidón: la app le suma las medidas que trae.
· DE MARCA — se vende la botella entera.

OJO CON EL PRECIO: en autoservicio se cobra la BOTELLA completa, y por encargo se cobra POR MEDIDA. Es el mismo producto con dos precios, según el servicio.

Las bolsas se compran POR ROLLO y se cobran POR PIEZA en la nota. Hay tres tamaños: chica, grande y jumbo.`,
      },
    ],
  },

  {
    id: 'cerrar',
    titulo: 'Cerrar el día',
    articulos: [
      {
        id: 'hacer-el-corte',
        titulo: 'Hacer el corte de caja',
        claves: ['cierre', 'cuadrar', 'contar dinero', 'faltante', 'sobrante'],
        cuerpo: `Ve a Caja y toca Hacer corte. Cuenta el dinero FÍSICO del cajón y escribe esa cantidad en Efectivo contado.

El corte lo hace QUIEN ABRIÓ EL TURNO (o un administrador): es quien responde por el cajón. Si el turno es de otra persona, la app te lo dice y no te deja cortarlo.

La app compara lo que contaste contra lo que ESPERABA y te dice si sobra o falta.

Lo cobrado por transferencia se muestra aparte, en "Cobrado fuera del cajón": ese dinero NO está en el cajón, así que no lo sumes a lo que cuentas.

Ahí está la razón de marcar bien la forma de pago al cobrar: una transferencia registrada como efectivo aparece como faltante al final del día.

Una vez cerrado el corte, sus cifras quedan congeladas: aunque después se corrija un cobro viejo, ese corte ya no cambia.`,
      },
      {
        id: 'cerrar-sesion',
        titulo: 'Cerrar sesión y hora de salida',
        claves: ['salir', 'salida', 'terminar turno', 'logout'],
        cuerpo: `Cierra sesión desde el Menú (☰) → Cerrar sesión.

Tu cierre de sesión queda registrado como tu HORA DE SALIDA del día.

Si abriste la caja, NO PUEDES CERRAR SESIÓN hasta hacer el corte: la app te avisa y te lleva a Caja. Solo un administrador puede salir sin cortar.

Cada cuenta puede tener UNA sesión a la vez: si entras en otro aparato, la sesión anterior se cierra.`,
      },
    ],
  },
];
