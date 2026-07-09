import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { tiposTela, tamanosEdredon } from '../controllers/etiquetas.controller.js';

const router = Router();

router.use(verifyToken);

// Tipos de tela (para Ropa)
router.get('/tipos-tela',      tiposTela.getAll);
router.post('/tipos-tela',     tiposTela.create);
router.put('/tipos-tela/:id',  tiposTela.update);

// Tamaños de edredón
router.get('/tamanos-edredon',      tamanosEdredon.getAll);
router.post('/tamanos-edredon',     tamanosEdredon.create);
router.put('/tamanos-edredon/:id',  tamanosEdredon.update);

export default router;
