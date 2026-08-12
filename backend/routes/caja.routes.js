import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin, requireAdminMain } from '../middleware/roles.js';
import {
  getCajaActual,
  abrirCaja,
  registrarMovimiento,
  cerrarCaja,
  getHistorial,
  eliminarCorte,
} from '../controllers/caja.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/actual', getCajaActual);
router.post('/abrir', abrirCaja);
router.post('/movimientos', registrarMovimiento);
router.post('/cerrar', cerrarCaja);
router.get('/historial', requireAdmin, getHistorial);
router.delete('/historial/:id', requireAdminMain, eliminarCorte);

export default router;
