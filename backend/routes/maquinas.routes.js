import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { validarId } from '../middleware/validarId.js';
import {
  getMaquinas,
  getUsoMaquina,
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
  revisarSonoff,
} from '../controllers/maquinas.controller.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('la máquina'));

router.use(verifyToken, sucursalActiva);

router.get('/', getMaquinas);
// Antes de las rutas con :id (si no, 'revisar-sonoff' se tomaría por un id).
router.post('/revisar-sonoff', revisarSonoff);
router.get('/:id/uso', requireAdmin, getUsoMaquina);
router.post('/', createMaquina);
router.put('/:id', updateMaquina);
router.delete('/:id', requireAdmin, deleteMaquina);
router.patch('/:id/estado', cambiarEstadoMaquina);
router.patch('/:id/detener-ciclo', detenerCiclo);
// Sin requireAdmin: el segundo ciclo lo da el empleado del mostrador.
router.patch('/:id/otro-ciclo', otroCiclo);
// "Otro ciclo" de la secadora de fichas que pregunta su programa.
router.patch('/:id/mas-tiempo', masTiempo);
router.post('/:id/probar-sonoff', requireAdmin, probarSonoff);
router.post('/:id/apagar-sonoff', requireAdmin, apagarSonoff);
router.post('/:id/encender-sonoff', requireAdmin, encenderSonoff);

export default router;
