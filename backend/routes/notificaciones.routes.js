import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { getNotificaciones } from '../controllers/notificaciones.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/', getNotificaciones);

export default router;
