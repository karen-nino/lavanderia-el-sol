export function capitalizarNombre(s) {
  const t = (s ?? '').trim();
  if (!t) return t;
  return t
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * ¿Son el mismo nombre, sin importar mayúsculas, acentos ni espacios? ("  rebeca "
 * y "Rebeca" sí; "Ana" y "Ana López" no).
 */
export function mismoNombre(a, b) {
  const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
  const x = norm(a);
  return x !== '' && x === norm(b);
}
