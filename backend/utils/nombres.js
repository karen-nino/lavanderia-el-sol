// Normaliza un nombre propio: cada palabra con la primera letra en mayúscula
// y el resto en minúsculas. Ej.: "juan humberto" → "Juan Humberto",
// "MONRRAZ espinosa" → "Monrraz Espinosa". Respeta acentos (locale es).
export const capitalizarNombre = (texto) =>
  (texto ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es'))
    .join(' ');
