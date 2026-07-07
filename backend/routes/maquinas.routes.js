import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import {
  getMaquinas,
  createMaquina,
  updateMaquina,
  deleteMaquina,
  cambiarEstadoMaquina,
} from '../controllers/maquinas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/', getMaquinas);
router.post('/', createMaquina);
router.put('/:id', updateMaquina);
router.delete('/:id', deleteMaquina);
router.patch('/:id/estado', cambiarEstadoMaquina);

export default router;
