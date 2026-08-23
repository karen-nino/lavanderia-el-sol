import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import {
  getProductos, createProducto, updateProducto, deleteProducto,
  deleteProductosMultiples, archivarProducto,
  rellenarBotellas, crearMovimiento, getMovimientos,
} from '../controllers/productos.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/',        getProductos);
router.post('/',       createProducto);
router.post('/eliminar-multiples', requireAdmin, deleteProductosMultiples);
router.patch('/:id/archivar', requireAdmin, archivarProducto);
// Movimientos de stock (entrada/salida/rellenar): operativos, no requieren admin.
router.get('/:id/movimientos', getMovimientos);
router.post('/:id/movimiento', crearMovimiento);
router.post('/:id/rellenar',   rellenarBotellas);
router.put('/:id',     updateProducto);
router.delete('/:id',  requireAdmin, deleteProducto);

export default router;
