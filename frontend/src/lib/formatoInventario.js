// Formateo de existencias de productos líquidos (opción B: unidades reales, sin
// decimales). El stock se lleva en MEDIDAS; aquí se reparte en botellas y bidones.
// Lo usan la pestaña "Reporte diario" de Inventario y su exportación a PDF/CSV.

// Lo que se cuenta y se vende por UNIDAD entera: los productos de marca y el
// jabón EN POLVO (mig. 126), que no se sirve por medidas. La columna la calcula
// la BD; lo demás es respaldo por si el producto llega sin ella.
export function seVendePorUnidad(p) {
  if (p?.se_vende_por_unidad != null) return Boolean(p.se_vende_por_unidad);
  return p?.tipo_liquido === 'marca' || p?.forma === 'polvo';
}

// El granel en polvo: mismo catálogo de nombres que el líquido, pero contado en
// unidades. Se nombra aparte para no confundir dos "Jabón" en la misma lista.
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
// la botella se nombra "unidad".
export function textoBotellas(medidas, medidasPorBotella, { marca = false } = {}) {
  const { botellas, medidas: sueltas } = partesBotellas(medidas, medidasPorBotella);
  const unidad = marca ? plural(botellas, 'unidad', 'unidades') : plural(botellas, 'botella', 'botellas');
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

// Nombre del producto con lo que lo distingue de otro que se llame igual: el
// tamaño en las bolsas y la marca en los productos de marca. Sin esto, tres
// bolsas o dos suavizantes de distinta marca se ven idénticos en las listas.
export function etiquetaProducto(p) {
  if (!p) return '';
  if (p.clase === 'bolsa') {
    return p.tamano_bolsa ? `Bolsa ${p.tamano_bolsa}` : (p.nombre || 'Bolsa');
  }
  if (p.tipo_liquido === 'marca' && p.marca) return `${p.marca} · ${p.nombre}`;
  if (esPolvo(p)) return `${p.nombre} · Polvo`;
  return p.nombre ?? '';
}

// Para listas de dos líneas: la marca manda como título y el nombre baja al
// subtítulo (Ensueño / Suavizante), que es donde también se marca el granel.
export function tituloProducto(p) {
  if (!p) return '';
  if (p.clase === 'bolsa') {
    return p.tamano_bolsa ? `Bolsa ${p.tamano_bolsa}` : (p.nombre || 'Bolsa');
  }
  if (p.tipo_liquido === 'marca' && p.marca) return p.marca;
  return p.nombre ?? '';
}

// Lo que acompaña al título: el nombre en los de marca, "Granel" en el bidón.
// Las bolsas no llevan (su tamaño ya va en el título).
export function subtituloProducto(p) {
  if (!p || p.clase === 'bolsa') return '';
  if (p.tipo_liquido === 'marca' && p.marca) return p.nombre ?? '';
  if (esPolvo(p)) return 'Polvo';
  if (p.tipo_liquido === 'granel') return 'Granel';
  return '';
}

// Orden de presentación: primero el granel, luego los de marca y al final las
// bolsas — el mismo criterio con el que el backend ordena el catálogo.
export function ordenProducto(p) {
  if (p?.tipo_liquido === 'granel') return 0;
  if (p?.tipo_liquido === 'marca')  return 1;
  return 2;
}
