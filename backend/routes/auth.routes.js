import { Router } from 'express';
import { login, getMe, updateMe, buscarUsuarios } from '../controllers/auth.controller.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

router.post('/login',          login);
router.get('/buscar-usuarios', buscarUsuarios);
router.get('/me',              verifyToken, getMe);
router.patch('/me',            verifyToken, updateMe);

export default router;
