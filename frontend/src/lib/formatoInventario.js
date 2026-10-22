/**
 * Existencias en unidades reales, sin decimales: el stock va en medidas y aquí
 * se reparte en botellas y bidones (Reporte diario y su exportación).
 */

/**
 * Lo que se vende por unidad entera: marca y granel en polvo. La columna la
 * calcula la BD; lo demás es respaldo.
 */
export function seVendePorUnidad(p) {
  if (p?.se_vende_por_unidad != null) return Boolean(p.se_vende_por_unidad);
  return p?.tipo_liquido === 'marca' || p?.forma === 'polvo';
}

/** Granel en polvo: se nombra aparte para no confundir dos "Jabón". */
export function esPolvo(p) {
  return p?.clase !== 'bolsa' && p?.forma === 'polvo';
}

export function plural(n, sing, plur) {
  return `${n} ${n === 1 ? sing : plur}`;
}

// Reparte unas medidas en { botellas, medidas } (medidas sueltas < 1 botella).
export function partesBotellas(medidas, medidasPorBotella) {
  const t = Math.max(0, Math.round(Number(medidas) || 0));
  const tpb = Number(medidasPorBotella) || 0;
  if (tpb <= 0) return { botellas: 0, medidas: t };
  return { botellas: Math.floor(t / tpb), medidas: t % tpb };
}

// Unas medidas contadas en botellas y medidas sueltas. En productos de marca
// la botella se nombra "pieza".
export function textoBotellas(medidas, medidasPorBotella, { marca = false } = {}) {
  const { botellas, medidas: sueltas } = partesBotellas(medidas, medidasPorBotella);
  const unidad = marca ? plural(botellas, 'pieza', 'piezas') : plural(botellas, 'botella', 'botellas');
  const partes = [];
  if (botellas > 0 || sueltas === 0) partes.push(unidad);
  if (sueltas > 0) partes.push(plural(sueltas, 'medida', 'medidas'));
  return partes.join(' y ');
}

// Líquido a granel (bidón) a "N bidones y M botellas" (remanente < 1 bidón en
// botellas). Sin datos de bidón, cae a botellas.
export function textoGranel(medidasGranel, medidasPorBidon, medidasPorBotella) {
  const t = Math.max(0, Math.round(Number(medidasGranel) || 0));
  const tpBidon = Number(medidasPorBidon) || 0;
  const tpb = Number(medidasPorBotella) || 0;
  if (tpBidon <= 0) return textoBotellas(t, tpb);
  const bidones = Math.floor(t / tpBidon);
  const botellas = tpb > 0 ? Math.floor((t % tpBidon) / tpb) : 0;
  const partes = [plural(bidones, 'bidón', 'bidones')];
  if (botellas > 0) partes.push(plural(botellas, 'botella', 'botellas'));
  return partes.join(' y ');
}

// Un movimiento del día en líneas: por unidad, una; el granel, botellas y
// bidón (solo las que tuvieron algo). Sin movimiento, un guion. `textoBot`
// escribe lo de botellas.
function lineasMovimiento(p, porUnidad, bot, gra, textoBot = (n) => textoBotellas(n, p?.medidas_por_botella)) {
  if (bot <= 0 && gra <= 0) return ['—'];
  if (porUnidad) return [textoBotellas(bot + gra, p?.medidas_por_botella, { marca: true })];
  if (bot > 0 && gra > 0) {
    return [
      `Rellenadas: ${textoBot(bot)}`,
      `A granel: ${textoGranel(gra, p?.medidas_por_bidon, p?.medidas_por_botella)}`,
    ];
  }
  if (gra > 0) return [`A granel: ${textoGranel(gra, p?.medidas_por_bidon, p?.medidas_por_botella)}`];
  return [textoBot(bot)];
}

/**
 * Medidas con su equivalencia cuando llegan a una botella; primero las
 * botellas: "1 medida", "1 botella = 2 medidas", "1 botella y 1 medida = 3 medidas".
 */
export function textoMedidasEquivalencia(medidas, medidasPorBotella) {
  const n = Math.max(0, Math.round(Number(medidas) || 0));
  const mpb = Number(medidasPorBotella) || 0;
  const enMedidas = plural(n, 'medida', 'medidas');
  if (mpb <= 1 || n < mpb) return enMedidas;
  return `${textoBotellas(n, mpb)} = ${enMedidas}`;
}

/** Lo que entró ese día (Entradas y existencia del alta). */
export function lineasEntradas(p, porUnidad) {
  return lineasMovimiento(p, porUnidad,
    Number(p?.entrada_botellas_medidas) || 0, Number(p?.entrada_granel_medidas) || 0);
}

/**
 * Lo que salió ese día: lo usado en notas que no se devolvió (en botellas) más
 * las salidas manuales. Lo devuelto va en Devuelto.
 */
export function lineasSalidas(p, porUnidad) {
  const bot = (Number(p?.vendido_vigente_medidas) || 0) + (Number(p?.salida_botellas_medidas) || 0);
  return lineasMovimiento(p, porUnidad, Math.max(0, bot), Number(p?.salida_granel_medidas) || 0,
    (n) => textoMedidasEquivalencia(n, p?.medidas_por_botella));
}

/** Lo que regresó ese día por una venta anulada (nota cancelada o borrada), en botellas. */
export function lineasDevuelto(p, porUnidad) {
  return lineasMovimiento(p, porUnidad, Number(p?.devuelto_medidas) || 0, 0);
}

/** Nombre con lo que lo distingue: tamaño en bolsas, marca en productos de marca. */
export function etiquetaProducto(p) {
  if (!p) return '';
  if (p.clase === 'bolsa') {
    return p.tamano_bolsa ? `Bolsa ${p.tamano_bolsa}` : (p.nombre || 'Bolsa');
  }
  if (p.tipo_liquido === 'marca' && p.marca) return `${p.marca} · ${p.nombre}`;
  if (esPolvo(p)) return `${p.nombre} · Polvo`;
  return p.nombre ?? '';
}

/** Para listas de dos líneas: la marca de título y el nombre abajo (Ensueño / Suavizante). */
export function tituloProducto(p) {
  if (!p) return '';
  if (p.clase === 'bolsa') {
    return p.tamano_bolsa ? `Bolsa ${p.tamano_bolsa}` : (p.nombre || 'Bolsa');
  }
  if (p.tipo_liquido === 'marca' && p.marca) return p.marca;
  return p.nombre ?? '';
}

/** Subtítulo: el nombre en los de marca, "Granel" en el bidón; nada en bolsas. */
export function subtituloProducto(p) {
  if (!p || p.clase === 'bolsa') return '';
  if (p.tipo_liquido === 'marca' && p.marca) return p.nombre ?? '';
  if (esPolvo(p)) return 'Polvo';
  if (p.tipo_liquido === 'granel') return 'Granel';
  return '';
}

/** Orden: granel, marca y bolsas (como ordena el backend). */
export function ordenProducto(p) {
  if (p?.tipo_liquido === 'granel') return 0;
  if (p?.tipo_liquido === 'marca')  return 1;
  return 2;
}

/** Unidad de un producto de la nota en texto ("botellas", "medidas"), según su cantidad. */
export function unidadProdTxt(p) {
  const n = Number(p.cantidad);
  if (p.unidad === 'pieza') return n === 1 ? 'pieza' : 'piezas';
  if (p.unidad === 'botella') {
    /* Marca y polvo, por pieza; el granel líquido, por botella. */
    if (seVendePorUnidad(p)) return n === 1 ? 'pieza' : 'piezas';
    return n === 1 ? 'botella' : 'botellas';
  }
  return n === 1 ? 'medida' : 'medidas';
}
