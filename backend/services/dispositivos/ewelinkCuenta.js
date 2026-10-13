// Sesión de eWeLink guardada en `ewelink_cuenta` (una fila). Separada del driver,
// que solo pide un token válido.

import crypto from 'crypto';
import pool from '../../db/pool.js';

/** Minutos para autorizar en eWeLink antes de que el `state` caduque. */
const STATE_VIGENCIA_MIN = 15;

export async function leerCuenta() {
  const { rows } = await pool.query('SELECT * FROM ewelink_cuenta WHERE id = 1');
  return rows[0] ?? null;
}

/** ¿Cuenta utilizable? Con el refresh token vencido cuenta como desconectada. */
export function estaConectada(cuenta) {
  if (!cuenta?.access_token || !cuenta?.refresh_token) return false;
  if (cuenta.rt_expira_at && new Date(cuenta.rt_expira_at) <= new Date()) return false;
  return true;
}

export async function guardarTokens(tokens) {
  const { rows } = await pool.query(
    `UPDATE ewelink_cuenta
        SET access_token   = $1,
            refresh_token  = $2,
            region         = $3,
            at_expira_at   = $4,
            rt_expira_at   = $5,
            cuenta         = COALESCE($6, cuenta),
            state          = NULL,
            state_at       = NULL,
            actualizado_at = NOW()
      WHERE id = 1
      RETURNING *`,
    [
      tokens.accessToken,
      tokens.refreshToken,
      tokens.region,
      tokens.atExpiraAt,
      tokens.rtExpiraAt,
      tokens.cuenta ?? null,
    ]
  );
  return rows[0];
}

export async function borrarCuenta() {
  await pool.query(
    `UPDATE ewelink_cuenta
        SET access_token = NULL, refresh_token = NULL, region = NULL,
            at_expira_at = NULL, rt_expira_at = NULL, cuenta = NULL,
            state = NULL, state_at = NULL, actualizado_at = NOW()
      WHERE id = 1`
  );
}

/** Genera y guarda el `state` del flujo. */
export async function crearState() {
  const state = crypto.randomBytes(16).toString('hex');
  await pool.query(
    'UPDATE ewelink_cuenta SET state = $1, state_at = NOW(), actualizado_at = NOW() WHERE id = 1',
    [state]
  );
  return state;
}

/**
 * Verifica y quema el `state` del redirect: es lo que impide canjear un code que
 * no pedimos (el callback es público). Compara en tiempo constante.
 */
export async function consumirState(state) {
  const cuenta = await leerCuenta();
  const esperado = cuenta?.state;
  await pool.query('UPDATE ewelink_cuenta SET state = NULL, state_at = NULL WHERE id = 1');

  if (!esperado || !state) return false;
  const a = Buffer.from(String(esperado));
  const b = Buffer.from(String(state));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const vence = new Date(cuenta.state_at).getTime() + STATE_VIGENCIA_MIN * 60_000;
  return Date.now() <= vence;
}
