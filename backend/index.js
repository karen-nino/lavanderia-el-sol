import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Crear carpeta de uploads si no existe
if (!fs.existsSync('./uploads/logo')) {
  fs.mkdirSync('./uploads/logo', { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Routes
import authRoutes           from './routes/auth.routes.js';
import usuariosRoutes       from './routes/usuarios.routes.js';
import clientesRoutes       from './routes/clientes.routes.js';
import maquinasRoutes       from './routes/maquinas.routes.js';
import notasRoutes          from './routes/notas.routes.js';
import insumosRoutes        from './routes/insumos.routes.js';
import productosRoutes      from './routes/productos.routes.js';
import ventasRoutes         from './routes/ventas.routes.js';
import cajaRoutes           from './routes/caja.routes.js';
import ajustesRoutes        from './routes/ajustes.routes.js';

app.use('/api/auth',           authRoutes);
app.use('/api/usuarios',       usuariosRoutes);
app.use('/api/clientes',       clientesRoutes);
app.use('/api/maquinas',       maquinasRoutes);
app.use('/api/notas',          notasRoutes);
app.use('/api/insumos',        insumosRoutes);
app.use('/api/productos',      productosRoutes);
app.use('/api/ventas',         ventasRoutes);
app.use('/api/caja',           cajaRoutes);
app.use('/api/ajustes',        ajustesRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Lavanderia El Sol API running' });
});

// Barrido de cierre del día: libera máquinas que quedaron en uso.
import { iniciarCierreDelDia } from './jobs/cierreDelDia.js';

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  iniciarCierreDelDia();
});
