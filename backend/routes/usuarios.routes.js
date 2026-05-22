import { Router } from 'express';
import {
  getEmpleados,
  createEmpleado,
  updateEmpleado,
  deleteEmpleado,
} from '../controllers/usuarios.controller.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';

const router = Router();

router.get('/',       verifyToken, getEmpleados);
router.post('/',      verifyToken, requireAdmin, createEmpleado);
router.patch('/:id',  verifyToken, requireAdmin, updateEmpleado);
router.delete('/:id', verifyToken, requireAdmin, deleteEmpleado);

export default router;
