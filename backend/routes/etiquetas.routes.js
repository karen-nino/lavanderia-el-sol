import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { tiposTela, tamanosEdredon, categoriasProducto, envasesProducto } from '../controllers/etiquetas.controller.js';

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

// Categorías de producto (Inventario)
router.get('/categorias-producto',      categoriasProducto.getAll);
router.post('/categorias-producto',     categoriasProducto.create);
router.put('/categorias-producto/:id',  categoriasProducto.update);

// Envases de producto (Inventario)
router.get('/envases-producto',      envasesProducto.getAll);
router.post('/envases-producto',     envasesProducto.create);
router.put('/envases-producto/:id',  envasesProducto.update);

export default router;
