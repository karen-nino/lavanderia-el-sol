import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';
import { validarId } from '../middleware/validarId.js';
import {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  deleteCliente,
  deleteClientesMultiples,
} from '../controllers/clientes.controller.js';

const router = Router();

// Un id malformado responde 404 aquí, no 500 en Postgres.
router.param('id', validarId('el cliente'));

router.use(verifyToken, sucursalActiva);

router.get('/', getClientes);
router.get('/:id', getClienteById);
router.post('/', createCliente);
router.post('/eliminar-multiples', requireAdmin, deleteClientesMultiples);
router.patch('/:id', updateCliente);
router.delete('/:id', requireAdmin, deleteCliente);

export default router;
