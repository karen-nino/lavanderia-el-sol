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
  reabrirNota,
  ajustarNota,
  abonarNota,
  revertirAbono,
  corregirFormaPago,
  guardarTelefono,
  getNotaProductos,
  addProductoToNota,
  cambiarCantidadProducto,
  elegirGranelDeCarga,
  removeProductoFromNota,
} from '../controllers/notas.controller.js';

const router = Router();

// Un id malformado (/notas/undefined y parecidos) se responde aquí: sin esto
// llega a la consulta y Postgres lo convierte en un 500.
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
// La máquina/carga agregada de más la quita quien se equivocó, sin esperar a
// un admin (2026-09-25). El controlador sigue siendo el que manda: solo se
// quitan las que nunca arrancaron y nunca la última de la nota.
router.delete('/:id/cargas/:cargaId', quitarCarga);
router.patch('/:id/estado',      cambiarEstadoNota);
// Deshacer la entrega: la nota finalizada vuelve a Por Entregar. Solo admin.
router.patch('/:id/reabrir', requireAdmin, reabrirNota);
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
// Abonos (mig. 121): un pago parcial lo registra cualquiera que atienda el
// mostrador; revertirlo es de admin, como revertir un cobro.
router.post('/:id/abonos', abonarNota);
router.patch('/:id/abonos/:abonoId/revertir', requireAdmin, revertirAbono);
// Corregir la forma de pago de una nota ya cobrada es cosa de admin.
router.patch('/:id/forma-pago', requireAdmin, corregirFormaPago);
router.patch('/:id/telefono', guardarTelefono);
// Ajuste de la nota (descuento o cargo extra) desde Salidas.
router.patch('/:id/ajuste', ajustarNota);
router.get('/:id/productos',    getNotaProductos);
router.post('/:id/productos',   addProductoToNota);
// Quitar un producto ya capturado en la nota es cosa de admin, igual que
// quitar una carga: deshace lo cobrado y devuelve stock.
// Cambiar la cantidad NO es de admin: es el mismo gesto que agregar, que
// cualquiera puede hacer. Borrar el renglón sí, porque deshace la captura.
router.patch('/:id/productos/:productoId', cambiarCantidadProducto);
// El granel de un servicio Por Encargo (Jabón, Suavizante…): lo elige el
// empleado en Salidas, igual que agrega productos (migs. 133 y 134).
router.put('/:id/cargas/:cargaId/granel/:tipoId', elegirGranelDeCarga);
router.delete('/:id/productos/:productoId', requireAdmin, removeProductoFromNota);

export default router;
