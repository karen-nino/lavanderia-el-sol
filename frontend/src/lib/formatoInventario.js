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
