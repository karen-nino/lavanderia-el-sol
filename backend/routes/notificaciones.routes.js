import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { getNotificaciones, descartarNotificacion, descartarTodas } from '../controllers/notificaciones.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/', getNotificaciones);
router.post('/descartar-todas', descartarTodas);
router.post('/:id/descartar', descartarNotificacion);

export default router;
