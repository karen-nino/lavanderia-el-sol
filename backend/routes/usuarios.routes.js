import { Router } from 'express';
import {
  getEmpleados,
  getDesempeno,
  createEmpleado,
  updateEmpleado,
  deleteEmpleado,
} from '../controllers/usuarios.controller.js';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/',       getEmpleados);
router.get('/:id/desempeno', requireAdmin, getDesempeno);
router.post('/',      requireAdmin, createEmpleado);
router.patch('/:id',  requireAdmin, updateEmpleado);
router.delete('/:id', requireAdmin, deleteEmpleado);

export default router;
