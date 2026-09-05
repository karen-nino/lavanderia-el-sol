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
import { validarId } from '../middleware/validarId.js';

const router = Router();

// Un id malformado (/notas/undefined y parecidos) se responde aquí: sin esto
// llega a la consulta y Postgres lo convierte en un 500.
router.param('id', validarId('el empleado'));

router.use(verifyToken, sucursalActiva);

router.get('/',       getEmpleados);
router.get('/:id/desempeno', requireAdmin, getDesempeno);
// El personal es del negocio, no de la sucursal de pruebas: un admin de prueba
// no da de alta, edita ni desactiva empleados reales.
router.post('/',      requireAdmin, bloquearPruebaGlobal, createEmpleado);
router.patch('/:id',  requireAdmin, bloquearPruebaGlobal, updateEmpleado);
router.delete('/:id', requireAdmin, bloquearPruebaGlobal, deleteEmpleado);

export default router;
