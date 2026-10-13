import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { getNotificaciones, descartarNotificacion, descartarTodas } from '../controllers/notificaciones.controller.js';
import { validarId } from '../middleware/validarId.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('el aviso'));

router.use(verifyToken, sucursalActiva);

router.get('/', getNotificaciones);
router.post('/descartar-todas', descartarTodas);
router.post('/:id/descartar', descartarNotificacion);

export default router;
