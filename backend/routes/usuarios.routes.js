import { Router } from 'express';
import {
  getEmpleados,
  createEmpleado,
  updateEmpleado,
  deleteEmpleado,
} from '../controllers/usuarios.controller.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

const requireAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  next();
};

router.get('/',       verifyToken, getEmpleados);
router.post('/',      verifyToken, requireAdmin, createEmpleado);
router.patch('/:id',  verifyToken, requireAdmin, updateEmpleado);
router.delete('/:id', verifyToken, requireAdmin, deleteEmpleado);

export default router;
