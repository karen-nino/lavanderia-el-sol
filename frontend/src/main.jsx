import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Analytics } from '@vercel/analytics/react'
import { ajustarOrientacion } from './lib/orientacion'

// Vercel Web Analytics (2026-10-08): visitas de la demo publicada en Vercel.
// Solo en los builds de Vercel (ver __EN_VERCEL__ en vite.config.js); en
// Netlify y en desarrollo no se monta.
const EN_VERCEL = typeof __EN_VERCEL__ === 'boolean' && __EN_VERCEL__;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {EN_VERCEL && <Analytics />}
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
