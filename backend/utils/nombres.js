/** "MONRRAZ espinosa" → "Monrraz Espinosa" (respeta acentos). */
export const capitalizarNombre = (texto) =>
  (texto ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es'))
    .join(' ');
