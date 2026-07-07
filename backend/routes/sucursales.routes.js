import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { getSucursales } from '../controllers/sucursales.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', getSucursales);

export default router;
