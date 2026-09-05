import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ajustarOrientacion } from './lib/orientacion'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Vertical en teléfonos, libre en tablets (ver lib/orientacion.js). Solo tiene
// efecto en la app instalada; en una pestaña no hace nada.
ajustarOrientacion();

// Service worker: lo que permite instalar la app desde el navegador (ver
// public/sw.js). Solo en el sitio publicado — en desarrollo estorbaría,
// sirviendo archivos guardados en vez de los que se acaban de editar.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Que falle no rompe la app: solo se pierde la instalación.
      console.warn('No se pudo registrar el service worker:', err);
    });
  });
}
