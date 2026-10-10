// Ingresos, Egresos y Desglose de un turno de caja (2026-10-10).
//
// Lo comparten la pantalla del corte, las tarjetas de turno de Ventas y las
// exportaciones (PDF/CSV de Caja y de Ventas), para que todos digan lo mismo.
//
// Recibe un turno con la forma del historial (`leerCortes` en el backend):
//   { monto_inicial, entradas, salidas, ventas_desglose: { efectivo,
//     transferencia }, ingresos: { lavadoras_medianas, ... } | null,
//     spe_debe: number | null }
//
// Reglas (decisiones de la usuaria):
//   · las líneas de máquina, productos, SPE y edredón son el DESGLOSE de las
//     ventas en efectivo: van en su renglón pero no se suman otra vez;
//   · la transferencia y el SPE Debe se informan, pero no entran ni salen del
//     cajón, así que no cuentan en los totales;
//   · TOTAL INGRESOS − TOTAL EGRESOS = ESPERADO EN CAJA.

const num = (v) => Number(v ?? 0) || 0;

export function desgloseCaja(t) {
  const efectivo = num(t.ventas_desglose?.efectivo);
  const ing = t.ingresos;

  const ingresos = [
    { label: 'Caja inicial', value: num(t.monto_inicial), sign: '' },
    { label: 'Entradas',     value: num(t.entradas),      sign: '+' },
    ...(ing ? [
      { label: 'Lavadoras Medianas', value: num(ing.lavadoras_medianas), sign: '' },
      { label: 'Lavadoras Jumbo',    value: num(ing.lavadoras_jumbo),    sign: '' },
      { label: 'Secadoras',          value: num(ing.secadoras),          sign: '' },
      { label: 'Productos',          value: num(ing.productos),          sign: '' },
      { label: 'SPE',                value: num(ing.por_encargo),        sign: '' }, // Servicios Por Encargo
      // Servicios Por Encargo de Edredón, con sus tamaños (incluye Cubre Colchón).
      { label: 'Edredón',            value: num(ing.edredon),            sign: '' },
    ] : []),
    { label: 'Ventas en efectivo', value: efectivo, sign: '+' },
    {
      label: 'Ventas por transferencia', value: num(t.ventas_desglose?.transferencia),
      sign: '', nota: 'No entra al cajón',
    },
  ];
  const totalIngresos = num(t.monto_inicial) + efectivo + num(t.entradas);

  const egresos = [
    // Sin dato en los cortes anteriores a la mig. 153: no se inventa.
    ...(t.spe_debe != null
      ? [{ label: 'SPE Debe', value: num(t.spe_debe), sign: '', nota: 'No sale del cajón' }]
      : []),
    { label: 'Gastos', value: num(t.salidas), sign: '−' },
  ];
  const totalEgresos = num(t.salidas);

  return {
    ingresos,
    totalIngresos,
    egresos,
    totalEgresos,
    desglose: [
      { label: 'Ingresos', value: totalIngresos, sign: '' },
      { label: 'Egresos',  value: totalEgresos,  sign: '−' },
    ],
    esperado: totalIngresos - totalEgresos,
  };
}
