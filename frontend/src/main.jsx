import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Analytics } from '@vercel/analytics/react'
import { ajustarOrientacion } from './lib/orientacion'

// Vercel Web Analytics, solo en builds de Vercel (__EN_VERCEL__).
const EN_VERCEL = typeof __EN_VERCEL__ === 'boolean' && __EN_VERCEL__;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {EN_VERCEL && <Analytics />}
  </StrictMode>,
)

// Vertical en teléfonos, libre en tablets (solo en la app instalada).
ajustarOrientacion();

// Service worker (public/sw.js), solo en producción: en desarrollo serviría
// archivos guardados.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Que falle no rompe la app: solo se pierde la instalación.
      console.warn('No se pudo registrar el service worker:', err);
    });
  });
}
