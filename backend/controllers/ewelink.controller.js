// Conexión de la cuenta de eWeLink por OAuth: la dueña autoriza la app una vez
// desde su navegador.
//   GET  /api/ewelink/estado       ¿hay cuenta conectada? (admin)
//   POST /api/ewelink/conectar     URL de autorización (admin)
//   GET  /api/ewelink/callback     vuelta de eWeLink (público)
//   POST /api/ewelink/desconectar  olvida los tokens (admin)

import * as oauth from '../services/dispositivos/ewelinkOAuth.js';
import * as cuentaStore from '../services/dispositivos/ewelinkCuenta.js';
import { _reset as resetDriver } from '../services/dispositivos/ewelinkDriver.js';
import * as dispositivos from '../services/dispositivos/index.js';

/** Página HTML del callback (sin estilos ni scripts: helmet aplica CSP). */
const paginaCallback = (titulo, detalle) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title></head>
<body>
  <h1>${titulo}</h1>
  <p>${detalle}</p>
  <p>Ya puedes cerrar esta pestaña y volver a la aplicación.</p>
</body>
</html>`;

// ── GET /ewelink/estado ───────────────────────────────────────
export const getEstado = async (req, res) => {
  try {
    const cuenta = await cuentaStore.leerCuenta();
    res.json({
      // Sin App ID/Secret en el servidor no hay nada que conectar.
      configurado: oauth.configCompleta(),
      // El driver de la sucursal que se está viendo.
      driver: dispositivos.nombreDriver({ sucursal: req.sucursal }),
      simulado: dispositivos.esSimulacion({ sucursal: req.sucursal }),
      conectada: cuentaStore.estaConectada(cuenta),
      cuenta: cuenta?.cuenta ?? null,
      region: cuenta?.region ?? null,
      at_expira_at: cuenta?.at_expira_at ?? null,
      rt_expira_at: cuenta?.rt_expira_at ?? null,
    });
  } catch (err) {
    console.error('ewelink getEstado error:', err);
    res.status(500).json({ message: 'No se pudo consultar la conexión con eWeLink. Intenta de nuevo.' });
  }
};

// ── POST /ewelink/conectar ────────────────────────────────────
/** Devuelve la URL (no redirige: la petición lleva el JWT en un header). */
export const conectar = async (req, res) => {
  try {
    if (!oauth.configCompleta()) {
      return res.status(400).json({
        message: 'Faltan las credenciales de eWeLink en el servidor, así que todavía no hay ' +
                 'nada a qué conectarse. Eso lo configura quien administra el sistema; no se ' +
                 'arregla desde la app.',
      });
    }
    const state = await cuentaStore.crearState();
    res.json({ url: oauth.urlAutorizacion(state), redirectUrl: oauth.cfg.redirectUrl });
  } catch (err) {
    console.error('ewelink conectar error:', err);
    res.status(500).json({ message: 'No se pudo conectar la cuenta de eWeLink. Intenta de nuevo.' });
  }
};

// ── GET /ewelink/callback ─────────────────────────────────────
/** Público: llega sin JWT; lo autentica el `state` de un solo uso. */
export const callback = async (req, res) => {
  const { code, region, state } = req.query;
  try {
    const valido = await cuentaStore.consumirState(state);
    if (!valido) {
      return res.status(400).send(
        paginaCallback(
          'No se pudo conectar',
          'La autorización no coincide con ninguna solicitud reciente, o pasó demasiado tiempo. Vuelve a la aplicación y presiona "Conectar cuenta de eWeLink" otra vez.'
        )
      );
    }
    if (!code) {
      return res.status(400).send(
        paginaCallback(
          'No se pudo conectar',
          'eWeLink no devolvió la autorización. Suele pasar cuando se cancela la pantalla de ' +
          'permisos: vuelve a la aplicación, presiona "Conectar cuenta de eWeLink" y acepta el permiso.'
        )
      );
    }

    const tokens = await oauth.canjearCode(code, region);
    const guardada = await cuentaStore.guardarTokens(tokens);
    resetDriver(); // el driver puede tener cacheado un token viejo

    res.send(
      paginaCallback(
        'Cuenta conectada',
        `La cuenta ${guardada.cuenta ?? 'de eWeLink'} quedó conectada. Ya puedes probar el enlace de cada máquina.`
      )
    );
  } catch (err) {
    console.error('ewelink callback error:', err);
    // El código de eWeLink va después de la explicación.
    res.status(502).send(
      paginaCallback(
        'No se pudo conectar',
        'eWeLink no aceptó la autorización. Vuelve a la aplicación y presiona ' +
        `"Conectar cuenta de eWeLink" otra vez; si vuelve a fallar, esto es lo que respondió: ${err.message}`
      )
    );
  }
};

// ── POST /ewelink/desconectar ─────────────────────────────────
export const desconectar = async (req, res) => {
  try {
    await cuentaStore.borrarCuenta();
    resetDriver();
    res.json({ message: 'Cuenta de eWeLink desconectada.' });
  } catch (err) {
    console.error('ewelink desconectar error:', err);
    res.status(500).json({ message: 'No se pudo desconectar la cuenta de eWeLink. Intenta de nuevo.' });
  }
};
