import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
} from '../controllers/clientes.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getClientes);
router.get('/:id', getClienteById);
router.post('/', createCliente);
router.patch('/:id', updateCliente);
router.delete('/:id', deleteCliente);

export default router;
