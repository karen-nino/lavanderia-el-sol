# Lavanderia El Sol

Sistema de gestión para lavandería. Permite administrar clientes, pedidos, servicios y pagos desde una interfaz web moderna.

## Estructura del proyecto

```
lavanderia-el-sol/
├── frontend/    # React + Vite + Tailwind CSS
└── backend/     # Node.js + Express + PostgreSQL
```

## Tecnologías

**Frontend:** React, Vite, Tailwind CSS
**Backend:** Node.js, Express, PostgreSQL (pg), JWT, bcrypt

## Instalación

### Backend
```bash
cd backend
cp .env.example .env   # Configurar variables de entorno
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Variables de entorno (backend)

Ver `backend/.env.example` para la lista completa de variables requeridas.
