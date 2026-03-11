import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
} from '../controllers/clientes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getClientes);
router.get('/:id', getClienteById);
router.post('/', createCliente);
router.put('/:id', updateCliente);

export default router;
