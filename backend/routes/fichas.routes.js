import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { sucursalActiva, bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import { getFichas, recoger, ajustar, getSucursalesFichas, setUsaFichas } from '../controllers/fichas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

// Inventario → Fichas: lo ven y lo recogen admin y empleados.
router.get('/', getFichas);
router.post('/recoger', recoger);
router.post('/ajustar', requireAdmin, ajustar);
// Ajustes → Operación → Fichas: qué sucursales llevan fichas.
router.get('/sucursales', requireAdmin, getSucursalesFichas);
router.patch('/sucursales/:slug', requireAdmin, bloquearPruebaGlobal, setUsaFichas);

export default router;
