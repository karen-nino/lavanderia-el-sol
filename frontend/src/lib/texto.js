export function capitalizarNombre(s) {
  const t = (s ?? '').trim();
  if (!t) return t;
  return t
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
