import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { validarId } from '../middleware/validarId.js';
import {
  getProductos, createProducto, updateProducto, deleteProducto,
  deleteProductosMultiples, archivarProducto,
  rellenarBotellas, crearMovimiento, getMovimientos, getReporteDiario, getApartados,
} from '../controllers/productos.controller.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('el producto'));

router.use(verifyToken, sucursalActiva);

router.get('/',        getProductos);
// Reporte diario (entradas, salidas y existencia del día): admin y empleados.
router.get('/reporte-diario', getReporteDiario);
router.post('/',       createProducto);
router.post('/eliminar-multiples', requireAdmin, deleteProductosMultiples);
router.patch('/:id/archivar', requireAdmin, archivarProducto);
// Movimientos de stock (entrada/salida/rellenar): operativos, no requieren admin.
router.get('/:id/movimientos', getMovimientos);
// Notas abiertas que tienen apartado el producto.
router.get('/:id/apartados', getApartados);
router.post('/:id/movimiento', crearMovimiento);
router.post('/:id/rellenar',   rellenarBotellas);
router.put('/:id',     updateProducto);
router.delete('/:id',  requireAdmin, deleteProducto);

export default router;
