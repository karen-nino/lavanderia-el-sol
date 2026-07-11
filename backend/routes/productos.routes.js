import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { getProductos, createProducto, updateProducto, deleteProducto } from '../controllers/productos.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/',        getProductos);
router.post('/',       createProducto);
router.put('/:id',     updateProducto);
router.delete('/:id',  requireAdmin, deleteProducto);

export default router;
