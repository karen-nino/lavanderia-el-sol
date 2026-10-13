import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { validarId } from '../middleware/validarId.js';
import {
  getInsumos,
  createInsumo,
  updateInsumo,
  putInsumo,
  eliminarInsumo,
  registrarMovimiento,
} from '../controllers/insumos.controller.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('el artículo'));

router.use(verifyToken, sucursalActiva);

router.get('/', getInsumos);
router.post('/', createInsumo);
router.patch('/:id', updateInsumo);
router.put('/:id', putInsumo);
router.delete('/:id', eliminarInsumo);
router.post('/:id/movimiento', registrarMovimiento);

export default router;
