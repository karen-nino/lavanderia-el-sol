import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, mensajeDeError } from '../lib/api';
import InstalarApp from '../components/InstalarApp';
import { useInstalacion } from '../lib/useInstalacion';
import { formatTelefono } from '../lib/telefono';
import { useAuth } from '../context/AuthContext';
import { esAdminMain as esAdminMainFn } from '../lib/roles';
import { ES_DEMO } from '../lib/entorno';
import { almacenSesion } from '../lib/sesion';
import { COMODINES_WHATSAPP, armarMensajeWhatsapp } from '../lib/mensajeWhatsapp';
import Selector from '../components/Selector';

// El nombre del negocio y el logo se quedan fuera de la DEMO: son de la
// configuración global, los comparten todos los visitantes a la vez y se quedan
// puestos hasta el reset de las 03:00. El backend los cierra por su cuenta
// (controllers/ajustes.controller.js), esto es solo no ofrecerlos.
const NOTA_DEMO = 'En la demostración este dato no se cambia.';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const MOBILE_INPUT_CLS =
  'w-full px-4 py-3.5 border border-grey/30 rounded-lg text-base text-dark-blue placeholder-grey/60 focus:outline-none focus:border-blue transition';

// Botones +/- de los campos numéricos (mismo estilo que el paso de cargas en
// autoservicio), en tamaño desktop y móvil.
const STEP_BTN_CLS =
  'flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 text-lg font-semibold leading-none hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const STEP_BTN_CLS_M =
  'flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full border border-grey/30 bg-white text-dark-blue text-xl font-semibold leading-none hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

const ROL_LABEL = { admin_main: 'Admin Main', admin: 'Admin', operador: 'Empleado' };

const SectionIcon = {
  perfil: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  negocio: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6v6H9z" />
    </svg>
  ),
  // Signo de dólar (sin círculo), para "Cargas y Precios". viewBox acercado al
  // glifo para que se vea más grande, con el trazo ajustado a ese acercamiento.
  cargas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="5.5 5.5 13 13">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.1}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
    </svg>
  ),
  // Lavadora, igual que el icono de "Máquinas" del nav inferior.
  maquinas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth={2} />
      <circle cx="12" cy="13" r="4" strokeWidth={2} />
      <circle cx="8"  cy="6.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  alertas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  // Dos etiquetas (Lucide "tags"), acorde con "Etiquetas de encargo" (plural).
  etiquetas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9.01V9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19" />
    </svg>
  ),
  // Recibo con la esquina recortada (Lucide "receipt").
  ticket: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5 4 2Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  // Globo de mensaje con un teléfono dentro: el WhatsApp de la app es un
  // mensaje que sale del mostrador, no la marca (no se usa su logotipo).
  whatsapp: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.7 8.7 0 0 1-3.9-.9L3 21l1.9-5.6A8.7 8.7 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9.5h6M9 13h4" />
    </svg>
  ),
  manual: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 6.5C10.5 5.2 8.6 4.7 6 4.8A1 1 0 005 5.8v11.4a1 1 0 001.06 1c2.5-.1 4.4.4 5.94 1.7 1.54-1.3 3.44-1.8 5.94-1.7a1 1 0 001.06-1V5.8a1 1 0 00-1-1c-2.6-.1-4.5.4-6 1.7z" />
      <path strokeLinecap="round" strokeWidth={2} d="M12 6.5V19" />
    </svg>
  ),
  instalar: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </svg>
  ),
  // Caja de inventario (Lucide "package").
  inventario: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  ),
  gear: (
    <svg className="w-7 h-7 text-grey" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  back: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 19l-7-7 7-7" />
    </svg>
  ),
  imagePlaceholder: (
    <svg className="w-8 h-8 text-grey/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  eye: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  eyeOff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
    </svg>
  ),
};

// Cómo se va a ver el mensaje. Se enseña con una nota de ejemplo porque la
// regla de los asteriscos no se entiende leyéndola: se entiende viendo que
// *Nombre* se convierte en un nombre y que *ya está* se queda en negritas.
const NOTA_EJEMPLO = {
  cliente_nombre: 'Ana López',
  created_at: '2026-09-26T14:30:00',
  folio: '1796-260926',
};

function PreviaWhatsapp({ plantilla }) {
  const texto = armarMensajeWhatsapp(plantilla, NOTA_EJEMPLO);
  if (!texto.trim()) return null;
  return (
    <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
      <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">
        Así le llegaría a Ana López
      </p>
      <p className="mt-1.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{texto}</p>
    </div>
  );
}

const MOBILE_SECTIONS = [
  { id: 'perfil',  label: 'Mi Perfil',                 subtitle: 'Información de perfil',    icon: SectionIcon.perfil  },
  { id: 'negocio', label: 'Negocio y Sucursales',      subtitle: 'Información de sucursales', icon: SectionIcon.negocio },
  { id: 'maquinas', label: 'Máquinas',                  subtitle: 'Detalles de máquinas',      icon: SectionIcon.maquinas },
  { id: 'cargas',   label: 'Servicios Por Encargo',      subtitle: 'Precio de cada servicio',   icon: SectionIcon.cargas },
  { id: 'alertas', label: 'Alertas y Notificaciones',  subtitle: 'Ajustes de alertas', icon: SectionIcon.alertas },
  { id: 'etiquetas', label: 'Etiquetas de encargo',    subtitle: 'Tipos de tela y tamaños de edredón', icon: SectionIcon.etiquetas },
  { id: 'inventario', label: 'Inventario',              subtitle: 'Marcas y envases de productos', icon: SectionIcon.inventario },
  { id: 'ticket',   label: 'Ticket',                   subtitle: 'Notas al pie del ticket', icon: SectionIcon.ticket },
  { id: 'whatsapp', label: 'WhatsApp',                 subtitle: 'Mensaje para Por Encargo', icon: SectionIcon.whatsapp },
];

// Los servicios fijos que vende Por Encargo, con el campo de Ajustes que lleva
// su precio. Las columnas siguen llamándose `tope_carga_*` porque nacieron como
// topes (mig. 050 y 052), pero desde el rediseño del alta de Por Encargo ese
// número ES el precio del servicio, no un máximo.
// Jumbo no está: el tamaño dejó de venderse y su columna solo sobrevive para
// las notas viejas que lo eligieron. El Edredón tampoco: se cobra según su
// tamaño (mig. 130) y esos precios salen del catálogo de tamaños de edredón.
// Cada servicio dice además cuántas medidas de cada granel ligado y cuántas
// bolsas trae puestas (mig. 132): [precio, nombre, texto, medidas, bolsas].
// Claves con que los datos de un tamaño de edredón entran a `config`.
const claveEdredon         = (e) => `edredon_precio_${e.id}`;
const claveEdredonMedidas  = (e) => `edredon_medidas_${e.id}`;
const claveEdredonBolsas   = (e) => `edredon_bolsas_${e.id}`;
// Lo que se guarda de un tamaño de edredón, con la clave que usa en `config`.
const camposEdredon = (e) => [
  [claveEdredon(e),        'precio',           e.precio ?? ''],
  [claveEdredonMedidas(e), 'precarga_medidas', e.precarga_medidas ?? 0],
  [claveEdredonBolsas(e),  'precarga_bolsas',  e.precarga_bolsas ?? 0],
];

const PRECIOS_SERVICIO = [
  ['tope_carga_chico',   'Servicio Chico',   'chico',   'precarga_medidas_chico',   'precarga_bolsas_chico'],
  ['tope_carga_mediano', 'Servicio Mediano', 'mediano', 'precarga_medidas_mediano', 'precarga_bolsas_mediano'],
  ['tope_carga_grande',  'Servicio Grande',  'grande',  'precarga_medidas_grande',  'precarga_bolsas_grande'],
];
// Campos de precarga de los servicios fijos, para el payload de /ajustes.
const CAMPOS_PRECARGA = PRECIOS_SERVICIO.flatMap(([, , , m, b]) => [m, b]);

// El manual no es configuración: abre su propia página (/manual). Se ofrece
// aparte de MOBILE_SECTIONS porque no tiene formulario que guardar y porque en
// escritorio no es una sección más, sino un botón que lleva a la página.
const SECCION_MANUAL = {
  id: 'manual', label: 'Manual de uso', subtitle: 'Cómo funciona la aplicación',
  icon: SectionIcon.manual,
};

// Instalar la app no es configuración del negocio, sino una acción del equipo
// que se está usando: se ofrece aparte de MOBILE_SECTIONS porque aparece
// también en el entorno de pruebas, y solo si el navegador la admite.
const SECCION_INSTALAR = {
  id: 'instalar', label: 'Instalar la app', subtitle: 'Tenerla en la pantalla de inicio',
  icon: SectionIcon.instalar,
};

// Secciones que no guardan nada: su contenido se administra solo.
const SECCIONES_SIN_GUARDAR = ['etiquetas', 'inventario', 'instalar'];

// Encabezado de un grupo de campos dentro de una sección. Va por encima de las
// etiquetas de campo (que son bold), porque antes se perdía entre ellas: iba en
// 12 px gris mientras cada campo pesaba más que el título de su propio grupo.
function TituloGrupo({ children }) {
  return <p className="text-sm font-bold text-dark-blue">{children}</p>;
}

// La escala de móvil es mayor (título de pantalla 20 px, etiqueta 16 px bold),
// así que ahí el encabezado de grupo va en 18 px.
function TituloGrupoMobile({ children }) {
  return <p className="text-lg font-bold text-dark-blue">{children}</p>;
}

// Tarjeta de móvil equivalente a Section: el encabezado con fondo separa el
// grupo de sus campos por estructura, no por tamaño de letra (las etiquetas de
// campo en móvil ya son de 16 px bold).
function TarjetaMobile({ titulo, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {titulo && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-base font-bold text-dark-blue">{titulo}</p>
        </div>
      )}
      <div className="px-4 py-5 space-y-5">{children}</div>
    </div>
  );
}

function Section({ titulo, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-base font-bold text-dark-blue">{titulo}</h2>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function MobileField({ label, children, hint }) {
  return (
    <div className="space-y-2">
      <label className="block text-base font-bold text-dark-blue">{label}</label>
      {children}
      {hint && <p className="text-xs text-grey">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Fila con etiqueta + descripción a la izquierda y el toggle a la derecha.
function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function MobileSectionButton({ label, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-5 bg-white rounded-card text-left shadow-sm"
    >
      <span className="text-blue flex items-center justify-center flex-shrink-0">{icon}</span>
      <span className="text-base font-medium text-dark-blue">{label}</span>
    </button>
  );
}

// Catálogo editable de etiquetas internas (tipos de tela, tamaños de edredón).
// Cada cambio se guarda de inmediato contra su endpoint; no depende del botón
// "Guardar" general de Ajustes. Las etiquetas se desactivan (no se borran) para
// que las notas viejas conserven su valor.
// `extra` son los campos fijos de un catálogo que cuelga de otro: los modelos
// de máquina cuelgan de su marca (mig. 117), así que `{ marca_id }` filtra el
// listado y viaja en el alta y en el reordenar.
// `extraCampos` son los campos que lleva cada renglón además del nombre (el
// modelo dice si es lavadora o secadora y de qué tamaño): se describen como
// { name, defecto, opciones: [{ v, label }] } para un desplegable, o con
// `tipo: 'check'` y `label` para un sí/no. Un sí/no con `excluye` apaga ese
// otro campo al marcarse (dos casillas que no pueden ir juntas).
// `onCambio` avisa la lista fresca a quien envuelve el catálogo (lo usa el
// desplegable de marcas, que tiene que enterarse de las que se agregan aquí).
// Tiene que ser estable (useCallback): entra en las dependencias de la carga.
// `soloConsulta` deja la lista a la vista sin alta, edición, desactivar ni
// arrastre: es lo que ven los usuarios de prueba, a quienes el backend no les
// deja cambiar los catálogos (son del negocio entero).
function CatalogoEtiquetas({
  endpoint, singular, inputCls, onMensaje,
  extra = null, extraCampos = [], vacioTexto = 'Aún no hay etiquetas.', onCambio,
  soloConsulta = false,
}) {
  const [items,      setItems]      = useState([]);
  const [nuevo,      setNuevo]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [confirmar,  setConfirmar]  = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [editNombre, setEditNombre] = useState('');
  const [savedId,    setSavedId]    = useState(null);

  // Los desplegables extra, tanto los del alta como los del renglón que se
  // edita. Arrancan en su valor por defecto para que el alta nunca quede a
  // medias: son datos obligatorios con un caso común claro.
  const porDefecto = () => Object.fromEntries(extraCampos.map(c => [c.name, c.defecto]));
  const [nuevoExtra, setNuevoExtra] = useState(porDefecto);
  const [editExtra,  setEditExtra]  = useState({});
  const conCambio = (prev, campo, v) => ({
    ...prev, [campo.name]: v, ...(campo.excluye && v ? { [campo.excluye]: false } : {}),
  });

  // En el subtítulo del renglón un sí/no se resume (`chip`); la frase larga es
  // para la casilla, que es donde hay que entender qué se está marcando.
  const etiquetaDe = (campo, valor) => (
    campo.tipo === 'check'
      ? (valor ? (campo.chip ?? campo.label) : null)
      : (campo.opciones.find(o => String(o.v) === String(valor))?.label ?? valor)
  );

  // Un campo extra, igual en el alta que en la edición del renglón.
  const campoExtra = (campo, valor, alCambiar) => (campo.tipo === 'check' ? (
    <label key={campo.name} className="flex items-center gap-2 text-sm text-gray-600 basis-full">
      <input
        type="checkbox" checked={!!valor}
        onChange={(e) => alCambiar(e.target.checked)}
        className="w-4 h-4 accent-blue"
      />
      {campo.label}
    </label>
  ) : (
    <div key={campo.name} className="flex-1 min-w-0">
      <Selector
        claseCampo={inputCls}
        valor={valor ?? campo.defecto}
        onChange={alCambiar}
        titulo={campo.label}
        etiquetaAria={campo.label}
        opciones={campo.opciones.map(o => ({ valor: o.v, etiqueta: o.label }))}
      />
    </div>
  ));

  // Los campos fijos viajan como filtro en el listado y en el cuerpo del resto.
  const extraQs = extra ? `?${new URLSearchParams(extra)}` : '';

  // Reordenamiento con Pointer Events: funciona igual con mouse (desktop) y con
  // el dedo (touch/móvil), a diferencia del arrastre nativo del navegador.
  const listRef      = useRef(null);
  const dragIdRef    = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  useEffect(() => {
    api.get(`${endpoint}${extraQs}`)
      .then(data => { setItems(data ?? []); onCambio?.(data ?? []); })
      .catch(() => {});
  }, [endpoint, extraQs, onCambio]);

  // Guarda el nuevo orden (lista de ids) en el servidor.
  const persistirOrden = async (lista) => {
    try {
      await api.patch(`${endpoint}/reordenar`, { ...extra, ids: lista.map(x => x.id) });
      onCambio?.(lista);
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };

  const onHandleDown = (e, id) => {
    if (e.button != null && e.button !== 0) return; // solo botón principal
    dragIdRef.current = id;
    setDraggingId(id);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // Al mover el puntero, se coloca el elemento arrastrado en la posición de la
  // fila que está debajo (según su posición vertical).
  const onHandleMove = (e) => {
    const id = dragIdRef.current;
    if (id == null || !listRef.current) return;
    const y = e.clientY;
    const filas = [...listRef.current.querySelectorAll('[data-row]')];
    const objetivo = filas.find(f => {
      const r = f.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    if (!objetivo) return;
    const targetId = Number(objetivo.getAttribute('data-row'));
    if (targetId === id) return;
    setItems(prev => {
      const from = prev.findIndex(x => x.id === id);
      const to   = prev.findIndex(x => x.id === targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const lista = [...prev];
      const [movido] = lista.splice(from, 1);
      lista.splice(to, 0, movido);
      return lista;
    });
  };

  const onHandleUp = (e) => {
    if (dragIdRef.current == null) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    dragIdRef.current = null;
    setDraggingId(null);
    setItems(prev => { persistirOrden(prev); return prev; });
  };

  // Se pide confirmación antes de agregar.
  const pedirAgregar = () => {
    if (!nuevo.trim()) return;
    setConfirmar(true);
  };

  const ejecutarAgregar = async () => {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setSaving(true);
    try {
      const creado = await api.post(endpoint, { ...extra, ...nuevoExtra, nombre });
      setItems(prev => { const lista = [...prev, creado]; onCambio?.(lista); return lista; });
      setNuevo('');
      setNuevoExtra(porDefecto());
      setConfirmar(false);
      // Confirmación como animación (palomita) en la fila recién agregada.
      setSavedId(creado.id);
      setTimeout(() => setSavedId(s => (s === creado.id ? null : s)), 1800);
    } catch (err) {
      setConfirmar(false);
      onMensaje?.({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const guardarNombre = async (id) => {
    const nombre = editNombre.trim();
    if (!nombre) return;
    try {
      const upd = await api.put(`${endpoint}/${id}`, { ...editExtra, nombre });
      setItems(prev => { const lista = prev.map(x => (x.id === id ? upd : x)); onCambio?.(lista); return lista; });
      setEditId(null);
      // Confirmación como animación (palomita) en la fila, en vez de banner.
      setSavedId(id);
      setTimeout(() => setSavedId(s => (s === id ? null : s)), 1800);
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };

  const toggleActivo = async (item) => {
    try {
      const upd = await api.put(`${endpoint}/${item.id}`, { activo: !item.activo });
      setItems(prev => { const lista = prev.map(x => (x.id === item.id ? upd : x)); onCambio?.(lista); return lista; });
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };

  return (
    <>
    <div className="space-y-3">
      {/* El ancho lo ponen los envoltorios: los inputs llevan w-full en su
          clase y sin esto se apilan uno por renglón en móvil. Con desplegables
          el nombre se lleva el primer renglón (`basis-full`) y ellos bajan al
          segundo junto al botón, que es lo que cabe en un teléfono. */}
      {!soloConsulta && (
      <div className="flex flex-wrap gap-2">
        <div className={`flex-1 min-w-0 ${extraCampos.length > 0 ? 'basis-full' : ''}`}>
          <input
            type="text"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pedirAgregar(); } }}
            placeholder={`Agregar ${singular.toLowerCase()}`}
            className={inputCls}
          />
        </div>
        {extraCampos.map(campo => campoExtra(
          campo,
          nuevoExtra[campo.name] ?? campo.defecto,
          (v) => setNuevoExtra(prev => conCambio(prev, campo, v)),
        ))}
        <button
          type="button"
          onClick={pedirAgregar}
          disabled={saving || !nuevo.trim()}
          className="px-4 py-2.5 rounded-lg bg-blue text-white text-sm font-medium disabled:opacity-50 flex-shrink-0"
        >
          Agregar
        </button>
      </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-gray-400">{vacioTexto}</p>
      ) : (
        <ul ref={listRef} className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {items.map((item) => (
            <li
              key={item.id}
              data-row={item.id}
              className={`flex flex-wrap items-center gap-2 px-3 py-2.5 bg-white ${draggingId === item.id ? 'opacity-40 ring-2 ring-blue/40 ring-inset' : ''}`}
            >
              {editId === item.id ? (
                <>
                  <div className={`flex-1 min-w-0 ${extraCampos.length > 0 ? 'basis-full' : ''}`}>
                    <input
                      type="text"
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardarNombre(item.id); } }}
                      className={inputCls}
                      autoFocus
                    />
                  </div>
                  {extraCampos.map(campo => campoExtra(
                    campo,
                    editExtra[campo.name] ?? campo.defecto,
                    (v) => setEditExtra(prev => conCambio(prev, campo, v)),
                  ))}
                  <button type="button" onClick={() => guardarNombre(item.id)}
                    className="text-sm font-medium text-blue px-2">Guardar</button>
                  <button type="button" onClick={() => setEditId(null)}
                    className="text-sm text-gray-400 px-2">Cancelar</button>
                </>
              ) : (
                <>
                  {!soloConsulta && (
                  <span
                    onPointerDown={(e) => onHandleDown(e, item.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    style={{ touchAction: 'none' }}
                    className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 -ml-1 p-1"
                    title="Arrastrar para reordenar"
                    aria-label="Arrastrar para reordenar"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M7 4a1 1 0 100 2 1 1 0 000-2zM7 9a1 1 0 100 2 1 1 0 000-2zM7 14a1 1 0 100 2 1 1 0 000-2zM13 4a1 1 0 100 2 1 1 0 000-2zM13 9a1 1 0 100 2 1 1 0 000-2zM13 14a1 1 0 100 2 1 1 0 000-2z" />
                    </svg>
                  </span>
                  )}
                  {/* El nombre y sus datos van en columna: los nombres de
                      modelo son largos y en una sola línea el renglón se
                      partía en dos en el teléfono. */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${item.activo ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                      {item.nombre}
                    </p>
                    {extraCampos.length > 0 && (
                      <p className="text-xs text-gray-400 truncate">
                        {extraCampos.map(c => etiquetaDe(c, item[c.name])).filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  {savedId === item.id && (
                    <span className="flex items-center gap-1 text-green-600 text-xs font-medium animate-fade-in">
                      <IconoGuardado />
                      Guardado
                    </span>
                  )}
                  {!soloConsulta && (<>
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(item.id);
                      setEditNombre(item.nombre);
                      setEditExtra(Object.fromEntries(
                        extraCampos.map(c => [c.name, item[c.name] ?? c.defecto])
                      ));
                    }}
                    className="text-sm text-gray-500 hover:text-blue px-2"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActivo(item)}
                    className={`text-sm px-2 ${item.activo ? 'text-gray-500 hover:text-red-600' : 'text-blue'}`}
                  >
                    {item.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  </>)}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>

    {/* Confirmación antes de agregar */}
    {confirmar && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-light-blue rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Agregar {singular.toLowerCase()}</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                ¿Agregar <span className="font-medium text-gray-700">{nuevo.trim()}</span> a la lista?
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button" onClick={() => setConfirmar(false)} disabled={saving}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button" onClick={ejecutarAgregar} disabled={saving}
              className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3 rounded-lg text-base transition-colors"
            >
              {saving ? 'Agregando...' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// Qué máquina es un modelo (mig. 118). Son los mismos dos ejes de la máquina y
// de los tiempos; lo que hacen aquí es colocar al modelo en su bloque de
// tiempos (Lavadora → Mediana, Secadora → Jumbo…).
const CAMPOS_MODELO = [
  { name: 'tipo', defecto: 'lavadora', opciones: [
    { v: 'lavadora', label: 'Lavadora' },
    { v: 'secadora', label: 'Secadora' },
  ] },
  { name: 'tamano', defecto: 'mediana', opciones: [
    { v: 'mediana', label: 'Mediana' },
    { v: 'jumbo',   label: 'Jumbo'   },
  ] },
  // Los modelos con varios programas (mig. 120). Se declara aquí y no en el
  // bloque de tiempos para que los demás modelos —que son casi todos— no
  // carguen con campos que no usan.
  { name: 'pregunta_tiempo', defecto: false, tipo: 'check', excluye: 'solo_fichas',
    label: 'Varios programas: se elige cuál al iniciar', chip: 'varios programas' },
  // Sin Sonoff (mig. 149): no pide tiempos —ni tope ni ficha— y su "Iniciar"
  // solo arranca el cronómetro. No puede ir con varios programas.
  { name: 'solo_fichas', defecto: false, tipo: 'check', excluye: 'pregunta_tiempo',
    label: 'Trabaja con fichas: sin Sonoff y sin tiempos', chip: 'fichas' },
  // La casilla "Una carga corre 2 ciclos" (migs. 108 y 123) se escondió el
  // 2026-10-02: con el cronómetro la máquina termina cuando la finalizan y
  // ninguna carga corre dos. El dato sigue en la base; para volver a mostrarla
  // (si se regresa al temporizador) se repone aquí:
  //   { name: 'dos_ciclos', defecto: false, tipo: 'check',
  //     label: 'Una carga corre 2 ciclos', chip: '2 ciclos' },
];

// Marcas de máquina y, colgando de cada una, sus modelos (migs. 117 y 118).
//
// Van juntas porque se administran juntas: se da de alta la marca y enseguida
// sus modelos. El desplegable dice de qué marca es la lista de abajo, y el
// catálogo de marcas avisa sus cambios para que una marca recién agregada
// aparezca ahí sin recargar la pantalla.
//
// El modelo NO trae aquí su tiempo de ciclo: eso se escribe más arriba, en el
// bloque de Lavadora o Secadora que le toca, junto a los demás tiempos. Lo que
// se captura aquí es qué máquina es, que es justo lo que lo manda a ese bloque.
// En el desplegable salen también las marcas desactivadas, porque sus máquinas
// siguen dadas de alta y sus modelos se tienen que poder corregir.
//
// Las dos versiones de Ajustes (escritorio y móvil) pintan lo mismo y solo
// cambian de estilo, así que `movil` elige el renglón y las clases en vez de
// duplicar la sección entera.
function MarcasYModelos({ movil = false, onMensaje, soloConsulta = false }) {
  const Campo      = movil ? MobileField : Field;
  const inputCls   = movil ? MOBILE_INPUT_CLS : INPUT_CLS;
  const divisorCls = movil
    ? 'border-t border-light-blue/60 pt-5'
    : 'border-t border-gray-100 pt-4';

  const [marcas,  setMarcas]  = useState([]);
  const [elegida, setElegida] = useState('');

  // La marca elegida se deriva en vez de guardarse a secas: si deja de existir
  // —o todavía no se elige ninguna— manda la primera de la lista, sin un efecto
  // que encadene otra pintada.
  const marcaId = marcas.some(m => String(m.id) === String(elegida))
    ? elegida
    : String(marcas[0]?.id ?? '');

  // Estable a propósito: el catálogo la lleva en las dependencias de su carga.
  const recibirMarcas = useCallback((lista) => setMarcas(lista), []);

  return (
    <>
      <Campo
        label="Marcas"
        hint="Se eligen al dar de alta una máquina. Desactivar una marca la quita de la lista sin tocar las máquinas que ya la tienen."
      >
        <CatalogoEtiquetas
          endpoint="/etiquetas/marcas-maquina"
          singular="Marca"
          vacioTexto="Aún no hay marcas."
          inputCls={inputCls}
          onMensaje={onMensaje}
          onCambio={recibirMarcas}
          soloConsulta={soloConsulta}
        />
      </Campo>

      <div className={divisorCls}>
        <Campo
          label="Modelos"
          hint="Los modelos de la marca elegida. Su tope de carga se configura arriba, en el bloque de Lavadora o Secadora que les toque."
        >
          {marcas.length === 0 ? (
            <p className="text-sm text-gray-400">Primero agrega una marca.</p>
          ) : (
            <div className="space-y-3">
              <Selector
                claseCampo={inputCls}
                valor={marcaId}
                onChange={(v) => setElegida(String(v))}
                titulo="Marca"
                etiquetaAria="Marca de los modelos"
                opciones={marcas.map(m => ({
                  valor: String(m.id),
                  etiqueta: m.nombre,
                  detalle: m.activo ? null : 'desactivada',
                }))}
              />
              {/* La `key` es a propósito: al cambiar de marca se vacía el
                  formulario de alta y el renglón que se estaba editando. */}
              {marcaId && (
                <CatalogoEtiquetas
                  key={marcaId}
                  endpoint="/etiquetas/modelos-maquina"
                  singular="Modelo"
                  extra={{ marca_id: marcaId }}
                  extraCampos={CAMPOS_MODELO}
                  vacioTexto="Esta marca todavía no tiene modelos."
                  inputCls={inputCls}
                  onMensaje={onMensaje}
                  soloConsulta={soloConsulta}
                />
              )}
            </div>
          )}
        </Campo>
      </div>
    </>
  );
}

// Palomita animada (mismo trazo que el éxito de NuevaNota) para el estado
// "guardado" de los botones de Ajustes.
function IconoGuardado() {
  return (
    <svg className="w-5 h-5 animate-pop-in" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"
        style={{ strokeDasharray: 48, strokeDashoffset: 48 }} className="animate-draw-check" />
    </svg>
  );
}

// Contenido de un botón de guardar según su estado: cargando · guardado · reposo.
function ContenidoGuardar({ saving, ok, children, guardando = 'Guardando...', okLabel = '¡Guardado!' }) {
  if (saving) {
    return (
      <>
        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        {guardando}
      </>
    );
  }
  if (ok) return (<><IconoGuardado />{okLabel}</>);
  return children;
}

// Lista de sucursales reordenable por arrastre (Pointer Events: mouse y touch).
// Al soltar persiste el nuevo orden con PATCH /sucursales/reordenar { slugs }.
function SucursalesOrden({ sucursales, setSucursales, onMensaje }) {
  const listRef = useRef(null);
  const dragSlugRef = useRef(null);
  const [draggingSlug, setDraggingSlug] = useState(null);

  const persistir = async (lista) => {
    try {
      await api.patch('/sucursales/reordenar', { slugs: lista.map(s => s.slug) });
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };
  const onDown = (e, slug) => {
    if (e.button != null && e.button !== 0) return;
    dragSlugRef.current = slug;
    setDraggingSlug(slug);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onMove = (e) => {
    const slug = dragSlugRef.current;
    if (slug == null || !listRef.current) return;
    const y = e.clientY;
    const filas = [...listRef.current.querySelectorAll('[data-row]')];
    const objetivo = filas.find(f => {
      const r = f.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    if (!objetivo) return;
    const targetSlug = objetivo.getAttribute('data-row');
    if (targetSlug === slug) return;
    setSucursales(prev => {
      const from = prev.findIndex(x => x.slug === slug);
      const to   = prev.findIndex(x => x.slug === targetSlug);
      if (from === -1 || to === -1 || from === to) return prev;
      const lista = [...prev];
      const [movido] = lista.splice(from, 1);
      lista.splice(to, 0, movido);
      return lista;
    });
  };
  const onUp = (e) => {
    if (dragSlugRef.current == null) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    dragSlugRef.current = null;
    setDraggingSlug(null);
    setSucursales(prev => { persistir(prev); return prev; });
  };

  if (sucursales.length < 2) return null;
  return (
    <ul ref={listRef} className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
      {sucursales.map((s) => (
        <li
          key={s.slug}
          data-row={s.slug}
          className={`flex items-center gap-2 px-3 py-2.5 bg-white ${draggingSlug === s.slug ? 'opacity-40 ring-2 ring-blue/40 ring-inset' : ''}`}
        >
          <span
            onPointerDown={(e) => onDown(e, s.slug)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ touchAction: 'none' }}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 -ml-1 p-1"
            title="Arrastrar para reordenar"
            aria-label="Arrastrar para reordenar"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 4a1 1 0 100 2 1 1 0 000-2zM7 9a1 1 0 100 2 1 1 0 000-2zM7 14a1 1 0 100 2 1 1 0 000-2zM13 4a1 1 0 100 2 1 1 0 000-2zM13 9a1 1 0 100 2 1 1 0 000-2zM13 14a1 1 0 100 2 1 1 0 000-2z" />
            </svg>
          </span>
          <span className={`flex-1 text-sm ${s.activa ? 'text-gray-800' : 'text-gray-400'}`}>
            {s.nombre}{s.activa ? '' : ' (inactiva)'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Ajustes() {
  const { usuario, updateUsuario, sucursalActiva } = useAuth();
  const [config,        setConfig]        = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview,   setLogoPreview]   = useState(null);
  const [mensaje,       setMensaje]       = useState(null);
  const [mobileSection, setMobileSection] = useState(null);
  const navigate = useNavigate();
  // Decide si el menú lleva la fila "Instalar la app": depende del equipo, no
  // de la configuración del negocio.
  const { sePuedeInstalar } = useInstalacion();
  const [perfilForm,    setPerfilForm]    = useState(() => ({
    nombre: usuario?.nombre ?? '',
    apellido: usuario?.apellido ?? '',
    password: '',
  }));
  const [showPassword, setShowPassword] = useState(false);
  // Clave del botón que acaba de guardar, para mostrarle la animación de palomita.
  const [guardadoOk, setGuardadoOk] = useState(null);
  const marcarGuardado = (clave) => {
    setGuardadoOk(clave);
    setTimeout(() => setGuardadoOk((actual) => (actual === clave ? null : actual)), 2200);
  };
  const logoInputRef = useRef(null);

  // Sucursales: cada una con su nombre, dirección y teléfono editables.
  // sucursalSel = slug de la sucursal que se está editando en el selector.
  const [sucursales,     setSucursales]     = useState([]);
  const [sucursalSel,    setSucursalSel]    = useState('');
  const [cambiandoActiva, setCambiandoActiva] = useState(null); // slug activándose/desactivándose
  const [agregando,      setAgregando]      = useState(false);
  const [creando,        setCreando]        = useState(false);
  const [nuevaSucursal,  setNuevaSucursal]  = useState({ nombre: '', direccion: '', telefono: '' });
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(null); // sucursal a desactivar

  // Solo el Admin Main puede desactivar/reactivar sucursales.
  const esMain = esAdminMainFn(usuario?.rol);

  // Los usuarios de prueba operan en una sucursal aislada, pero los ajustes son
  // del negocio entero (tarifas, tiempos, sucursales, catálogos). VEN toda la
  // configuración —para eso está el entorno: para conocer la app entera—, pero
  // no pueden guardar nada, ni siquiera su perfil: las cuentas de prueba son
  // compartidas (2026-10-04). No es una cortesía del frontend: el backend
  // rechaza todo con 403, así que en vez de ofrecer un "Guardar" que va a
  // fallar, no se ofrece.
  // En la demo la configuración es de juguete y se puede tocar entera.
  const soloConsultaPruebas = usuario?.es_prueba === true && !ES_DEMO;

  const [tiemposMarca, setTiemposMarca] = useState([]);
  const [edredones, setEdredones] = useState([]);
  // Precios de edredón tal como vinieron, para mandar solo los que cambiaron.
  const edredonOrigRef = useRef({});
  // Lo que vino del servidor, para mandar solo lo que cambió al guardar.
  const tiemposOrigRef = useRef([]);

  useEffect(() => {
    api.get('/ajustes')
      .then(data => {
        setConfig(prev => ({ ...prev, ...data, telefono: formatTelefono(data.telefono ?? '') }));
        if (data.logo_url) setLogoPreview(data.logo_url);
      })
      .catch(e => setMensaje({ tipo: 'error', texto: e.message }))
      .finally(() => setLoading(false));
  }, []);

  // Tiempos de ciclo por marca y tamaño (mig. 107). El backend solo devuelve
  // las combinaciones que tienen sentido: las que existen en máquinas dadas de
  // alta más las ya configuradas, así que la pantalla no se llena de campos
  // vacíos por marcas que no están en ese tamaño.
  // Precio de cada tamaño de edredón (mig. 130). Viven en su catálogo, pero se
  // capturan junto a los demás servicios: entran a `config` con una clave por
  // tamaño para usar los mismos campos, y al guardar van a su endpoint.
  useEffect(() => {
    api.get('/etiquetas/tamanos-edredon')
      .then(d => {
        const lista = d ?? [];
        const valores = Object.fromEntries(lista.flatMap(e => camposEdredon(e).map(([k, , v]) => [k, v])));
        edredonOrigRef.current = valores;
        setEdredones(lista);
        setConfig(prev => ({ ...prev, ...valores }));
      })
      .catch(() => { /* sin catálogo no hay precios de edredón que mostrar */ });
  }, []);

  useEffect(() => {
    api.get('/etiquetas/tiempos-marca')
      .then(d => { setTiemposMarca(d ?? []); tiemposOrigRef.current = d ?? []; })
      .catch(() => { /* sin esto la pantalla sigue sirviendo: manda el respaldo */ });
  }, []);

  useEffect(() => {
    // ?todas=1 incluye inactivas para poder gestionarlas (reactivarlas).
    api.get('/sucursales?todas=1')
      .then(data => {
        const lista = (data ?? []).map(s => ({ ...s, telefono: formatTelefono(s.telefono ?? '') }));
        setSucursales(lista);
        // Arranca en la sucursal activa del admin, o en la primera.
        setSucursalSel(prev => prev || sucursalActiva || lista[0]?.slug || '');
      })
      .catch(() => {});
  }, [sucursalActiva]);

  const handleSucursalChange = (slug, field, value) => {
    const next = field === 'telefono' ? formatTelefono(value) : value;
    setSucursales(prev => prev.map(s => s.slug === slug ? { ...s, [field]: next } : s));
  };

  // Valida y guarda la sucursal seleccionada. Devuelve la fila actualizada, o
  // null si no hay ninguna cargada. Lanza si el nombre está vacío o falla la API.
  // No maneja su propia animación de guardado: eso lo controla quien la llama
  // (ahora es "Guardar cambios"), para que la sucursal se guarde junto con lo demás.
  const patchSucursalActual = async () => {
    const s = sucursales.find(x => x.slug === sucursalSel);
    if (!s) return null;
    if (!String(s.nombre ?? '').trim()) {
      throw new Error('El nombre de la sucursal no puede estar vacío.');
    }
    const updated = await api.patch(`/sucursales/${s.slug}`, {
      nombre:    s.nombre,
      direccion: s.direccion ?? '',
      telefono:  s.telefono  ?? '',
    });
    setSucursales(prev => prev.map(x =>
      x.slug === updated.slug ? { ...updated, telefono: formatTelefono(updated.telefono ?? '') } : x
    ));
    return updated;
  };

  const handleNuevaChange = (field, value) => {
    const next = field === 'telefono' ? formatTelefono(value) : value;
    setNuevaSucursal(prev => ({ ...prev, [field]: next }));
  };

  const agregarSucursal = async () => {
    if (!nuevaSucursal.nombre.trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal es requerido.' });
    }
    setCreando(true);
    setMensaje(null);
    try {
      const creada = await api.post('/sucursales', {
        nombre:    nuevaSucursal.nombre.trim(),
        direccion: nuevaSucursal.direccion || '',
        telefono:  nuevaSucursal.telefono  || '',
      });
      const conFormato = { ...creada, telefono: formatTelefono(creada.telefono ?? '') };
      setSucursales(prev => [...prev, conFormato]);
      setSucursalSel(creada.slug);       // pasa a editar la recién creada
      setNuevaSucursal({ nombre: '', direccion: '', telefono: '' });
      setAgregando(false);
      marcarGuardado(`sucursal:${creada.slug}`);
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setCreando(false);
    }
  };

  const toggleActivaSucursal = async (slug, activa) => {
    setCambiandoActiva(slug);
    setMensaje(null);
    try {
      const updated = await api.patch(`/sucursales/${slug}/activa`, { activa });
      setSucursales(prev => prev.map(x =>
        x.slug === slug ? { ...x, ...updated, telefono: formatTelefono(updated.telefono ?? '') } : x
      ));
      setMensaje({
        tipo: 'ok',
        texto: `Sucursal "${updated.nombre}" ${activa ? 'reactivada' : 'desactivada'}.`,
      });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setCambiandoActiva(null);
    }
  };

  const confirmarDesactivarSucursal = async () => {
    if (!confirmarDesactivar) return;
    await toggleActivaSucursal(confirmarDesactivar.slug, false);
    setConfirmarDesactivar(null);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // El R.F.C. es texto libre (admite espacios y palabras), todo en mayúsculas.
    const next = name === 'telefono' ? formatTelefono(value)
      : name === 'rfc' ? value.toUpperCase()
      : value;
    setConfig(prev => ({ ...prev, [name]: next }));
  };

  // Suma/resta `delta` a un campo numérico (los botones +/-). Un campo vacío
  // cuenta como 0; no baja de `min`. Redondea a 2 decimales para evitar
  // arrastres de flotante (p. ej. 0.1 + 0.2).
  const stepCampo = (name, delta, min = 0) => {
    setConfig(prev => {
      const base = prev[name] === '' || prev[name] == null ? 0 : Number(prev[name]);
      let next = (Number.isFinite(base) ? base : 0) + delta;
      if (min != null && next < min) next = min;
      next = Math.round(next * 100) / 100;
      return { ...prev, [name]: String(next) };
    });
  };

  // Par de botones − / + para un campo, en tamaño desktop o móvil.
  const stepBtns = (name, step, min = 0, mobile = false) => {
    const cls = mobile ? STEP_BTN_CLS_M : STEP_BTN_CLS;
    return (
      <>
        <button type="button" aria-label="Disminuir" onClick={() => stepCampo(name, -step, min)} className={cls}>−</button>
        <button type="button" aria-label="Aumentar"  onClick={() => stepCampo(name,  step, min)} className={cls}>+</button>
      </>
    );
  };

  // ── Tiempos de ciclo por modelo (mig. 118) ──
  // Un renglón por modelo, "LG · WM22WV26SR": quien sabe cuánto dura un ciclo
  // es el modelo. Lo que quede vacío cae al tiempo general de arriba.
  const claveTiempo = (t) => `modelo|${t.modelo_id}`;
  const etiquetaTiempo = (t) => `${t.marca} · ${t.modelo}`;
  // Desde el 2026-10-02 las máquinas corren con cronómetro y estos minutos son
  // su TOPE. También en el modelo que pregunta su programa (Sec49, mig. 146):
  // el campo grande es su tope y los tres chicos, los programas a elegir.
  const ayudaTiempo = (t) => {
    const base = t?.pregunta_tiempo
      ? 'Arriba, el tope: a esos minutos se le corta la luz si nadie la finaliza. Abajo, los programas: al iniciarla se pregunta cuál corre y se avisa cuando lo cumpla. Tope vacío = el programa más largo.'
      : 'Tope de carga de este modelo: a estos minutos se le corta la luz si nadie la finaliza. Vacío = usa el tope de arriba.';
    if (t?.tipo !== 'secadora') return base;
    return `${base} Cada ficha: solo si es de fichas con Sonoff; al iniciarla se le mete una ficha por cada tantos minutos ${t?.pregunta_tiempo ? 'del programa elegido' : 'del tope'}. Vacío = no es de fichas.`;
  };

  // Un modelo puede llevar TRES programas además de su tope (migs. 120 y 146):
  // la Sec49 no tiene "un" ciclo, tiene tres programas y quien elige es el
  // empleado con la ropa delante. Los campos salen SOLO en los modelos marcados
  // como de varios tiempos (en Marcas y modelos); el resto, que son casi todos,
  // no los ven. Sin el interruptor los programas no mandan nada.
  const tieneVariosTiempos = (t) => Boolean(t.pregunta_tiempo);

  // Secadoras de fichas (mig. 147): su Sonoff mete fichas en vez de dar
  // corriente. Con este campo lleno, al iniciarla la app manda una ficha por
  // cada tantos minutos del programa elegido (o del tope, si no pregunta).
  // Solo en secadoras: a las lavadoras no se les meten fichas con el Sonoff.
  const campoFicha = (t, inputCls, unidadCls) => (
    t.tipo === 'secadora' ? (
      <div className="mt-3 flex items-center gap-2">
        <span className={`${unidadCls} flex-shrink-0 w-24`}>Cada ficha</span>
        <input
          type="number" min="1" step="1" placeholder="—"
          value={t.minutos_por_ficha ?? ''}
          onChange={e => setMinutosMarca(claveTiempo(t), e.target.value, 'minutos_por_ficha')}
          className={`${inputCls} text-center`}
        />
        <span className={`${unidadCls} flex-shrink-0`}>min</span>
      </div>
    ) : null
  );

  // Un programa más largo que el tope no se puede cumplir: el tope llega
  // antes (2026-10-08). No se bloquea al guardar —los campos se corrigen uno
  // por uno y una regla dura trabaría a quien está a medio cambio—; se avisa
  // mientras se escribe.
  const programasSobreTope = (t) => {
    const tope = Number(t.minutos);
    if (!tieneVariosTiempos(t) || !(tope > 0)) return [];
    return ['minutos_2', 'minutos_3', 'minutos_4']
      .map(c => Number(t[c]))
      .filter(n => Number.isFinite(n) && n > tope);
  };
  const avisoProgramasSobreTope = (t) => {
    const largos = programasSobreTope(t);
    if (largos.length === 0) return null;
    const lista = largos.map(n => `${n} min`).join(' y ');
    return (
      <p className="mt-2 text-xs font-medium text-amber-700" role="alert">
        {largos.length === 1 ? `El programa de ${lista} es más largo` : `Los programas de ${lista} son más largos`}
        {` que el tope (${Number(t.minutos)} min): el tope llega antes de que termine. Sube el tope o acorta el programa.`}
      </p>
    );
  };

  const camposOtrosTiempos = (t, inputCls, unidadCls) => (
    <>
      {tieneVariosTiempos(t) ? (
        <div className="mt-3 flex items-center gap-2">
          <span className={`${unidadCls} flex-shrink-0 w-24`}>Otros tiempos</span>
          {['minutos_2', 'minutos_3', 'minutos_4'].map(campo => (
            <input
              key={campo}
              type="number" min="1" step="1" placeholder="—"
              value={t[campo] ?? ''}
              onChange={e => setMinutosMarca(claveTiempo(t), e.target.value, campo)}
              className={`${inputCls} text-center`}
            />
          ))}
          <span className={`${unidadCls} flex-shrink-0`}>min</span>
        </div>
      ) : null}
      {avisoProgramasSobreTope(t)}
      {/* Sin Sonoff en la demo (2026-10-08): no hay fichas que meter. */}
      {!ES_DEMO && campoFicha(t, inputCls, unidadCls)}
    </>
  );
  const tiemposDe = (tipo, tamano) =>
    tiemposMarca.filter(t => t.tipo === tipo && t.tamano === tamano);

  const setMinutosMarca = (clave, valor, campo = 'minutos') =>
    setTiemposMarca(prev => prev.map(t => (claveTiempo(t) === clave ? { ...t, [campo]: valor } : t)));

  const stepMinutosMarca = (clave, paso) =>
    setTiemposMarca(prev => prev.map(t => {
      if (claveTiempo(t) !== clave) return t;
      const actual = Number(t.minutos);
      return { ...t, minutos: String(Math.max(1, (Number.isFinite(actual) ? actual : 0) + paso)) };
    }));

  const stepBtnsMarca = (clave, mobile = false) => {
    const cls = mobile ? STEP_BTN_CLS_M : STEP_BTN_CLS;
    return (
      <>
        <button type="button" aria-label="Disminuir" onClick={() => stepMinutosMarca(clave, -1)} className={cls}>−</button>
        <button type="button" aria-label="Aumentar"  onClick={() => stepMinutosMarca(clave,  1)} className={cls}>+</button>
      </>
    );
  };

  // Solo se mandan los tamaños de edredón con algo cambiado (precio, medidas o
  // bolsas), cada uno a su endpoint.
  const guardarPreciosEdredon = async () => {
    const distinto = (k) => String(config[k] ?? '') !== String(edredonOrigRef.current[k] ?? '');
    const cambiados = edredones.filter(e => camposEdredon(e).some(([k]) => distinto(k)));
    if (cambiados.length === 0) return;
    await Promise.all(cambiados.map(e => api.put(`/etiquetas/tamanos-edredon/${e.id}`, {
      precio:           precioServicioONull(config[claveEdredon(e)]),
      precarga_medidas: Number(config[claveEdredonMedidas(e)]),
      precarga_bolsas:  Number(config[claveEdredonBolsas(e)]),
    })));
    edredonOrigRef.current = Object.fromEntries(
      edredones.flatMap(e => camposEdredon(e).map(([k]) => [k, config[k] ?? ''])));
  };

  // Solo se mandan las combinaciones que cambiaron, cada una a su endpoint.
  // Vaciar el campo borra el tiempo de esa marca: vuelve a mandar el de su
  // tamaño, que es la forma de deshacer sin dejar un cero que pararía el
  // temporizador.
  const guardarTiemposMarca = async () => {
    const aNumero = (v) => (v === '' || v == null ? null : Number(v));
    // Un renglón puede cambiar por su tope o por cualquiera de sus programas,
    // así que la comparación va campo por campo.
    const foto = (t) => [
      aNumero(t.minutos), aNumero(t.minutos_2), aNumero(t.minutos_3), aNumero(t.minutos_4),
      aNumero(t.minutos_por_ficha),
    ].join('|');
    const antes = new Map(tiemposOrigRef.current.map(t => [claveTiempo(t), foto(t)]));
    const cambiados = tiemposMarca.filter(t => antes.get(claveTiempo(t)) !== foto(t));
    if (cambiados.length === 0) return;

    await Promise.all(cambiados.map(t => api.put('/etiquetas/tiempos-marca', {
      modelo_id: t.modelo_id,
      minutos:   aNumero(t.minutos),
      minutos_2: aNumero(t.minutos_2),
      minutos_3: aNumero(t.minutos_3),
      minutos_4: aNumero(t.minutos_4),
      // Solo las secadoras lo enseñan.
      ...(t.tipo === 'secadora' ? { minutos_por_ficha: aNumero(t.minutos_por_ficha) } : {}),
    })));
    tiemposOrigRef.current = tiemposMarca.map(t => ({
      ...t,
      minutos: aNumero(t.minutos), minutos_2: aNumero(t.minutos_2), minutos_3: aNumero(t.minutos_3),
      minutos_4: aNumero(t.minutos_4), minutos_por_ficha: aNumero(t.minutos_por_ficha),
    }));
  };

  const handlePerfilChange = (e) => {
    const { name, value } = e.target;
    if (name === 'password' && perfilForm.password === '' && value.length > 0) {
      setShowPassword(true);
    }
    const next = name === 'telefono' ? formatTelefono(value) : value;
    setPerfilForm(prev => ({ ...prev, [name]: next }));
  };

  const handleGuardarPerfil = async (e) => {
    e.preventDefault();
    const nombreCompleto = `${perfilForm.nombre} ${perfilForm.apellido}`.trim();
    if (!nombreCompleto) {
      return setMensaje({ tipo: 'error', texto: 'El nombre no puede estar vacío.' });
    }
    if (perfilForm.password && perfilForm.password.length < 6) {
      return setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    setSaving(true);
    setMensaje(null);
    try {
      const payload = { nombre: perfilForm.nombre.trim(), apellido: perfilForm.apellido.trim() };
      if (perfilForm.password) payload.password = perfilForm.password;
      const updated = await api.patch('/auth/me', payload);
      updateUsuario({
        nombre: updated.nombre,
        apellido: updated.apellido,
        rol: updated.rol,
      });
      setPerfilForm(f => ({ ...f, password: '' }));
      marcarGuardado('mobile');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitMobile = (e) => {
    if (soloConsultaPruebas) { e.preventDefault(); return; }
    if (mobileSection === 'perfil') return handleGuardarPerfil(e);
    if (mobileSection === 'negocio') return handleGuardarNegocioMobile(e);
    return handleGuardar(e);
  };

  // Guardado de la sección "Sucursales" en móvil con el botón "Guardar" del pie:
  // guarda tanto los datos del negocio (nombre_negocio; el logo va aparte) como
  // la sucursal seleccionada, en una sola acción.
  const handleGuardarNegocioMobile = async (e) => {
    e?.preventDefault();
    const s = sucursales.find(x => x.slug === sucursalSel);
    if (s && !String(s.nombre ?? '').trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal no puede estar vacío.' });
    }
    const problema = problemaDeAjustes();
    if (problema) return setMensaje({ tipo: 'error', texto: problema });
    setSaving(true);
    setMensaje(null);
    try {
      const [updatedConfig] = await Promise.all([
        api.patch('/ajustes', buildConfigPayload()),
        patchSucursalActual(),
        guardarTiemposMarca(),
        guardarPreciosEdredon(),
      ]);
      setConfig(prev => ({ ...prev, ...updatedConfig }));
      marcarGuardado('mobile');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Un servicio sin precio capturado. Pinta el campo en rojo y frena el guardado.
  // Todos los precios de servicio que se capturan: los fijos y uno por cada
  // tamaño de edredón activo.
  const preciosServicio = [
    ...PRECIOS_SERVICIO,
    ...edredones.filter(e => e.activo).map(e => [
      claveEdredon(e), `Servicio Edredón ${e.nombre}`, `de edredón ${e.nombre}`,
      claveEdredonMedidas(e), claveEdredonBolsas(e),
    ]),
  ];
  // Medidas o bolsas vacías o que no son un entero de 0 o más.
  const precargaInvalida = (name) => {
    const v = config[name];
    return v === '' || v == null || !Number.isInteger(Number(v)) || Number(v) < 0;
  };
  const sinPrecioServicio = (name) => {
    const v = config[name];
    return v === '' || v == null;
  };
  // Lo que le falta a la configuración para poder guardarse, o null si está
  // completa. Los precios de los servicios Por Encargo son obligatorios: el
  // backend también los exige, pero aquí se dice antes y con el nombre que se
  // ve en la pantalla.
  const problemaDeAjustes = () => {
    const falta = preciosServicio.filter(([name]) => sinPrecioServicio(name));
    if (falta.length > 0) {
      return `Falta el precio de: ${falta.map(([, label]) => label).join(', ')}. `
        + 'Sin precio no se puede vender el servicio.';
    }
    const malos = preciosServicio.filter(([, , , m, b]) => precargaInvalida(m) || precargaInvalida(b));
    if (malos.length > 0) {
      return `Revisa las medidas y bolsas de: ${malos.map(([, label]) => label).join(', ')}. `
        + 'Van en números enteros, 0 o más.';
    }
    return null;
  };

  // Precio de cada servicio Por Encargo: obligatorio. Es EL precio que se
  // cobra (ya no un tope contra el que se compara lo que lleva la carga), así
  // que un servicio sin precio no se puede vender: vacío se manda como null y
  // el backend lo rechaza diciendo cuál falta.
  const precioServicioONull = (v) => (v === '' || v == null ? null : Number(v));

  // Payload de configuración del negocio para PATCH /ajustes. Se arma con el
  // estado completo de `config`, así que guardar desde cualquier sección envía
  // todos los campos (los no editados van con su valor actual).
  const buildConfigPayload = () => ({
    precio_carga_mediana:  Number(config.precio_carga_mediana),
    precio_carga_jumbo:    Number(config.precio_carga_jumbo),
    precio_carga_secadora: Number(config.precio_carga_secadora),
    precio_secadora_jumbo:   Number(config.precio_secadora_jumbo),
    tope_carga_chico:      precioServicioONull(config.tope_carga_chico),
    tope_carga_mediano:    precioServicioONull(config.tope_carga_mediano),
    tope_carga_grande:     precioServicioONull(config.tope_carga_grande),
    // Lo que trae puesto cada servicio fijo (mig. 132).
    ...Object.fromEntries(CAMPOS_PRECARGA.map(c => [c, Number(config[c])])),
    // El Edredón se cobra por tamaño (mig. 130): su precio va al catálogo, no
    // aquí; `tope_carga_edredon` solo queda para cargas viejas sin tamaño.
    // Jumbo ya no se captura: Por Encargo vende Chico, Mediano, Grande y Edredón. La
    // columna se conserva para las notas viejas que sí eligieron ese tamaño,
    // así que no se manda —ni se borra— desde aquí.
    // El edredón no tiene tiempo de máquina propio: usa el tope de la jumbo.
    // La tarifa del edredón en lavadora jumbo volvió el 2026-10-02.
    precio_edredon_jumbo:  Number(config.precio_edredon_jumbo),
    tiempo_carga_mediana:  Number(config.tiempo_carga_mediana),
    tiempo_carga_jumbo:    Number(config.tiempo_carga_jumbo),
    tiempo_carga_secadora: Number(config.tiempo_carga_secadora),
    tiempo_secadora_jumbo: Number(config.tiempo_secadora_jumbo),
    // Los textos con los que se identifica el negocio no se mandan en la demo:
    // el backend los ignora igualmente, pero así el payload dice lo mismo que
    // la pantalla, donde van deshabilitados.
    ...(ES_DEMO ? {} : {
      nombre_negocio:           config.nombre_negocio,
      rfc:                      config.rfc ?? '',
      ticket_nota_autoservicio: config.ticket_nota_autoservicio ?? '',
      ticket_nota_encargo:      config.ticket_nota_encargo ?? '',
      ticket_nota_productos:    config.ticket_nota_productos ?? '',
      whatsapp_mensaje_encargo: config.whatsapp_mensaje_encargo ?? '',
    }),
    alerta_ciclo_detenido: !!config.alerta_ciclo_detenido,
  });

  const handleGuardarTodo = async () => {
    const nombreCompleto = `${perfilForm.nombre} ${perfilForm.apellido}`.trim();
    if (!nombreCompleto) {
      return setMensaje({ tipo: 'error', texto: 'El nombre no puede estar vacío.' });
    }
    if (perfilForm.password && perfilForm.password.length < 6) {
      return setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    // Un usuario de prueba no guarda nada (ni su perfil).
    if (soloConsultaPruebas) return;

    const sucursalActualEdit = sucursales.find(x => x.slug === sucursalSel);
    if (sucursalActualEdit && !String(sucursalActualEdit.nombre ?? '').trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal no puede estar vacío.' });
    }
    const problemaConfig = problemaDeAjustes();
    if (problemaConfig) return setMensaje({ tipo: 'error', texto: problemaConfig });

    setSaving(true);
    setMensaje(null);
    try {
      const perfilPayload = { nombre: perfilForm.nombre.trim(), apellido: perfilForm.apellido.trim() };
      if (perfilForm.password) perfilPayload.password = perfilForm.password;

      const [updatedPerfil, updatedConfig] = await Promise.all([
        api.patch('/auth/me', perfilPayload),
        api.patch('/ajustes', buildConfigPayload()),
        guardarTiemposMarca(),
        guardarPreciosEdredon(),
        // La sucursal seleccionada se guarda junto con el resto. patchSucursalActual
        // actualiza su estado por dentro; su resultado no se necesita aquí.
        patchSucursalActual(),
      ]);

      updateUsuario({ nombre: updatedPerfil.nombre, apellido: updatedPerfil.apellido, rol: updatedPerfil.rol });
      setPerfilForm(f => ({ ...f, password: '' }));
      setConfig(prev => ({ ...prev, ...updatedConfig }));
      marcarGuardado('todo');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleGuardar = async (e) => {
    e?.preventDefault();
    const problema = problemaDeAjustes();
    if (problema) return setMensaje({ tipo: 'error', texto: problema });
    setSaving(true);
    setMensaje(null);
    try {
      const [updated] = await Promise.all([
        api.patch('/ajustes', buildConfigPayload()),
        guardarTiemposMarca(),
        guardarPreciosEdredon(),
      ]);
      setConfig(prev => ({ ...prev, ...updated }));
      marcarGuardado('mobile');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    setUploadingLogo(true);
    setMensaje(null);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const token = almacenSesion.getItem('token');
      const res = await fetch('/api/ajustes/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        // Respuesta sin JSON (p. ej. el proxy rechaza el archivo por tamaño).
      }
      if (!res.ok) throw new Error(mensajeDeError(res.status, data));
      setConfig(prev => ({ ...prev, logo_url: data.logo_url }));
      setLogoPreview(data.logo_url);
      marcarGuardado('logo');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  // Sucursal actualmente seleccionada para editar en el selector.
  const sucursalActual = sucursales.find(s => s.slug === sucursalSel) || null;

  // ── Desktop: secciones tipo card ──
  const seccionPerfilDesktop = (
    <Section titulo="Mi Perfil">
      <Field label="Tipo de Cuenta">
        <input
          type="text"
          readOnly
          value={ROL_LABEL[usuario?.rol] ?? (usuario?.rol ?? '')}
          className={`${INPUT_CLS} bg-gray-50 text-gray-500`}
        />
      </Field>

      <Field label="Nombre">
        <input
          type="text"
          name="nombre"
          value={perfilForm.nombre}
          onChange={handlePerfilChange}
          readOnly={soloConsultaPruebas}
          className={soloConsultaPruebas ? `${INPUT_CLS} bg-gray-50 text-gray-500` : INPUT_CLS}
        />
      </Field>

      <Field label="Apellido">
        <input
          type="text"
          name="apellido"
          value={perfilForm.apellido}
          onChange={handlePerfilChange}
          readOnly={soloConsultaPruebas}
          className={soloConsultaPruebas ? `${INPUT_CLS} bg-gray-50 text-gray-500` : INPUT_CLS}
        />
      </Field>

      {/* La contraseña no se consulta: en pruebas no hay nada que enseñar. */}
      {!soloConsultaPruebas && (
      <Field label="Contraseña">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={perfilForm.password}
            onChange={handlePerfilChange}
            placeholder="••••••••"
            className={`${INPUT_CLS} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? SectionIcon.eyeOff : SectionIcon.eye}
          </button>
        </div>
      </Field>
      )}
    </Section>
  );

  // Helpers de renglón (invocados como función, NO como <Componente/>, para
  // no remontar los inputs y perder el foco al teclear).
  const campoPrecio = (name, hint, required = true) => (
    <Field label="Precio por carga" hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 flex-shrink-0">$</span>
        <input
          type="number" name={name} min="0" step="0.01" required={required}
          value={config[name] ?? ''} onChange={handleChange} className={INPUT_CLS}
        />
        <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0)}
      </div>
    </Field>
  );
  const campoTiempo = (name, hint, label = 'Tope de carga') => (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number" name={name} min="1" step="1" required
          value={config[name] ?? ''} onChange={handleChange} className={INPUT_CLS}
        />
        <span className="text-sm text-gray-500 flex-shrink-0">min</span>
        {stepBtns(name, 1, 1)}
      </div>
    </Field>
  );
  // Un renglón por modelo de ese tipo+tamaño. Van debajo del tiempo general,
  // que se queda de respaldo: la duración es de la MÁQUINA (una LG mediana
  // tarda 45 y una Speed Queen jumbo 35), pero mientras una máquina no tenga
  // modelo capturado no hay de dónde sacarla.
  const camposTiempoMarca = (tipo, tamano) => {
    const lista = tiemposDe(tipo, tamano);
    if (lista.length === 0) return null;
    return lista.map(t => (
      <Field
        key={claveTiempo(t)}
        label={etiquetaTiempo(t)}
        hint={ayudaTiempo(t)}
      >
        <div className="flex items-center gap-2">
          <input
            type="number" min="1" step="1" value={t.minutos ?? ''}
            onChange={e => setMinutosMarca(claveTiempo(t), e.target.value)}
            className={INPUT_CLS}
          />
          <span className="text-sm text-gray-500 flex-shrink-0">min</span>
          {stepBtnsMarca(claveTiempo(t))}
        </div>
        {camposOtrosTiempos(t, INPUT_CLS, 'text-sm text-gray-500')}
      </Field>
    ));
  };

  const subTitulo = (txt) => <TituloGrupo>{txt}</TituloGrupo>;

  const seccionPreciosDesktop = (
    <>
    <Section titulo="Lavadora">
      {subTitulo('Mediana')}
      {campoPrecio('precio_carga_mediana', 'Aplica a lavadoras medianas en autoservicio y por encargo.')}
      {campoTiempo('tiempo_carga_mediana', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las lavadoras medianas cuyo modelo no tenga tope propio.')}
      {camposTiempoMarca('lavadora', 'mediana')}

      <div className="border-t border-gray-100" />

      {subTitulo('Jumbo')}
      {campoPrecio('precio_carga_jumbo', 'Aplica a lavadoras jumbo en autoservicio y por encargo.')}
      {campoTiempo('tiempo_carga_jumbo', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las lavadoras jumbo cuyo modelo no tenga tope propio.')}
      {camposTiempoMarca('lavadora', 'jumbo')}

      <div className="border-t border-gray-100" />

      {/* El edredón tiene su propia tarifa de lavadora jumbo, sin tiempo propio
          (usa el tope de la máquina). Se quitó el 2026-10-02 y volvió el mismo
          día a pedido del negocio. */}
      {subTitulo('Edredón')}
      {campoPrecio('precio_edredon_jumbo', 'Tarifa fija por edredón lavado en máquina jumbo.')}
    </Section>

    {/* La secadora va separada en Mediana y Jumbo igual que la lavadora. El
        precio es de la CARGA (una carga jumbo se seca más cara aunque la
        secadora sea la misma); el tiempo es de la MÁQUINA. Las dos columnas
        existen desde la mig. 051. */}
    <Section titulo="Secadora">
      {subTitulo('Mediana')}
      {campoPrecio('precio_carga_secadora', 'Precio del secado de una carga mediana.')}
      {campoTiempo('tiempo_carga_secadora', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las secadoras medianas cuyo modelo no tenga tope propio.')}
      {camposTiempoMarca('secadora', 'mediana')}

      <div className="border-t border-gray-100" />

      {subTitulo('Jumbo')}
      {campoPrecio('precio_secadora_jumbo', 'Precio del secado de una carga jumbo.')}
      {campoTiempo('tiempo_secadora_jumbo', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las secadoras jumbo cuyo modelo no tenga tope propio.')}
      {camposTiempoMarca('secadora', 'jumbo')}
    </Section>

    {/* El catálogo va al final: los tiempos de arriba son del día a día y esto
        se toca cuando entra una máquina nueva. */}
    <Section titulo="Marcas y modelos">
      <MarcasYModelos onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
    </Section>
    </>
  );

  // Lo que el servicio trae puesto al agregarlo a una nota (mig. 132): medidas
  // de cada granel ligado a él y bolsas. Qué granel y qué bolsa se ligan en
  // Inventario; aquí solo cuántas.
  const camposPrecarga = (medidas, bolsas, mobile = false) => {
    const Campo = mobile ? MobileField : Field;
    const cls = mobile ? MOBILE_INPUT_CLS : INPUT_CLS;
    const uno = (name, label, hint) => (
      <Campo label={label} hint={hint}>
        <div className="flex items-center gap-2">
          <input type="number" name={name} min="0" step="1"
            value={config[name] ?? ''} onChange={handleChange}
            className={`${cls} ${precargaInvalida(name) ? 'border-red-300' : ''}`} />
          {stepBtns(name, 1, 0, mobile)}
        </div>
      </Campo>
    );
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {uno(medidas, 'Medidas de granel', 'De cada granel ligado a este servicio.')}
        {uno(bolsas, 'Bolsas', 'De la bolsa ligada a este servicio.')}
      </div>
    );
  };

  // Renglón del precio de un servicio Por Encargo. Es obligatorio: vacío se
  // marca en rojo aquí y el backend lo rechaza al guardar.
  const campoPrecioServicio = (name, label, servicio) => (
    <Field
      label={<>{label} <span className="text-red-500">*</span></>}
      hint={`Lo que se cobra por un servicio ${servicio}. Incluye lavado, secado, jabón y bolsa.`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 flex-shrink-0">$</span>
        <input type="number" name={name} min="0" step="0.01"
          value={config[name] ?? ''} onChange={handleChange}
          className={`${INPUT_CLS} ${sinPrecioServicio(name) ? 'border-red-300' : ''}`} />
        <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0)}
      </div>
      {sinPrecioServicio(name) && (
        <p className="mt-1.5 text-xs text-red-600">
          Sin precio no se puede vender este servicio.
        </p>
      )}
    </Field>
  );

  const seccionCargasPreciosDesktop = (
    <>
    <Section titulo="Precio de los servicios Por Encargo">
      <p className="text-sm text-gray-500 -mt-1">
        Lo que se cobra por cada servicio, ya con su lavado, su secado, el jabón y la bolsa
        dentro. En la nota se multiplica por la cantidad de servicios; los productos que el
        cliente compre aparte y el ajuste manual se suman encima.
      </p>
      <div className="space-y-4">
        {preciosServicio.map(([name, label, servicio, medidas, bolsas]) => (
          <div key={name} className="rounded-xl border border-gray-200 px-5 py-4 space-y-4">
            {campoPrecioServicio(name, label, servicio)}
            {camposPrecarga(medidas, bolsas)}
          </div>
        ))}
      </div>
    </Section>

    </>
  );

  const seccionSucursalesDesktop = (
    <Section titulo="Información de sucursales">
      {/* Datos globales del negocio (marca compartida) */}
      <TituloGrupo>Negocio (global)</TituloGrupo>
      <Field label="Nombre del negocio">
        <input
          type="text"
          name="nombre_negocio"
          required
          value={config.nombre_negocio ?? ''}
          onChange={handleChange}
          disabled={ES_DEMO}
          className={`${INPUT_CLS} disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
        {ES_DEMO && <p className="text-xs text-gray-400 mt-1">{NOTA_DEMO}</p>}
      </Field>

      {/* R.F.C. del negocio: opcional */}
      <Field label="R.F.C.">
        <input
          type="text"
          name="rfc"
          value={config.rfc ?? ''}
          onChange={handleChange}
          placeholder="Opcional"
          disabled={ES_DEMO}
          className={`${INPUT_CLS} disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </Field>

      {!ES_DEMO && (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoPreview ? (
              <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              SectionIcon.imagePlaceholder
            )}
          </div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60 transition-colors ${
                guardadoOk === 'logo' ? 'border-green-300 text-green-700' : 'border-gray-300 text-gray-600'
              }`}
            >
              {uploadingLogo ? (
                <>
                  <div className="w-4 h-4 border-2 border-blue border-t-transparent rounded-full animate-spin" />
                  Subiendo...
                </>
              ) : guardadoOk === 'logo' ? (
                <>
                  <IconoGuardado />
                  Logo actualizado
                </>
              ) : (
                'Cambiar logo'
              )}
            </button>
            <p className="text-xs text-gray-400">JPG, PNG o WebP · Máx. 2 MB</p>
          </div>
        </div>
      </div>
      )}

      {/* Gestión de sucursales */}
      <div className="border-t border-gray-100 pt-8 mt-4 space-y-6">
        <div className="flex items-center justify-between">
          <TituloGrupo>Sucursales</TituloGrupo>
          <button
            type="button"
            onClick={() => { setAgregando(a => !a); setMensaje(null); }}
            className={`flex-shrink-0 flex items-center gap-1.5 rounded-pill border-[1.5px] bg-white pl-2.5 pr-3.5 py-2 text-sm font-bold transition-colors ${
              agregando
                ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'border-blue text-blue hover:bg-light-blue'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d={agregando ? 'M6 18L18 6M6 6l12 12' : 'M12 4v16m8-8H4'}
              />
            </svg>
            {agregando ? 'Cancelar' : 'Agregar sucursal'}
          </button>
        </div>

        {agregando && (
          <div className="rounded-lg border border-blue/30 bg-light-blue/20 p-4 space-y-3">
            <Field label="Nombre de la nueva sucursal">
              <input
                type="text"
                value={nuevaSucursal.nombre}
                onChange={(e) => handleNuevaChange('nombre', e.target.value)}
                placeholder="Ej. Sucursal Centro"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Dirección">
              <input
                type="text"
                value={nuevaSucursal.direccion}
                onChange={(e) => handleNuevaChange('direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={nuevaSucursal.telefono}
                onChange={(e) => handleNuevaChange('telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={INPUT_CLS}
              />
            </Field>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={agregarSucursal}
                disabled={creando}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creando ? 'Creando...' : 'Crear sucursal'}
              </button>
            </div>
          </div>
        )}

        <Field label="Sucursal a editar">
          <Selector
            claseCampo={INPUT_CLS}
            valor={sucursalSel}
            onChange={setSucursalSel}
            titulo="Sucursal a editar"
            opciones={sucursales.map(s => ({
              valor: s.slug, etiqueta: s.nombre, detalle: s.activa ? null : 'inactiva',
            }))}
          />
        </Field>

        {sucursalActual && (
          <>
            <Field label="Nombre de la sucursal">
              <input
                type="text"
                value={sucursalActual.nombre ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'nombre', e.target.value)}
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Dirección">
              <input
                type="text"
                value={sucursalActual.direccion ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={sucursalActual.telefono ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={INPUT_CLS}
              />
            </Field>
            {/* Los datos de la sucursal se guardan con "Guardar cambios" al pie.
                Aquí solo queda activar/desactivar (Admin Main). */}
            {esMain && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => sucursalActual.activa
                    ? setConfirmarDesactivar(sucursalActual)
                    : toggleActivaSucursal(sucursalActual.slug, true)}
                  disabled={cambiandoActiva === sucursalActual.slug}
                  className={`text-sm font-medium disabled:opacity-60 ${
                    sucursalActual.activa ? 'text-red hover:opacity-80' : 'text-green hover:opacity-80'
                  }`}
                >
                  {cambiandoActiva === sucursalActual.slug
                    ? 'Aplicando...'
                    : sucursalActual.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
                </button>
              </div>
            )}
          </>
        )}

        <Field label="Orden de las sucursales" hint="Arrastra para cambiar cómo aparecen en el selector.">
          <SucursalesOrden sucursales={sucursales} setSucursales={setSucursales} onMensaje={setMensaje} />
        </Field>
      </div>
    </Section>
  );

  const seccionAlertasDesktop = (
    <Section titulo="Alertas y Notificaciones">
      {/* El mínimo global de stock se quitó (2026-10-03): cada producto lleva
          el suyo en Inventario y el global ya no entraba en ningún cálculo. */}
      <ToggleRow
        label="Avisar cuando se detenga un ciclo"
        hint="Cuando alguien detenga una máquina con 'Detener ciclo', aparecerá una alerta en el Dashboard."
        checked={!!config.alerta_ciclo_detenido}
        onChange={(v) => setConfig(prev => ({ ...prev, alerta_ciclo_detenido: v }))}
      />
    </Section>
  );

  const seccionEtiquetasDesktop = (
    <Section titulo="Etiquetas de encargo">
      <Field label="Tipos de tela" hint="Se ofrecen al crear un encargo de Ropa. Solo son etiquetas internas; no cambian el precio.">
        <CatalogoEtiquetas endpoint="/etiquetas/tipos-tela" singular="Tela" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
      </Field>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Tamaños de edredón" hint="Cada tamaño es un servicio Edredón con su propio precio, que se captura en Servicios Por Encargo.">
          <CatalogoEtiquetas endpoint="/etiquetas/tamanos-edredon" singular="Tamaño" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </Field>
      </div>
    </Section>
  );

  const AYUDA_TIPOS = 'Jabón, Suavizante… Se elige en cada producto granel, en Inventario. Cada servicio Por Encargo lleva las medidas que diga Ajustes de cada tipo, y en Salidas el empleado elige cuál producto de ese tipo usa.';
  const AYUDA_GRANEL = 'Los líquidos que se venden a granel. Se eligen como nombre del producto cuando se rellena desde un bidón.';

  const seccionInventarioDesktop = (
    <Section titulo="Inventario">
      <Field label="Marcas" hint="Se ofrecen al crear un producto. Desactivar una opción la quita de la lista sin afectar a los productos que ya la usan.">
        <CatalogoEtiquetas endpoint="/etiquetas/marcas-producto" singular="Marca" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
      </Field>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Envases" hint="Se ofrecen al capturar el envase de un producto por medida.">
          <CatalogoEtiquetas endpoint="/etiquetas/envases-producto" singular="Envase" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </Field>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Tipos de granel" hint={AYUDA_TIPOS}>
          <CatalogoEtiquetas endpoint="/etiquetas/tipos-granel" singular="Tipo" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </Field>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Granel" hint={AYUDA_GRANEL}>
          <CatalogoEtiquetas endpoint="/etiquetas/graneles-producto" singular="Granel" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </Field>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Bolsas" hint="Los tamaños de bolsa. A qué servicios va ligada cada bolsa se elige en Inventario, y cuántas trae cada servicio en Servicios Por Encargo; cualquier otra bolsa se puede agregar a mano en la nota.">
          <CatalogoEtiquetas endpoint="/etiquetas/tamanos-bolsa" singular="Tamaño" inputCls={INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </Field>
      </div>
    </Section>
  );

  const seccionTicketDesktop = (
    <Section titulo="Ticket">
      {ES_DEMO && <p className="text-xs text-gray-400 -mt-2">{NOTA_DEMO}</p>}
      <Field
        label="Nota para Autoservicio"
        hint="Se imprime en letra chica al final del ticket que se manda al cliente."
      >
        <textarea
          name="ticket_nota_autoservicio"
          rows={5}
          value={config.ticket_nota_autoservicio ?? ''}
          onChange={handleChange}
          placeholder="Opcional"
          disabled={ES_DEMO}
          className={`${INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </Field>
      <div className="border-t border-gray-100 pt-4">
        <Field
          label="Nota para Por Encargo y Edredón"
          hint="Se imprime en letra chica al final del ticket que se manda al cliente."
        >
          <textarea
            name="ticket_nota_encargo"
            rows={5}
            value={config.ticket_nota_encargo ?? ''}
            onChange={handleChange}
            placeholder="Opcional"
            disabled={ES_DEMO}
            className={`${INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
          />
        </Field>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <Field
          label="Nota para Productos"
          hint="Solo para las ventas de productos, que no llevan lavado ni secado. Si se deja vacía, ese ticket termina sin nota."
        >
          <textarea
            name="ticket_nota_productos"
            rows={5}
            value={config.ticket_nota_productos ?? ''}
            onChange={handleChange}
            placeholder="Opcional"
            disabled={ES_DEMO}
            className={`${INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
          />
        </Field>
      </div>
    </Section>
  );

  // ── Mobile: contenido por sección ──
  const seccionPerfilMobile = (
    <div className="space-y-5">
      <MobileField label="Tipo de Cuenta">
        <input
          type="text"
          readOnly
          value={ROL_LABEL[usuario?.rol] ?? (usuario?.rol ?? '')}
          className={`${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey`}
        />
      </MobileField>

      <MobileField label="Nombre">
        <input
          type="text"
          name="nombre"
          value={perfilForm.nombre}
          onChange={handlePerfilChange}
          readOnly={soloConsultaPruebas}
          className={soloConsultaPruebas ? `${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey` : MOBILE_INPUT_CLS}
        />
      </MobileField>

      <MobileField label="Apellido">
        <input
          type="text"
          name="apellido"
          value={perfilForm.apellido}
          onChange={handlePerfilChange}
          readOnly={soloConsultaPruebas}
          className={soloConsultaPruebas ? `${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey` : MOBILE_INPUT_CLS}
        />
      </MobileField>

      {!soloConsultaPruebas && (
      <MobileField label="Contraseña">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={perfilForm.password}
            onChange={handlePerfilChange}
            placeholder="••••••••"
            className={`${MOBILE_INPUT_CLS} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-grey hover:text-dark-blue"
          >
            {showPassword ? SectionIcon.eyeOff : SectionIcon.eye}
          </button>
        </div>
      </MobileField>
      )}
    </div>
  );

  const seccionSucursalesMobile = (
    <div className="space-y-14">
      {/* Datos globales del negocio (marca compartida) */}
      <div className="space-y-8">
        <TituloGrupoMobile>Negocio (global)</TituloGrupoMobile>
        <MobileField label="Nombre del Negocio">
          <input
            type="text"
            name="nombre_negocio"
            required
            value={config.nombre_negocio ?? ''}
            onChange={handleChange}
            disabled={ES_DEMO}
            className={`${MOBILE_INPUT_CLS} disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
          />
          {ES_DEMO && <p className="text-xs text-grey mt-1">{NOTA_DEMO}</p>}
        </MobileField>

        {/* R.F.C. del negocio: opcional */}
        <MobileField label="R.F.C.">
          <input
            type="text"
            name="rfc"
            value={config.rfc ?? ''}
            onChange={handleChange}
            placeholder="Opcional"
            disabled={ES_DEMO}
            className={`${MOBILE_INPUT_CLS} disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
          />
        </MobileField>

        {!ES_DEMO && (
        <MobileField label="Logo">
          <div className="border border-grey/30 rounded-lg p-4 flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border-2 border-dashed border-grey/40 bg-light-blue/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                SectionIcon.imagePlaceholder
              )}
            </div>
            <div className="flex-1 space-y-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className={`px-4 py-2 border rounded-lg text-sm bg-white disabled:opacity-60 flex items-center gap-2 ${
                  guardadoOk === 'logo' ? 'border-green-300 text-green-700' : 'border-grey/40 text-dark-blue'
                }`}
              >
                {uploadingLogo ? 'Subiendo...' : guardadoOk === 'logo' ? (
                  <>
                    <IconoGuardado />
                    Logo actualizado
                  </>
                ) : 'Cambiar logo'}
              </button>
              <p className="text-xs text-grey">JPG, PNG o WebP Max. 2 MB</p>
            </div>
          </div>
        </MobileField>
        )}
      </div>

      {/* Gestión de sucursales */}
      <div className="space-y-8 border-t border-light-blue/60 pt-10">
        <div className="flex items-center justify-between">
          <TituloGrupoMobile>Sucursales</TituloGrupoMobile>
          <button
            type="button"
            onClick={() => { setAgregando(a => !a); setMensaje(null); }}
            className={`flex-shrink-0 flex items-center gap-1.5 rounded-pill border-[1.5px] bg-white pl-2.5 pr-3.5 py-2 text-sm font-bold transition-colors ${
              agregando
                ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'border-blue text-blue hover:bg-light-blue'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d={agregando ? 'M6 18L18 6M6 6l12 12' : 'M12 4v16m8-8H4'}
              />
            </svg>
            {agregando ? 'Cancelar' : 'Agregar'}
          </button>
        </div>

        {agregando && (
          <div className="rounded-lg border border-blue/30 bg-light-blue/20 p-4 space-y-4">
            <MobileField label="Nombre de la nueva sucursal">
              <input
                type="text"
                value={nuevaSucursal.nombre}
                onChange={(e) => handleNuevaChange('nombre', e.target.value)}
                placeholder="Ej. Sucursal Centro"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Dirección">
              <input
                type="text"
                value={nuevaSucursal.direccion}
                onChange={(e) => handleNuevaChange('direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Teléfono">
              <input
                type="tel"
                value={nuevaSucursal.telefono}
                onChange={(e) => handleNuevaChange('telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <button
              type="button"
              onClick={agregarSucursal}
              disabled={creando}
              className="w-full py-3.5 rounded-lg bg-blue text-white text-base font-medium disabled:opacity-60"
            >
              {creando ? 'Creando...' : 'Crear sucursal'}
            </button>
          </div>
        )}

        <MobileField label="Sucursal a editar">
          <Selector
            claseCampo={MOBILE_INPUT_CLS}
            valor={sucursalSel}
            onChange={setSucursalSel}
            titulo="Sucursal a editar"
            opciones={sucursales.map(s => ({
              valor: s.slug, etiqueta: s.nombre, detalle: s.activa ? null : 'inactiva',
            }))}
          />
        </MobileField>

        {sucursalActual && (
          <>
            <MobileField label="Nombre de la sucursal">
              <input
                type="text"
                value={sucursalActual.nombre ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'nombre', e.target.value)}
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Dirección">
              <input
                type="text"
                value={sucursalActual.direccion ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Teléfono">
              <input
                type="tel"
                value={sucursalActual.telefono ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            {/* Los datos de la sucursal se guardan con el botón "Guardar" del pie. */}
            {esMain && (
              <button
                type="button"
                onClick={() => sucursalActual.activa
                  ? setConfirmarDesactivar(sucursalActual)
                  : toggleActivaSucursal(sucursalActual.slug, true)}
                disabled={cambiandoActiva === sucursalActual.slug}
                className={`w-full py-3.5 rounded-lg text-base font-medium border disabled:opacity-60 ${
                  sucursalActual.activa
                    ? 'border-red/40 text-red'
                    : 'border-green/40 text-green'
                }`}
              >
                {cambiandoActiva === sucursalActual.slug
                  ? 'Aplicando...'
                  : sucursalActual.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
              </button>
            )}
          </>
        )}

        <MobileField label="Orden de las sucursales" hint="Arrastra para cambiar cómo aparecen en el selector.">
          <SucursalesOrden sucursales={sucursales} setSucursales={setSucursales} onMensaje={setMensaje} />
        </MobileField>
      </div>
    </div>
  );

  // Helpers de renglón móvil (invocados como función, no como <Componente/>).
  const campoPrecioM = (name, hint, required = true) => (
    <MobileField label="Precio por carga" hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-base text-grey flex-shrink-0">$</span>
        <input
          type="number" name={name} min="0" step="0.01" required={required}
          value={config[name] ?? ''} onChange={handleChange} className={MOBILE_INPUT_CLS}
        />
        <span className="text-base text-grey flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0, true)}
      </div>
    </MobileField>
  );
  const campoTiempoM = (name, hint, label = 'Tope de carga') => (
    <MobileField label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number" name={name} min="1" step="1" required
          value={config[name] ?? ''} onChange={handleChange} className={MOBILE_INPUT_CLS}
        />
        <span className="text-base text-grey flex-shrink-0">min</span>
        {stepBtns(name, 1, 1, true)}
      </div>
    </MobileField>
  );
  const camposTiempoMarcaM = (tipo, tamano) => {
    const lista = tiemposDe(tipo, tamano);
    if (lista.length === 0) return null;
    return lista.map(t => (
      <MobileField
        key={claveTiempo(t)}
        label={etiquetaTiempo(t)}
        hint={ayudaTiempo(t)}
      >
        <div className="flex items-center gap-2">
          <input
            type="number" min="1" step="1" value={t.minutos ?? ''}
            onChange={e => setMinutosMarca(claveTiempo(t), e.target.value)}
            className={MOBILE_INPUT_CLS}
          />
          <span className="text-base text-grey flex-shrink-0">min</span>
          {stepBtnsMarca(claveTiempo(t), true)}
        </div>
        {camposOtrosTiempos(t, MOBILE_INPUT_CLS, 'text-base text-grey')}
      </MobileField>
    ));
  };

  const seccionPreciosMobile = (
    <div className="space-y-10">
      <div className="space-y-6">
        <TituloGrupoMobile>Lavadora</TituloGrupoMobile>
        <div className="space-y-4">
        <TarjetaMobile titulo="Mediana">
          {campoPrecioM('precio_carga_mediana', 'Aplica a lavadoras medianas (autoservicio y por encargo).')}
          {campoTiempoM('tiempo_carga_mediana', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las lavadoras medianas cuyo modelo no tenga tope propio.')}
          {camposTiempoMarcaM('lavadora', 'mediana')}
        </TarjetaMobile>
        <TarjetaMobile titulo="Jumbo">
          {campoPrecioM('precio_carga_jumbo', 'Aplica a lavadoras jumbo (autoservicio y por encargo).')}
          {campoTiempoM('tiempo_carga_jumbo', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las lavadoras jumbo cuyo modelo no tenga tope propio.')}
          {camposTiempoMarcaM('lavadora', 'jumbo')}
        </TarjetaMobile>
        {/* La tarifa del edredón en lavadora jumbo (volvió el 2026-10-02). */}
        <TarjetaMobile titulo="Edredón">
          {campoPrecioM('precio_edredon_jumbo', 'Tarifa fija por edredón lavado en máquina jumbo.')}
        </TarjetaMobile>
        </div>
      </div>

      <div className="border-t border-light-blue/60 pt-8 space-y-6">
        <TituloGrupoMobile>Secadora</TituloGrupoMobile>
        <div className="space-y-4">
        <TarjetaMobile titulo="Mediana">
          {campoPrecioM('precio_carga_secadora', 'Precio del secado de una carga mediana.')}
          {campoTiempoM('tiempo_carga_secadora', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las secadoras medianas cuyo modelo no tenga tope propio.')}
          {camposTiempoMarcaM('secadora', 'mediana')}
        </TarjetaMobile>
        <TarjetaMobile titulo="Jumbo">
          {campoPrecioM('precio_secadora_jumbo', 'Precio del secado de una carga jumbo.')}
          {campoTiempoM('tiempo_secadora_jumbo', 'Si nadie finaliza la máquina, a estos minutos se le corta la luz. Para las secadoras jumbo cuyo modelo no tenga tope propio.')}
          {camposTiempoMarcaM('secadora', 'jumbo')}
        </TarjetaMobile>
        </div>
      </div>

      {/* El catálogo va al final: los tiempos de arriba son del día a día y
          esto se toca cuando entra una máquina nueva. */}
      <div className="border-t border-light-blue/60 pt-8 space-y-6">
        <TituloGrupoMobile>Marcas y modelos</TituloGrupoMobile>
        <TarjetaMobile>
          <MarcasYModelos movil onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </TarjetaMobile>
      </div>
    </div>
  );

  const campoPrecioServicioM = (name, label, servicio) => (
    <MobileField
      label={<>{label} <span className="text-red-500">*</span></>}
      hint={`Lo que se cobra por un servicio ${servicio}. Incluye lavado, secado, jabón y bolsa.`}
    >
      <div className="flex items-center gap-2">
        <span className="text-base text-grey flex-shrink-0">$</span>
        <input type="number" name={name} min="0" step="0.01"
          value={config[name] ?? ''} onChange={handleChange}
          className={`${MOBILE_INPUT_CLS} ${sinPrecioServicio(name) ? 'border-red-300' : ''}`} />
        <span className="text-base text-grey flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0, true)}
      </div>
      {sinPrecioServicio(name) && (
        <p className="mt-1.5 text-xs text-red-600">
          Sin precio no se puede vender este servicio.
        </p>
      )}
    </MobileField>
  );

  const seccionCargasPreciosMobile = (
    <div className="space-y-10">
      <div className="space-y-6">
        <div className="space-y-1.5">
          <TituloGrupoMobile>Precio de los servicios Por Encargo</TituloGrupoMobile>
          <p className="text-sm text-grey">
            Lo que se cobra por cada servicio, ya con su lavado, su secado, el jabón y la bolsa
            dentro. En la nota se multiplica por la cantidad de servicios; los productos que el
            cliente compre aparte y el ajuste manual se suman encima.
          </p>
        </div>
        {/* Una tarjeta por servicio: son precios independientes entre sí y
            apelotonarlos en un bloque los hacía leer como una lista. */}
        <div className="space-y-4">
          {preciosServicio.map(([name, label, servicio, medidas, bolsas]) => (
            <TarjetaMobile key={name}>
              {campoPrecioServicioM(name, label, servicio)}
              {camposPrecarga(medidas, bolsas, true)}
            </TarjetaMobile>
          ))}
        </div>
      </div>

    </div>
  );

  const seccionAlertasMobile = (
    <div className="space-y-6">
      <ToggleRow
        label="Avisar cuando se detenga un ciclo"
        hint="Cuando alguien detenga una máquina con 'Detener ciclo', aparecerá una alerta en el Dashboard."
        checked={!!config.alerta_ciclo_detenido}
        onChange={(v) => setConfig(prev => ({ ...prev, alerta_ciclo_detenido: v }))}
      />
    </div>
  );

  const seccionEtiquetasMobile = (
    <div className="space-y-6">
      <MobileField
        label="Tipos de tela"
        hint="Se ofrecen al crear un encargo de Ropa. Solo son etiquetas internas; no cambian el precio."
      >
        <CatalogoEtiquetas endpoint="/etiquetas/tipos-tela" singular="Tela" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
      </MobileField>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField
          label="Tamaños de edredón"
          hint="Cada tamaño es un servicio Edredón con su propio precio, que se captura en Servicios Por Encargo."
        >
          <CatalogoEtiquetas endpoint="/etiquetas/tamanos-edredon" singular="Tamaño" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </MobileField>
      </div>
    </div>
  );

  const seccionInventarioMobile = (
    <div className="space-y-6">
      <MobileField
        label="Marcas"
        hint="Se ofrecen al crear un producto. Desactivar una opción la quita de la lista sin afectar a los productos que ya la usan."
      >
        <CatalogoEtiquetas endpoint="/etiquetas/marcas-producto" singular="Marca" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
      </MobileField>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField
          label="Envases"
          hint="Se ofrecen al capturar el envase de un producto por medida."
        >
          <CatalogoEtiquetas endpoint="/etiquetas/envases-producto" singular="Envase" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </MobileField>
      </div>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField label="Tipos de granel" hint={AYUDA_TIPOS}>
          <CatalogoEtiquetas endpoint="/etiquetas/tipos-granel" singular="Tipo" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </MobileField>
      </div>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField label="Granel" hint={AYUDA_GRANEL}>
          <CatalogoEtiquetas endpoint="/etiquetas/graneles-producto" singular="Granel" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </MobileField>
      </div>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField
          label="Bolsas"
          hint="Los tamaños de bolsa. A qué servicios va ligada cada bolsa se elige en Inventario, y cuántas trae cada servicio en Servicios Por Encargo; cualquier otra bolsa se puede agregar a mano en la nota."
        >
          <CatalogoEtiquetas endpoint="/etiquetas/tamanos-bolsa" singular="Tamaño" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} soloConsulta={soloConsultaPruebas} />
        </MobileField>
      </div>
    </div>
  );

  // Ayuda de los comodines, compartida por escritorio y móvil: se escribe una
  // vez y sale de COMODINES_WHATSAPP, así que añadir uno nuevo no obliga a
  // tocar la pantalla.
  const ayudaComodines = (
    <>
      Se manda desde el botón <span className="font-medium">Procesado</span> de una nota
      Por Encargo, al número del cliente. Entre asteriscos puedes poner:
      <span className="block mt-1.5 space-y-0.5">
        {COMODINES_WHATSAPP.map(c => (
          <span key={c.clave} className="block">
            <code className="font-mono text-gray-700">*{c.clave}*</code> — {c.descripcion}
          </span>
        ))}
      </span>
    </>
  );

  const seccionWhatsappDesktop = (
    <Section titulo="WhatsApp">
      {ES_DEMO && <p className="text-xs text-gray-400 -mt-2">{NOTA_DEMO}</p>}
      <Field label="Mensaje para Por Encargo" hint={ayudaComodines}>
        <textarea
          name="whatsapp_mensaje_encargo"
          rows={6}
          value={config.whatsapp_mensaje_encargo ?? ''}
          onChange={handleChange}
          placeholder="Hola *Nombre*, tu ropa de las *Tiempo* ya está lista."
          disabled={ES_DEMO}
          className={`${INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </Field>
      <PreviaWhatsapp plantilla={config.whatsapp_mensaje_encargo} />
    </Section>
  );

  const seccionTicketMobile = (
    <div className="space-y-6">
      {ES_DEMO && <p className="text-xs text-grey">{NOTA_DEMO}</p>}
      <MobileField
        label="Nota para Autoservicio"
        hint="Se imprime en letra chica al final del ticket que se manda al cliente."
      >
        <textarea
          name="ticket_nota_autoservicio"
          rows={6}
          value={config.ticket_nota_autoservicio ?? ''}
          onChange={handleChange}
          placeholder="Opcional"
          disabled={ES_DEMO}
          className={`${MOBILE_INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </MobileField>

      <MobileField
        label="Nota para Por Encargo y Edredón"
        hint="Se imprime en letra chica al final del ticket que se manda al cliente."
      >
        <textarea
          name="ticket_nota_encargo"
          rows={6}
          value={config.ticket_nota_encargo ?? ''}
          onChange={handleChange}
          placeholder="Opcional"
          disabled={ES_DEMO}
          className={`${MOBILE_INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </MobileField>

      <MobileField
        label="Nota para Productos"
        hint="Solo para las ventas de productos, que no llevan lavado ni secado. Si se deja vacía, ese ticket termina sin nota."
      >
        <textarea
          name="ticket_nota_productos"
          rows={6}
          value={config.ticket_nota_productos ?? ''}
          onChange={handleChange}
          placeholder="Opcional"
          disabled={ES_DEMO}
          className={`${MOBILE_INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </MobileField>
    </div>
  );

  const seccionWhatsappMobile = (
    <div className="space-y-6">
      {ES_DEMO && <p className="text-xs text-grey">{NOTA_DEMO}</p>}
      <MobileField label="Mensaje para Por Encargo" hint={ayudaComodines}>
        <textarea
          name="whatsapp_mensaje_encargo"
          rows={7}
          value={config.whatsapp_mensaje_encargo ?? ''}
          onChange={handleChange}
          placeholder="Hola *Nombre*, tu ropa de las *Tiempo* ya está lista."
          disabled={ES_DEMO}
          className={`${MOBILE_INPUT_CLS} resize-y leading-relaxed disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`}
        />
      </MobileField>
      <PreviaWhatsapp plantilla={config.whatsapp_mensaje_encargo} />
    </div>
  );

  const mobileSectionContent = {
    perfil:  seccionPerfilMobile,
    negocio: seccionSucursalesMobile,
    maquinas: seccionPreciosMobile,
    cargas: seccionCargasPreciosMobile,
    alertas: seccionAlertasMobile,
    etiquetas: seccionEtiquetasMobile,
    inventario: seccionInventarioMobile,
    ticket: seccionTicketMobile,
    whatsapp: seccionWhatsappMobile,
    instalar: <InstalarApp variant="mobile" />,
  };

  // Éxitos: banner verde en línea. Errores: modal (igual que autoservicio).
  const mensajeBanner = mensaje?.tipo === 'ok' && (
    <div className="rounded-lg px-4 py-3 text-sm bg-green-50 border border-green-200 text-green-700">
      {mensaje.texto}
    </div>
  );

  const errorModal = mensaje?.tipo === 'error' && (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center space-y-5 animate-shake">
        <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center animate-pop-in">
          <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M6 6L18 18M18 6L6 18"
              style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
              className="animate-draw-x"
            />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-gray-900">Ocurrió un error</h3>
          <p className="text-sm text-gray-500">{mensaje.texto}</p>
        </div>
        <button
          type="button"
          onClick={() => setMensaje(null)}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  );

  const seccionesMobile = [
    ...MOBILE_SECTIONS,
    SECCION_MANUAL,
    ...(sePuedeInstalar ? [SECCION_INSTALAR] : []),
  ];
  const activeSection = seccionesMobile.find((s) => s.id === mobileSection);

  // En pruebas, toda sección que no sea "Mi Perfil" es de consulta: se ve
  // entera, pero sin el pie de Cancelar/Guardar. Un botón que el backend va a
  // rechazar (o peor, que diga "¡Guardado!" sin haber guardado) engaña más de
  // lo que ayuda.
  const seccionDeConsulta = soloConsultaPruebas
    && activeSection && activeSection.id !== 'instalar';

  // Aviso fijo del entorno de pruebas, arriba de la lista de ajustes.
  const avisoPruebas = soloConsultaPruebas && (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-4">
      <p className="font-semibold">Entorno de pruebas</p>
      <p className="mt-1 text-amber-700">
        Estás en la sucursal de pruebas: sus notas, caja e inventario están separados y no afectan al
        negocio real.
      </p>
    </div>
  );

  return (
    <>
      {errorModal}

      {/* ── Vista móvil ── */}
      <div className="md:hidden min-h-full bg-gray-50">
        {!activeSection ? (
          <>
            <div className="bg-white border-b-2 border-gray-200">
              <div className="px-6 pt-10 pb-4 flex flex-col items-start">
                <div className='flex flex-row items-center gap-1'>
                  {SectionIcon.gear}
                  <h1 className="text-xl font-bold text-dark-blue leading-tight">Ajustes</h1>
                </div>
                <p className="text-sm text-grey">Pantalla de ajustes</p>
              </div>
            </div>
            <div className="px-6 py-6 space-y-3">
              {avisoPruebas}
              {seccionesMobile.map((s) => (
                <MobileSectionButton
                  key={s.id}
                  label={s.label}
                  icon={s.icon}
                  onClick={() => (s.id === 'manual' ? navigate('/manual') : setMobileSection(s.id))}
                />
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmitMobile}>
            <div className="bg-white border-b-2 border-gray-200">
              <div className="px-6 pt-10 pb-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileSection(null)}
                  aria-label="Volver"
                  className="w-11 h-11 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center flex-shrink-0 transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
                >
                  {SectionIcon.back}
                </button>
                <div>
                  <h1 className="text-xl font-bold text-dark-blue leading-tight">{activeSection.label}</h1>
                  <p className="text-sm text-grey">{activeSection.subtitle}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-6 space-y-6">
            {/* Arriba y con el estilo del aviso de pruebas: abajo se perdía. */}
            {seccionDeConsulta && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-4">
                <p className="font-semibold">Solo de consulta</p>
                <p className="mt-1 text-amber-700">
                  {activeSection.id === 'perfil'
                    ? 'Las cuentas de prueba son compartidas, así que su perfil no se cambia.'
                    : 'Esta configuración es la del negocio real y no se cambia desde el entorno de pruebas.'}
                </p>
              </div>
            )}

            {mobileSectionContent[activeSection.id]}

            {!seccionDeConsulta && !SECCIONES_SIN_GUARDAR.includes(activeSection.id) && (
            <div className="grid grid-cols-2 gap-3 pt-8">
              <button
                type="button"
                onClick={() => setMobileSection(null)}
                className="border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || guardadoOk === 'mobile'}
                className={`${guardadoOk === 'mobile' ? 'bg-green-600' : 'bg-blue hover:opacity-90'} disabled:opacity-100 text-white font-medium py-3.5 rounded-lg text-base transition-colors flex items-center justify-center gap-2`}
              >
                <ContenidoGuardar saving={saving} ok={guardadoOk === 'mobile'}>Guardar</ContenidoGuardar>
              </button>
            </div>
            )}
            {mensajeBanner}
            </div>
          </form>
        )}
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={handleLogoSelect}
        className="hidden"
      />

      {/* ── Vista desktop ── */}
      <div className="hidden md:block min-h-full bg-gray-50">
        {/* Cabecera (barra superior) */}
        <div className="bg-white border-b-2 border-gray-200">
          <div className="max-w-2xl mx-auto px-6 pt-14 pb-4">
            <h1 className="text-xl font-bold text-gray-900">Ajustes</h1>
          </div>
        </div>

        {/* Contenido */}
        <div className="max-w-2xl mx-auto p-6 space-y-6">

        <div className="space-y-6">
          {avisoPruebas}
          {seccionPerfilDesktop}
        </div>

        <div className="space-y-6">
          {seccionPreciosDesktop}
          {seccionCargasPreciosDesktop}
          {seccionSucursalesDesktop}
          {seccionAlertasDesktop}
          {seccionEtiquetasDesktop}
          {seccionInventarioDesktop}
          {seccionTicketDesktop}
          {seccionWhatsappDesktop}
        </div>

        {/* El manual y la instalación van al final: son acciones, no ajustes
            del negocio. Fuera del bloque de arriba porque también se ofrecen en
            el entorno de pruebas. */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-dark-blue">Manual de uso</h2>
          </div>
          <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-sm text-gray-600 max-w-md">
              Cómo funciona la aplicación, paso a paso, con buscador. Se abre en su
              propia página.
            </p>
            <button
              type="button"
              onClick={() => navigate('/manual')}
              className="flex items-center justify-center gap-2 w-full md:w-auto px-6 py-3.5 bg-blue hover:opacity-90 text-white text-base font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {/* El ícono de la sección es de 28 px: aquí va uno de 20, o el
                  texto del botón se parte en dos renglones. */}
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 6.5C10.5 5.2 8.6 4.7 6 4.8A1 1 0 005 5.8v11.4a1 1 0 001.06 1c2.5-.1 4.4.4 5.94 1.7 1.54-1.3 3.44-1.8 5.94-1.7a1 1 0 001.06-1V5.8a1 1 0 00-1-1c-2.6-.1-4.5.4-6 1.7z" />
                <path strokeLinecap="round" strokeWidth={2} d="M12 6.5V19" />
              </svg>
              Abrir el manual
            </button>
          </div>
        </div>

        <InstalarApp />

        {!soloConsultaPruebas && (
        <div className="space-y-3">
          {mensajeBanner}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleGuardarTodo}
              disabled={saving || guardadoOk === 'todo'}
              className={`flex items-center gap-2 px-6 py-3.5 ${guardadoOk === 'todo' ? 'bg-green-600' : 'bg-blue hover:opacity-90'} disabled:opacity-100 disabled:cursor-not-allowed text-white text-base font-medium rounded-lg transition-colors`}
            >
              <ContenidoGuardar saving={saving} ok={guardadoOk === 'todo'} okLabel="¡Guardado!">Guardar cambios</ContenidoGuardar>
            </button>
          </div>
        </div>
        )}
        </div>
      </div>

      {/* Confirmación para desactivar una sucursal (solo Admin Main) */}
      {confirmarDesactivar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 text-center mb-1">Desactivar sucursal</h3>
              <p className="text-sm text-gray-500 text-center mb-4">
                ¿Seguro que quieres desactivar{' '}
                <span className="font-medium text-gray-700">{confirmarDesactivar.nombre}</span>?
                Dejará de aparecer en la operación, pero su historial (notas, caja y ventas) se conserva
                y podrás reactivarla después.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmarDesactivar(null)}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarDesactivarSucursal}
                  disabled={cambiandoActiva === confirmarDesactivar.slug}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  {cambiandoActiva === confirmarDesactivar.slug ? 'Desactivando...' : 'Desactivar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
