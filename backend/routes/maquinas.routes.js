import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { validarId } from '../middleware/validarId.js';
import { requiereCajaAbierta as conCaja } from '../middleware/cajaAbierta.js';
import {
  getMaquinas,
  getUsoMaquina,
  getReporteDiarioMaquinas,
  createMaquina,
  updateMaquina,
  deleteMaquina,
  cambiarEstadoMaquina,
  detenerCiclo,
  probarSonoff,
  apagarSonoff,
  encenderSonoff,
  otroCiclo,
  masTiempo,
  otraFicha,
  revisarSonoff,
} from '../controllers/maquinas.controller.js';
import { liberarMaquinaReservada } from '../controllers/notas.controller.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('la máquina'));

router.use(verifyToken, sucursalActiva);

router.get('/', getMaquinas);
// Reporte diario de máquinas (uso y lo generado del día): admin y empleados.
router.get('/reporte-diario', getReporteDiarioMaquinas);
// Antes de las rutas con :id (si no, 'revisar-sonoff' se tomaría por un id).
router.post('/revisar-sonoff', revisarSonoff);
router.get('/:id/uso', requireAdmin, getUsoMaquina);
// Dar de alta y editar es de admin (la pantalla solo se lo enseña a ellos).
router.post('/', requireAdmin, createMaquina);
router.put('/:id', requireAdmin, updateMaquina);
router.delete('/:id', requireAdmin, deleteMaquina);
router.patch('/:id/estado', cambiarEstadoMaquina);
// Admin: suelta una máquina reservada que su nota nunca arrancó (sin caja: no toca dinero).
router.patch('/:id/liberar', requireAdmin, liberarMaquinaReservada);
router.patch('/:id/detener-ciclo', detenerCiclo);
// Sin requireAdmin: el segundo ciclo lo da el empleado del mostrador.
router.patch('/:id/otro-ciclo', conCaja, otroCiclo);
// "Otro ciclo" de la secadora de fichas que pregunta su programa.
router.patch('/:id/mas-tiempo', conCaja, masTiempo);
// Secadora de fichas (Sec49): una ficha más (+sus minutos) desde que corre, sin tope.
router.patch('/:id/otra-ficha', conCaja, otraFicha);
router.post('/:id/probar-sonoff', requireAdmin, probarSonoff);
router.post('/:id/apagar-sonoff', requireAdmin, apagarSonoff);
router.post('/:id/encender-sonoff', requireAdmin, encenderSonoff);

export default router;
