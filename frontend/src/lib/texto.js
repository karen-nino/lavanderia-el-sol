export function capitalizarNombre(s) {
  const t = (s ?? '').trim();
  if (!t) return t;
  return t
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ¿Dos nombres son el mismo, sin importar mayúsculas, acentos ni espacios de
// más? "  rebeca " y "Rebeca" sí; "Ana" y "Ana López" no. Lo usa el login para
// elegir solo al usuario cuando se escribe su nombre completo (2026-10-03).
export function mismoNombre(a, b) {
  const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
  const x = norm(a);
  return x !== '' && x === norm(b);
}
