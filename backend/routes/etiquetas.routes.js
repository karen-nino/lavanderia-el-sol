import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { bloquearPruebaGlobal } from '../middleware/sucursalActiva.js';
import {
  tiposTela, tamanosEdredon, marcasProducto, envasesProducto, marcasMaquina,
  granelesProducto, tamanosBolsa, tiposGranel,
  getModelosMaquina, crearModeloMaquina, actualizarModeloMaquina, reordenarModelosMaquina,
  getTiemposMarca, guardarTiempoMarca,
} from '../controllers/etiquetas.controller.js';

const router = Router();

router.use(verifyToken);

// Los catálogos de etiquetas son del negocio entero (no de una sucursal): los
// usuarios de prueba los consultan, pero no los modifican.
router.use((req, res, next) => (
  req.method === 'GET' ? next() : bloquearPruebaGlobal(req, res, next)
));

// Tipos de tela (para Ropa)
router.get('/tipos-tela',            tiposTela.getAll);
router.post('/tipos-tela',           tiposTela.create);
router.patch('/tipos-tela/reordenar', tiposTela.reorder);
router.put('/tipos-tela/:id',        tiposTela.update);

// Tamaños de edredón
router.get('/tamanos-edredon',            tamanosEdredon.getAll);
router.post('/tamanos-edredon',           tamanosEdredon.create);
router.patch('/tamanos-edredon/reordenar', tamanosEdredon.reorder);
router.put('/tamanos-edredon/:id',        tamanosEdredon.update);

// Marcas de producto (Inventario)
router.get('/marcas-producto',            marcasProducto.getAll);
router.post('/marcas-producto',           marcasProducto.create);
router.patch('/marcas-producto/reordenar', marcasProducto.reorder);
router.put('/marcas-producto/:id',        marcasProducto.update);

// Envases de producto (Inventario)
router.get('/envases-producto',            envasesProducto.getAll);
router.post('/envases-producto',           envasesProducto.create);
router.patch('/envases-producto/reordenar', envasesProducto.reorder);
router.put('/envases-producto/:id',        envasesProducto.update);

// Líquidos a granel (mig. 119): el nombre del producto cuando se rellena
// desde un bidón.
router.get('/graneles-producto',            granelesProducto.getAll);
router.post('/graneles-producto',           granelesProducto.create);
router.patch('/graneles-producto/reordenar', granelesProducto.reorder);
router.put('/graneles-producto/:id',        granelesProducto.update);

// Tipos de granel (mig. 133): Jabón, Suavizante…
router.get('/tipos-granel',            tiposGranel.getAll);
router.post('/tipos-granel',           tiposGranel.create);
router.patch('/tipos-granel/reordenar', tiposGranel.reorder);
router.put('/tipos-granel/:id',        tiposGranel.update);

// Tamaños de bolsa (mig. 119).
router.get('/tamanos-bolsa',            tamanosBolsa.getAll);
router.post('/tamanos-bolsa',           tamanosBolsa.create);
router.patch('/tamanos-bolsa/reordenar', tamanosBolsa.reorder);
router.put('/tamanos-bolsa/:id',        tamanosBolsa.update);

// Marcas de máquina (mig. 106): LG, Samsung, Speed Queen. Se eligen de la
// lista al dar de alta la máquina, y tanto ellas como sus modelos se
// administran en Ajustes → Máquinas.
router.get('/marcas-maquina',            marcasMaquina.getAll);
router.post('/marcas-maquina',           marcasMaquina.create);
router.patch('/marcas-maquina/reordenar', marcasMaquina.reorder);
router.put('/marcas-maquina/:id',        marcasMaquina.update);

// Modelos de máquina (mig. 117). Cuelgan de una marca, así que el listado se
// filtra por `?marca_id=` y el reordenar dice a qué marca pertenece la lista.
router.get('/modelos-maquina',            getModelosMaquina);
router.post('/modelos-maquina',           crearModeloMaquina);
router.patch('/modelos-maquina/reordenar', reordenarModelosMaquina);
router.put('/modelos-maquina/:id',        actualizarModeloMaquina);

// Tiempos de ciclo por marca y tamaño (mig. 107). No es un catálogo con la
// forma de los de arriba, así que va con sus propios handlers.
router.get('/tiempos-marca', getTiemposMarca);
router.put('/tiempos-marca', guardarTiempoMarca);

export default router;
