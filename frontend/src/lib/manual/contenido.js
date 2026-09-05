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
        cuerpo: `Antes de cobrar la primera nota hay que abrir la caja. Ve a Caja y toca Abrir caja: escribe el dinero con el que empiezas el turno (el fondo) y confirma.

Hay UNA caja abierta a la vez por sucursal, así que si un compañero ya la abrió, no tienes que abrir otra: todos cobran sobre la misma.

Si se te olvida y empiezas una nota, la app te lo recuerda con un aviso amarillo que abre la caja ahí mismo, sin salirte de la nota.

Si nadie cerró la caja de ayer, la app la cierra sola a medianoche y la deja marcada como "Sin conteo". Eso no es un error: es para que hoy puedas abrir la tuya y las ventas no se revuelvan con las del día anterior.`,
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
3. Por cada carga di qué necesita: lavadora (Mediana o Jumbo) y, si va a secar, la secadora.
4. Agrega los productos que se lleve (jabón, suavizante, bolsas) con el botón Agregar productos.
5. Toca Aceptar. Se abre el cobro: elige cómo pagó y confirma.

EN AUTOSERVICIO SE COBRA ANTES DE LAVAR. La app no deja arrancar una máquina de una nota que todavía debe.

El cliente no se identifica: la nota queda anónima. Si quieres mandarle el ticket, pídele su teléfono en la pantalla del ticket.

La nota nace En Espera y SIN máquina asignada: la máquina física se elige después, en Salidas.`,
      },
      {
        id: 'nota-por-encargo',
        titulo: 'Crear una nota por encargo',
        claves: ['encargo', 'dejar ropa', 'servicio completo', 'edredon'],
        cuerpo: `Por encargo es cuando el cliente deja su ropa y el negocio la lava, la seca y la entrega.

1. Toca Nueva nota y elige Por Encargo.
2. Elige el cliente (o dalo de alta ahí mismo). Aquí SÍ hace falta cliente: es la ropa de alguien que va a volver por ella.
3. Por cada carga captura qué recibes: tipo de prenda, tela o tamaño de edredón, y el tamaño de la carga (Chica, Grande, Jumbo).
4. Cada carga ya viene con jabón y suavizante precargados; quítalos o cámbialos si no aplica.
5. Pon la fecha de entrega.
6. Elige si te paga ahora o al entregar.

A diferencia de autoservicio, aquí SÍ se puede empezar sin cobrar: en el encargo se suele cobrar al entregar.

El precio de una carga por encargo lo manda el TOPE de su tamaño, que el administrador configura en Ajustes.`,
      },
      {
        id: 'cobrar-una-nota',
        titulo: 'Cobrar una nota (liquidar)',
        claves: ['cobrar', 'pagar', 'liquidar', 'efectivo', 'transferencia', 'tarjeta'],
        cuerpo: `Abre la nota y toca Liquidar nota. Elige cómo te pagó: Efectivo, Transferencia o Tarjeta.

LA FORMA DE PAGO ES OBLIGATORIA y no es un trámite: el corte del día separa el dinero del cajón de lo que entró por transferencia y tarjeta. Si la marcas mal, al hacer el corte va a aparecer un faltante que no existe.

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

FINALIZADA — se acabó. En AUTOSERVICIO la nota llega aquí SOLA en cuanto termina su última carga, sin pasar por Por Entregar: el cliente está en el local y se lleva su ropa él mismo, no hay nada que entregar después.

CANCELADA — la nota se anuló. Solo un administrador puede cancelar, y solo si todavía no se ha cobrado.`,
      },
      {
        id: 'buscar-una-nota',
        titulo: 'Buscar una nota',
        claves: ['encontrar', 'filtro', 'folio', 'ayer', 'buscador'],
        cuerpo: `Entra a Notas. Arriba tienes el buscador y dos filtros.

El buscador encuentra por FOLIO, por nombre del cliente o por teléfono. No hace falta escribir los acentos.

El filtro de fecha arranca en Hoy. Cámbialo a Ayer, Últimos 7 días, Este mes, o elige un mes o un año concretos.

El filtro de estado te deja ver solo las que están Por Entregar, las que tienen pagos pendientes, las canceladas, etc.

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
        cuerpo: `Al crear la nota solo se elige el TIPO de máquina. La máquina física se asigna después, cuando vas a meter la ropa.

Abre la nota y entra a Salidas (o entra desde la lista de máquinas). Toca Asignar máquina y la app te pregunta DÓNDE VA:

· A una carga que ya existe y tiene un hueco libre (lo normal: la Carga 1 ya tiene lavadora y le falta la secadora).
· A una carga nueva.

Viene precargada la primera carga con hueco, que es el caso de siempre.

La secadora de una carga se asigna cuando termina su lavado, no antes: así no apartas una secadora que estaría parada media hora.`,
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

Lo que sale impreso (el R.F.C. del negocio y la nota en letra chica del pie) lo configura el administrador en Ajustes → Ticket.`,
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
        claves: ['bidon', 'rellenar', 'tapas', 'botella', 'bolsa', 'rollo'],
        cuerpo: `Los líquidos se manejan de dos formas:

· A GRANEL — se mide en TAPAS. Cuando llenas un bidón, usa Rellenar bidón: la app le suma las tapas que trae.
· DE MARCA — se vende la botella entera.

OJO CON EL PRECIO: en autoservicio se cobra la BOTELLA completa, y por encargo se cobra POR TAPA. Es el mismo producto con dos precios, según el servicio.

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

La app compara lo que contaste contra lo que ESPERABA y te dice si sobra o falta.

Lo cobrado por transferencia y tarjeta se muestra aparte, en "Cobrado fuera del cajón": ese dinero NO está en el cajón, así que no lo sumes a lo que cuentas.

Ahí está la razón de marcar bien la forma de pago al cobrar: una transferencia registrada como efectivo aparece como faltante al final del día.

Una vez cerrado el corte, sus cifras quedan congeladas: aunque después se corrija un cobro viejo, ese corte ya no cambia.`,
      },
      {
        id: 'cerrar-sesion',
        titulo: 'Cerrar sesión y hora de salida',
        claves: ['salir', 'salida', 'terminar turno', 'logout'],
        cuerpo: `Cierra sesión desde el Menú (☰) → Cerrar sesión.

Tu cierre de sesión queda registrado como tu HORA DE SALIDA del día.

Si dejas la caja abierta, la app te avisa antes de dejarte salir y te ofrece ir a hacer el corte. Puedes salir de todos modos, pero lo correcto es cortar antes.

Cada cuenta puede tener UNA sesión a la vez: si entras en otro aparato, la sesión anterior se cierra.`,
      },
    ],
  },
];
