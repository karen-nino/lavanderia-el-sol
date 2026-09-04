import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
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
} from '../controllers/maquinas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/', getMaquinas);
router.get('/:id/uso', requireAdmin, getUsoMaquina);
router.post('/', createMaquina);
router.put('/:id', updateMaquina);
router.delete('/:id', requireAdmin, deleteMaquina);
router.patch('/:id/estado', cambiarEstadoMaquina);
router.patch('/:id/detener-ciclo', detenerCiclo);
router.post('/:id/probar-sonoff', requireAdmin, probarSonoff);
router.post('/:id/apagar-sonoff', requireAdmin, apagarSonoff);
router.post('/:id/encender-sonoff', requireAdmin, encenderSonoff);

export default router;
