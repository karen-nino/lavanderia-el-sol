// ¿Ya hay llamadas en eWeLink? Lee el estado de UN Sonoff (1 llamada) sin
// prender ni apagar nada, aunque el control esté en pausa (DISPOSITIVOS_DRIVER=null).
// No toca la tabla maquinas; solo suma la llamada al contador de Ajustes → Sonoffs.
// Se corre dentro del servidor, que ya tiene la base y las llaves de eWeLink:
//   fly ssh console -a lavanderia-el-sol-api -C "node scripts/probar-llamadas-ewelink.mjs"
//   (otra sucursal: ... -C "node scripts/probar-llamadas-ewelink.mjs zapopan")
import 'dotenv/config';
import pool from '../db/pool.js';
import { estado } from '../services/dispositivos/ewelinkDriver.js';
import { configCompleta } from '../services/dispositivos/ewelinkOAuth.js';
import { guardarPendientes } from '../services/dispositivos/ewelinkLlamadas.js';

const sucursal = (process.argv[2] || 'retiro').toLowerCase();

/** Termina guardando el contador y cerrando la base. */
async function terminar(codigo) {
  await guardarPendientes();
  await pool.end();
  process.exit(codigo);
}

if (!configCompleta()) {
  console.error('Faltan EWELINK_APP_ID / EWELINK_APP_SECRET: córrelo dentro del servidor (fly ssh console).');
  await terminar(1);
}

/* Primero una que estuvo enlazada: un Sonoff sin corriente no dice nada del límite. */
const { rows: [maq] } = await pool.query(
  `SELECT id, nombre, sucursal, device_id, device_canal, sonoff_estado
     FROM maquinas
    WHERE sucursal = $1 AND COALESCE(device_id, '') <> ''
    ORDER BY (sonoff_estado = 'enlazada') DESC, nombre
    LIMIT 1`,
  [sucursal]
);
if (!maq) {
  console.error(`No hay máquinas con Sonoff enlazado en "${sucursal}".`);
  await terminar(1);
}

console.log(`Leyendo el Sonoff de ${maq.nombre} (${sucursal})…`);
const r = await estado(maq);

if (r.ok) {
  console.log(`✅ SÍ HAY LLAMADAS. eWeLink contestó: ${maq.nombre} está ${r.estado === 'on' ? 'encendida' : 'apagada'}.`);
  await terminar(0);
}
if (r.motivo === 'ewelink_limite') {
  console.log('⛔ SIGUE EN EL LÍMITE (error 412): eWeLink todavía no da llamadas.');
  await terminar(2);
}
if (r.motivo === 'fuera_de_linea' || r.motivo === 'ewelink_4002') {
  console.log(`⚠️ eWeLink SÍ contestó (hay llamadas), pero el Sonoff de ${maq.nombre} está sin corriente o fuera de línea.`);
  await terminar(0);
}
console.log(`❓ No se pudo saber: ${r.motivo}. Si es sesion_expirada o sin_cuenta_conectada, hay que reconectar la cuenta en Ajustes → Sonoffs.`);
await terminar(3);
