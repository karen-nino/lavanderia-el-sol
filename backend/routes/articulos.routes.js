import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { getArticulos, createArticulo, updateArticulo } from '../controllers/articulos.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',     getArticulos);
router.post('/',    createArticulo);
router.put('/:id',  updateArticulo);

export default router;
