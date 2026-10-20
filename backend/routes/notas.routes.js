import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { validarId } from '../middleware/validarId.js';
import { requiereCajaAbierta as conCaja } from '../middleware/cajaAbierta.js';
import {
  getNotas,
  getNotaById,
  getNextFolio,
  createNota,
  eliminarNota,
  quitarCarga,
  cambiarEstadoNota,
  activarMaquinasPendientes,
  encenderMaquinaDeNota,
  asignarMaquina,
  asignarCargaMaquina,
  cambiarMaquina,
  terminarLavado,
  terminarLavadoFinal,
  terminarSecado,
  cambiarEstadoPago,
  reabrirNota,
  ajustarNota,
  abonarNota,
  revertirAbono,
  corregirFormaPago,
  guardarTelefono, guardarReferencia,
  getNotaProductos,
  addProductoToNota,
  cambiarCantidadProducto,
  elegirGranelDeCarga,
  removeProductoFromNota,
} from '../controllers/notas.controller.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('la nota'));
router.param('cargaId', validarId('la carga'));
router.param('productoId', validarId('el producto'));
router.param('abonoId', validarId('el abono'));

router.use(verifyToken, sucursalActiva);

router.get('/',           getNotas);
router.get('/next-folio', getNextFolio);
router.post('/',          createNota);
router.get('/:id',        getNotaById);
router.delete('/:id', eliminarNota);
// Cualquiera quita una carga agregada de más (el controlador solo deja quitar
// las que nunca arrancaron, y nunca la última).
router.delete('/:id/cargas/:cargaId', conCaja, quitarCarga);
router.patch('/:id/estado',      cambiarEstadoNota);
// Deshacer la entrega: la nota finalizada vuelve a Por Entregar. Solo admin.
router.patch('/:id/reabrir', requireAdmin, reabrirNota);
// Paso previo a activar: da corriente sin arrancar el cronómetro.
router.patch('/:id/encender-maquina', conCaja, encenderMaquinaDeNota);
router.patch('/:id/activar-pendientes', conCaja, activarMaquinasPendientes);
router.patch('/:id/asignar-maquina', conCaja, asignarMaquina);
router.patch('/:id/asignar-carga-maquina', conCaja, asignarCargaMaquina);
router.patch('/:id/cambiar-maquina', conCaja, cambiarMaquina);
router.patch('/:id/terminar-lavado', terminarLavado);
router.patch('/:id/terminar-lavado-final', terminarLavadoFinal);
router.patch('/:id/terminar-secado', terminarSecado);
router.patch('/:id/estado-pago', cambiarEstadoPago);
// Abonos: los registra cualquiera; revertirlos es de admin.
router.post('/:id/abonos', abonarNota);
router.patch('/:id/abonos/:abonoId/revertir', requireAdmin, revertirAbono);
// Corregir la forma de pago de una nota ya cobrada es cosa de admin.
router.patch('/:id/forma-pago', requireAdmin, corregirFormaPago);
router.patch('/:id/telefono', guardarTelefono);
router.patch('/:id/referencia', guardarReferencia);
// Ajuste de la nota (descuento o cargo extra) desde Salidas.
router.patch('/:id/ajuste', ajustarNota);
router.get('/:id/productos',    getNotaProductos);
router.post('/:id/productos',   conCaja, addProductoToNota);
// Cambiar la cantidad la hace cualquiera; quitar el producto es de admin.
router.patch('/:id/productos/:productoId', conCaja, cambiarCantidadProducto);
// El granel de un servicio Por Encargo lo elige el empleado en Salidas.
router.put('/:id/cargas/:cargaId/granel/:tipoId', conCaja, elegirGranelDeCarga);
router.delete('/:id/productos/:productoId', requireAdmin, conCaja, removeProductoFromNota);

export default router;
