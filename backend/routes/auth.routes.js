import { Router } from 'express';
import { login, getMe, updateMe, buscarUsuarios } from '../controllers/auth.controller.js';
import { verifyToken } from '../middleware/auth.js';
import { loginLimiter, busquedaLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/login',          loginLimiter, login);
router.get('/buscar-usuarios', busquedaLimiter, buscarUsuarios);
router.get('/me',              verifyToken, getMe);
router.patch('/me',            verifyToken, updateMe);

export default router;
