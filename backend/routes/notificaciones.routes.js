import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { getNotificaciones, descartarNotificacion, descartarTodas } from '../controllers/notificaciones.controller.js';
import { validarId } from '../middleware/validarId.js';

const router = Router();

// Un id malformado (/notas/undefined y parecidos) se responde aquí: sin esto
// llega a la consulta y Postgres lo convierte en un 500.
router.param('id', validarId('el aviso'));

router.use(verifyToken, sucursalActiva);

router.get('/', getNotificaciones);
router.post('/descartar-todas', descartarTodas);
router.post('/:id/descartar', descartarNotificacion);

export default router;
