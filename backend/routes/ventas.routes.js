import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { getResumen } from '../controllers/ventas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/resumen', getResumen);

export default router;
