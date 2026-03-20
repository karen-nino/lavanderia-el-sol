import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { getProductos, createProducto, updateProducto, deleteProducto } from '../controllers/productos.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',        getProductos);
router.post('/',       createProducto);
router.put('/:id',     updateProducto);
router.delete('/:id',  deleteProducto);

export default router;
