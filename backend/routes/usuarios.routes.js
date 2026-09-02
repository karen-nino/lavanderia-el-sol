import { Router } from 'express';
import {
  getEmpleados,
  getDesempeno,
  createEmpleado,
  updateEmpleado,
  deleteEmpleado,
} from '../controllers/usuarios.controller.js';
import { verifyToken } from '../middleware/auth.js';
import { sucursalActiva, bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { requireAdmin } from '../middleware/roles.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

router.get('/',       getEmpleados);
router.get('/:id/desempeno', requireAdmin, getDesempeno);
// El personal es del negocio, no de la sucursal de pruebas: un admin de prueba
// no da de alta, edita ni desactiva empleados reales.
router.post('/',      requireAdmin, bloquearPruebaGlobal, createEmpleado);
router.patch('/:id',  requireAdmin, bloquearPruebaGlobal, updateEmpleado);
router.delete('/:id', requireAdmin, bloquearPruebaGlobal, deleteEmpleado);

export default router;
