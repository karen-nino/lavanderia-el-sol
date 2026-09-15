import { Router } from 'express';
import { login, logout, getMe, updateMe, buscarUsuarios, demoLogin } from '../controllers/auth.controller.js';
import { verifyToken } from '../middleware/auth.js';
import { loginLimiter, busquedaLimiter, busquedaLimiterHora } from '../middleware/rateLimit.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';

const router = Router();

router.post('/login',          loginLimiter, login);

// Solo en la demo pública: fuera de ella la ruta no existe (404 de Express).
if (ENTORNO_DEMO) router.post('/demo-login', loginLimiter, demoLogin);

router.get('/buscar-usuarios', busquedaLimiterHora, busquedaLimiter, buscarUsuarios);
router.post('/logout',         verifyToken, logout);
router.get('/me',              verifyToken, getMe);
router.patch('/me',            verifyToken, updateMe);

export default router;
