import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { validarId } from '../middleware/validarId.js';
import {
  getNotas,
  getNotaById,
  getNextFolio,
  createNota,
  updateNota,
  eliminarNota,
  quitarCarga,
  cambiarEstadoNota,
  activarMaquinasPendientes,
  encenderMaquinaDeNota,
  asignarMaquina,
  asignarCargaMaquina,
  cambiarMaquina,
  asignarSecadora,
  terminarLavado,
  terminarLavadoFinal,
  terminarSecado,
  cambiarEstadoPago,
  corregirFormaPago,
  guardarTelefono,
  getNotaProductos,
  addProductoToNota,
  removeProductoFromNota,
} from '../controllers/notas.controller.js';

const router = Router();

// Un id malformado (/notas/undefined y parecidos) se responde aquí: sin esto
// llega a la consulta y Postgres lo convierte en un 500.
router.param('id', validarId('la nota'));
router.param('cargaId', validarId('la carga'));
router.param('productoId', validarId('el producto'));

router.use(verifyToken, sucursalActiva);

router.get('/',           getNotas);
router.get('/next-folio', getNextFolio);
router.post('/',          createNota);
router.get('/:id',        getNotaById);
router.patch('/:id', updateNota);
router.delete('/:id', eliminarNota);
// La máquina/carga agregada de más la quita quien se equivocó, sin esperar a
// un admin (2026-09-25). El controlador sigue siendo el que manda: solo se
// quitan las que nunca arrancaron y nunca la última de la nota.
router.delete('/:id/cargas/:cargaId', quitarCarga);
router.patch('/:id/estado',      cambiarEstadoNota);
// Paso previo a activar: da corriente sin arrancar el cronómetro (mig. 110).
router.patch('/:id/encender-maquina', encenderMaquinaDeNota);
router.patch('/:id/activar-pendientes', activarMaquinasPendientes);
router.patch('/:id/asignar-maquina', asignarMaquina);
router.patch('/:id/asignar-carga-maquina', asignarCargaMaquina);
router.patch('/:id/cambiar-maquina', cambiarMaquina);
router.patch('/:id/asignar-secadora', asignarSecadora);
router.patch('/:id/terminar-lavado', terminarLavado);
router.patch('/:id/terminar-lavado-final', terminarLavadoFinal);
router.patch('/:id/terminar-secado', terminarSecado);
router.patch('/:id/estado-pago', cambiarEstadoPago);
// Corregir la forma de pago de una nota ya cobrada es cosa de admin.
router.patch('/:id/forma-pago', requireAdmin, corregirFormaPago);
router.patch('/:id/telefono', guardarTelefono);
router.get('/:id/productos',    getNotaProductos);
router.post('/:id/productos',   addProductoToNota);
// Quitar un producto ya capturado en la nota es cosa de admin, igual que
// quitar una carga: deshace lo cobrado y devuelve stock.
router.delete('/:id/productos/:productoId', requireAdmin, removeProductoFromNota);

export default router;
