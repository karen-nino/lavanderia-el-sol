// Formateo de existencias de productos líquidos (opción B: unidades reales, sin
// decimales). El stock se lleva en TAPAS; aquí se reparte en botellas y bidones.
// Lo usan la pestaña "Reporte diario" de Inventario y su exportación a PDF/CSV.

export function plural(n, sing, plur) {
  return `${n} ${n === 1 ? sing : plur}`;
}

// Reparte unas tapas en { botellas, tapas } (tapas sueltas < 1 botella).
export function partesBotellas(tapas, tapasPorBotella) {
  const t = Math.max(0, Math.round(Number(tapas) || 0));
  const tpb = Number(tapasPorBotella) || 0;
  if (tpb <= 0) return { botellas: 0, tapas: t };
  return { botellas: Math.floor(t / tpb), tapas: t % tpb };
}

// "3 botellas y 2 tapas" / "3 botellas" / "2 tapas" / "0 botellas".
// En productos de marca la botella se nombra "unidad".
export function textoBotellas(tapas, tapasPorBotella, { marca = false } = {}) {
  const { botellas, tapas: sueltas } = partesBotellas(tapas, tapasPorBotella);
  const unidad = marca ? plural(botellas, 'unidad', 'unidades') : plural(botellas, 'botella', 'botellas');
  const partes = [];
  if (botellas > 0 || sueltas === 0) partes.push(unidad);
  if (sueltas > 0) partes.push(plural(sueltas, 'tapa', 'tapas'));
  return partes.join(' y ');
}

// Líquido a granel (bidón) a "N bidones y M botellas" (remanente < 1 bidón en
// botellas). Sin datos de bidón, cae a botellas.
export function textoGranel(tapasGranel, tapasPorBidon, tapasPorBotella) {
  const t = Math.max(0, Math.round(Number(tapasGranel) || 0));
  const tpBidon = Number(tapasPorBidon) || 0;
  const tpb = Number(tapasPorBotella) || 0;
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
