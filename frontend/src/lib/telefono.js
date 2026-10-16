export function formatTelefono(value) {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
}

/** Teléfono para leerlo de un vistazo: "33 1234 5678". Si no son 10 dígitos, tal cual. */
export function telefonoLegible(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 10) return value ?? '';
  return formatTelefono(digits).replace(/-/g, ' ');
}
