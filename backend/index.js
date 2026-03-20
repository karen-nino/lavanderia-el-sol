import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Routes
import authRoutes    from './routes/auth.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import maquinasRoutes from './routes/maquinas.routes.js';
import ordenesRoutes  from './routes/ordenes.routes.js';
import insumosRoutes   from './routes/insumos.routes.js';
import productosRoutes  from './routes/productos.routes.js';
import ventasRoutes    from './routes/ventas.routes.js';

app.use('/api/auth',      authRoutes);
app.use('/api/clientes',  clientesRoutes);
app.use('/api/maquinas',  maquinasRoutes);
app.use('/api/ordenes',   ordenesRoutes);
app.use('/api/insumos',   insumosRoutes);
app.use('/api/productos',  productosRoutes);
app.use('/api/ventas',    ventasRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Lavanderia El Sol API running' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
