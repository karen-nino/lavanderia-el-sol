import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getMaquinas,
  createMaquina,
  cambiarEstadoMaquina,
} from '../controllers/maquinas.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getMaquinas);
router.post('/', createMaquina);
router.patch('/:id/estado', cambiarEstadoMaquina);

export default router;
