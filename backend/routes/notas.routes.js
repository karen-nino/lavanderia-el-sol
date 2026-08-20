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
  activarMaquinasPendientes,
  asignarMaquina,
  asignarCargaMaquina,
  cambiarMaquina,
  quitarMaquina,
  asignarSecadora,
  terminarLavado,
  terminarLavadoFinal,
  terminarSecado,
  cambiarEstadoPago,
  guardarTelefono,
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
router.patch('/:id/activar-pendientes', activarMaquinasPendientes);
router.patch('/:id/asignar-maquina', asignarMaquina);
router.patch('/:id/asignar-carga-maquina', asignarCargaMaquina);
router.patch('/:id/cambiar-maquina', cambiarMaquina);
router.patch('/:id/quitar-maquina', quitarMaquina);
router.patch('/:id/asignar-secadora', asignarSecadora);
router.patch('/:id/terminar-lavado', terminarLavado);
router.patch('/:id/terminar-lavado-final', terminarLavadoFinal);
router.patch('/:id/terminar-secado', terminarSecado);
router.patch('/:id/estado-pago', cambiarEstadoPago);
router.patch('/:id/telefono', guardarTelefono);
router.get('/:id/productos',    getNotaProductos);
router.post('/:id/productos',   addProductoToNota);
router.delete('/:id/productos/:productoId', removeProductoFromNota);

export default router;
