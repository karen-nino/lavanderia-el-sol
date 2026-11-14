import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { sucursalActiva, bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import {
  getFichas, getHistorialFichas, recoger, ajustar, getSucursalesFichas, setUsaFichas,
  crearTipo, editarTipo, quitarTipo, setTipoMaquina,
} from '../controllers/fichas.controller.js';

const router = Router();

router.use(verifyToken, sucursalActiva);

// Inventario → Fichas: lo ven y lo recogen admin y empleados.
router.get('/', getFichas);
router.get('/historial', getHistorialFichas);
router.post('/recoger', recoger);
router.post('/ajustar', requireAdmin, ajustar);
// Ajustes → Operación → Fichas: qué sucursales llevan fichas.
router.get('/sucursales', requireAdmin, getSucursalesFichas);
router.patch('/sucursales/:slug', requireAdmin, bloquearPruebaGlobal, setUsaFichas);
// Tipos de ficha (mig. 179) y el de cada máquina.
router.post('/sucursales/:slug/tipos', requireAdmin, bloquearPruebaGlobal, crearTipo);
router.patch('/tipos/:id', requireAdmin, bloquearPruebaGlobal, editarTipo);
router.delete('/tipos/:id', requireAdmin, bloquearPruebaGlobal, quitarTipo);
router.patch('/maquinas/:id', requireAdmin, bloquearPruebaGlobal, setTipoMaquina);

export default router;
