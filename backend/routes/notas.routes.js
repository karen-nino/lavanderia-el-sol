import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import {
  getNotas,
  getNotaById,
  getNextFolio,
  createNota,
  updateNota,
  eliminarNota,
  cambiarEstadoNota,
  activarNota,
  activarMaquinasPendientes,
  asignarSecadora,
  cambiarEstadoPago,
  getNotaProductos,
  addProductoToNota,
  removeProductoFromNota,
} from '../controllers/notas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/',           getNotas);
router.get('/next-folio', getNextFolio);
router.post('/',          createNota);
router.get('/:id',        getNotaById);
router.patch('/:id', updateNota);
router.delete('/:id', eliminarNota);
router.patch('/:id/estado',      cambiarEstadoNota);
router.patch('/:id/activar',     activarNota);
router.patch('/:id/activar-pendientes', activarMaquinasPendientes);
router.patch('/:id/asignar-secadora', asignarSecadora);
router.patch('/:id/estado-pago', cambiarEstadoPago);
router.get('/:id/productos',    getNotaProductos);
router.post('/:id/productos',   addProductoToNota);
router.delete('/:id/productos/:productoId', removeProductoFromNota);

export default router;
