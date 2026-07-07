import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import {
  getCajaActual,
  abrirCaja,
  registrarMovimiento,
  cerrarCaja,
  getHistorial,
} from '../controllers/caja.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/actual', getCajaActual);
router.post('/abrir', abrirCaja);
router.post('/movimientos', registrarMovimiento);
router.post('/cerrar', cerrarCaja);
router.get('/historial', getHistorial);

export default router;
