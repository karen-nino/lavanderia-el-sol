/**
 * Ingresos, Egresos y Desglose de un turno de caja. Lo comparten el corte, los
 * turnos de Ventas y las exportaciones, para que digan lo mismo.
 *
 * Recibe un turno con la forma del historial (`leerCortes` en el backend):
 *   { monto_inicial, entradas, salidas, ventas_desglose: { total, efectivo,
 *     transferencia, tarjeta }, ingresos: { lavadoras_medianas, ... } | null,
 *     ingresos_solo_efectivo?, spe_debe: number | null }
 *
 * Reglas:
 * - Ingresos reparte por concepto todo lo vendido (máquinas, SPE, edredón,
 *   productos), con cualquier forma de pago.
 * - Si hubo cobros que no son en efectivo, Ingresos va en dos bloques: lo
 *   vendido por concepto con su TOTAL VENDIDO y "Cómo se cobró" debajo; luego
 *   caja inicial, entradas y ventas en efectivo con el TOTAL EN EFECTIVO. Si
 *   todo fue en efectivo, un solo TOTAL INGRESOS como antes.
 * - Renglones con `subtotal` o `titulo` no se suman.
 * - Cortes congelados con el reparto solo del efectivo
 *   (`ingresos_solo_efectivo`) se leen como entonces: un solo total.
 * - "Cómo se cobró" es informativo; la transferencia y el SPE Debe no pasan
 *   por el cajón.
 * - TOTAL INGRESOS (el de efectivo) − TOTAL EGRESOS = ESPERADO EN CAJA.
 */

const num = (v) => Number(v ?? 0) || 0;

/**
 * Conceptos en que se reparte lo cobrado, en orden de lectura (Ingresos de un
 * turno y Ventas → Por concepto).
 */
export const CONCEPTOS = [
  { key: 'lavadoras_medianas', label: 'Lav. Medianas' },
  { key: 'lavadoras_jumbo',    label: 'Lav. Jumbo' },
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
  const transferencia = num(t.ventas_desglose?.transferencia);
  const tarjeta = num(t.ventas_desglose?.tarjeta);
  const ing = t.ingresos;
  // El reparto trae lo no cobrado en efectivo: lo vendido va en su bloque.
  const hayNoEfectivo = Boolean(ing) && !t.ingresos_solo_efectivo && transferencia + tarjeta > 0;

  // Informativo, como "Cómo se cobró" de Ventas: no se suma.
  const comoSeCobro = [
    { label: 'Efectivo',      value: efectivo, sign: '' },
    { label: 'Transferencia', value: transferencia, sign: '' },
    // Tarjeta solo si hubo cobros viejos con tarjeta.
    ...(tarjeta > 0 ? [{ label: 'Tarjeta', value: tarjeta, sign: '' }] : []),
  ];
  const caja = [
    { label: 'Caja inicial', value: num(t.monto_inicial), sign: '' },
    { label: 'Entradas',     value: num(t.entradas),      sign: '+' },
  ];

  let ingresos;
  if (hayNoEfectivo) {
    const vendidas = lineasConcepto(ing).map((l) => ({ ...l, sign: '' }));
    ingresos = [
      ...vendidas,
      {
        label: 'Total vendido', sign: '', subtotal: true,
        value: vendidas.reduce((a, l) => a + l.value, 0),
      },
      { label: 'Cómo se cobró', titulo: true },
      ...comoSeCobro,
      { label: 'En el cajón', titulo: true },
      ...caja,
      { label: 'Ventas en efectivo', value: efectivo, sign: '+' },
    ];
  } else {
    ingresos = [
      ...caja,
      // Sin reparto, el efectivo en un solo renglón para que el total cuadre.
      ...(ing
        ? lineasConcepto(ing).map((l) => ({ ...l, sign: '' }))
        : [{ label: 'Ventas en efectivo', value: efectivo, sign: '+' }]),
    ];
  }
  const totalIngresos = num(t.monto_inicial) + efectivo + num(t.entradas);

  const egresos = [
    // Sin dato en cortes viejos: no se inventa.
    ...(t.spe_debe != null
      ? [{ label: 'SPE Debe', value: num(t.spe_debe), sign: '', nota: 'No sale del cajón' }]
      : []),
    { label: 'Gastos', value: num(t.salidas), sign: '−' },
  ];
  const totalEgresos = num(t.salidas);

  return {
    ingresos,
    comoSeCobro,
    // "Cómo se cobró" ya va dentro de Ingresos: no repetirlo aparte.
    comoSeCobroDentro: hayNoEfectivo,
    totalIngresos,
    // Con cobros que no son en efectivo, el total de ingresos es el del efectivo.
    totalIngresosLabel: hayNoEfectivo ? 'Total en efectivo' : 'Total ingresos',
    egresos,
    totalEgresos,
    desglose: [
      { label: 'Ingresos', value: totalIngresos, sign: '' },
      { label: 'Egresos',  value: totalEgresos,  sign: '−' },
    ],
    esperado: totalIngresos - totalEgresos,
  };
}
