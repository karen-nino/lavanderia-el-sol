import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Ordenes from './pages/Ordenes';
import NuevaOrden from './pages/NuevaOrden';
import Clientes from './pages/Clientes';
import Maquinas from './pages/Maquinas';
import Insumos from './pages/Insumos';
import DetalleOrden from './pages/DetalleOrden';
import Salidas from './pages/Salidas';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="ordenes" element={<Ordenes />} />
            <Route path="ordenes/nueva" element={<NuevaOrden />} />
            <Route path="ordenes/:id" element={<DetalleOrden />} />
            <Route path="ordenes/:id/salidas" element={<Salidas />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="maquinas" element={<Maquinas />} />
            <Route path="insumos" element={<Insumos />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
