import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { sucursalActiva, bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { getEstado, conectar, callback, desconectar, getLlamadas, getHistorialLlamadas } from '../controllers/ewelink.controller.js';

const router = Router();

// El callback va ANTES del verifyToken: quien llega es eWeLink redirigiendo el
// navegador del cliente, sin nuestro JWT. Lo protege el `state` de un solo uso.
router.get('/callback', callback);

// sucursalActiva: /estado responde si la sucursal que se ve usa los Sonoff reales.
router.use(verifyToken, requireAdmin, sucursalActiva);

router.get('/estado', getEstado);
router.get('/llamadas', getLlamadas);
router.get('/llamadas/historial', getHistorialLlamadas);
// Conectar y desconectar tocan la cuenta real del negocio, no la sucursal de
// pruebas: los usuarios de prueba quedan fuera.
router.post('/conectar', bloquearPruebaGlobal, conectar);
router.post('/desconectar', bloquearPruebaGlobal, desconectar);

export default router;
