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
//   · las líneas de máquina, SPE, edredón y productos son las ventas en
//     efectivo por concepto: ESAS se suman en Ingresos;
//   · "Cómo se cobró" (efectivo y transferencia, como en Ventas) se informa
//     aparte y no se suma; la transferencia y el SPE Debe no entran ni salen
//     del cajón, así que no cuentan en los totales;
//   · TOTAL INGRESOS − TOTAL EGRESOS = ESPERADO EN CAJA.

const num = (v) => Number(v ?? 0) || 0;

// Los conceptos en que se reparte lo cobrado, en el orden en que se leen. Los
// usan Ingresos (efectivo de un turno) y Ventas → Corte de caja → Por concepto
// (todos los cobros del período).
export const CONCEPTOS = [
  { key: 'lavadoras_medianas', label: 'Lavadoras Medianas' },
  { key: 'lavadoras_jumbo',    label: 'Lavadoras Jumbo' },
  { key: 'secadoras',          label: 'Secadoras' },
  { key: 'por_encargo',        label: 'SPE' },     // Servicios Por Encargo
  // Servicios Por Encargo de Edredón, con sus tamaños (incluye Cubre Colchón).
  { key: 'edredon',            label: 'Edredón' },
  { key: 'productos',          label: 'Productos' },
];

// Renglones { label, value } de un reparto por concepto.
export const lineasConcepto = (reparto) =>
  CONCEPTOS.map(({ key, label }) => ({ label, value: num(reparto?.[key]) }));

export function desgloseCaja(t) {
  const efectivo = num(t.ventas_desglose?.efectivo);
  const ing = t.ingresos;

  const ingresos = [
    { label: 'Caja inicial', value: num(t.monto_inicial), sign: '' },
    { label: 'Entradas',     value: num(t.entradas),      sign: '+' },
    // Sin reparto (respaldo por si faltara el dato) se suma el efectivo en un
    // solo renglón, para que el total se siga viendo completo.
    ...(ing
      ? lineasConcepto(ing).map((l) => ({ ...l, sign: '' }))
      : [{ label: 'Ventas en efectivo', value: efectivo, sign: '+' }]),
  ];
  // Informativo, como "Cómo se cobró" de Ventas: no se suma.
  const comoSeCobro = [
    { label: 'Efectivo',      value: efectivo, sign: '' },
    { label: 'Transferencia', value: num(t.ventas_desglose?.transferencia), sign: '' },
    // Tarjeta ya no se ofrece al cobrar (2026-10-06): solo si hubo cobros viejos.
    ...(num(t.ventas_desglose?.tarjeta) > 0
      ? [{ label: 'Tarjeta', value: num(t.ventas_desglose.tarjeta), sign: '' }]
      : []),
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
    comoSeCobro,
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
