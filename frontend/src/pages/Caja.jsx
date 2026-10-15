import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn, esAdminMain as esAdminMainFn } from '../lib/roles';
import FondoApertura from '../components/FondoApertura';
import RecuadrosCaja from '../components/RecuadrosCaja';
import { desgloseCaja } from '../lib/desgloseCaja';
import MenuExportar from '../components/MenuExportar';
import { formatHora12 } from '../lib/fecha';
import { imprimirCortes, descargarCortesCSV } from '../lib/exportCorte';
import SucursalBar from '../components/SucursalBar';

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

// Íconos de entrada/salida para las filas de apertura y cierre del corte.
function IconEntrada({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
    </svg>
  );
}
function IconSalida({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3h12.75" />
    </svg>
  );
}

// Ej.: 12 de Agosto, 6:57 p.m.
const fmtFechaHora = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const mes = d.toLocaleDateString('es-MX', { month: 'long' });
  const mesCap = mes.charAt(0).toUpperCase() + mes.slice(1);
  const hora = formatHora12(d);
  return `${d.getDate()} de ${mesCap}, ${hora}`;
};

const fmtHora = (fecha) => {
  if (!fecha) return '—';
  return formatHora12(fecha);
};

// Ej.: Lunes, 03 Ago 26
const fmtFechaCorta = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const diaSem = cap(d.toLocaleDateString('es-MX', { weekday: 'long' }));
  const dd = String(d.getDate()).padStart(2, '0');
  const mes = cap(d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''));
  const yy = String(d.getFullYear()).slice(-2);
  return `${diaSem}, ${dd} ${mes} ${yy}`;
};

/** Lunes de la semana de una fecha (clave para agrupar por semana). */
const inicioSemana = (fecha) => {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return d;
};

// ¿Dos fechas caen en el mismo día calendario?
const mismoDia = (a, b) => {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear()
    && x.getMonth() === y.getMonth()
    && x.getDate() === y.getDate();
};
// Nombre del día de la semana capitalizado (Lunes, Martes, …).
const nombreDia = (d) => {
  const s = d.toLocaleDateString('es-MX', { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Encabezado de semana, lunes a domingo: "Semana del 05 - 11 de Enero 2026";
 * con el mes o el año que cruza cuando cambia.
 */
const fmtSemanaHeader = (fecha) => {
  const lunes = inicioSemana(fecha);
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  const dd = (d) => String(d.getDate()).padStart(2, '0');
  const mes = (d) => {
    const m = d.toLocaleDateString('es-MX', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  };
  if (lunes.getFullYear() !== domingo.getFullYear()) {
    return `Semana del ${dd(lunes)} de ${mes(lunes)} ${lunes.getFullYear()} - ${dd(domingo)} de ${mes(domingo)} ${domingo.getFullYear()}`;
  }
  const anio = domingo.getFullYear();
  return lunes.getMonth() === domingo.getMonth()
    ? `Semana del ${dd(lunes)} - ${dd(domingo)} de ${mes(domingo)} ${anio}`
    : `Semana del ${dd(lunes)} de ${mes(lunes)} - ${dd(domingo)} de ${mes(domingo)} ${anio}`;
};

/** Filtros del historial (como en Ventas). Abre en "Hoy"; el mes se elige de un desplegable. */
const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Mes' },
  { id: 'anio',   label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
];

// Nombres de meses capitalizados (Enero … Diciembre).
const MESES = Array.from({ length: 12 }, (_, i) => {
  const m = new Date(2020, i, 1).toLocaleDateString('es-MX', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
});

/** Rango [desde, hasta) del periodo; null = sin filtro (personalizado sin fechas). */
const rangoDePeriodo = (periodo, anio, mes, desde, hasta) => {
  const ahora = new Date();
  const hoy0 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  switch (periodo) {
    case 'hoy':
      return { desde: hoy0, hasta: new Date(hoy0.getTime() + 86400000) };
    case 'semana': {
      const l = inicioSemana(ahora);
      const f = new Date(l); f.setDate(f.getDate() + 7);
      return { desde: l, hasta: f };
    }
    case 'mes':
      return { desde: new Date(anio, mes, 1), hasta: new Date(anio, mes + 1, 1) };
    case 'anio':
      return { desde: new Date(anio, 0, 1), hasta: new Date(anio + 1, 0, 1) };
    case 'custom': {
      if (!desde || !hasta) return null;
      const d = new Date(`${desde}T00:00:00`);
      const h = new Date(`${hasta}T00:00:00`); h.setDate(h.getDate() + 1);
      return { desde: d, hasta: h };
    }
    default:
      return null;
  }
};

/** Pestañas. "Corte" abre la caja si está cerrada y hace el corte si está abierta. */
const TABS = [
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'corte',       label: 'Corte' },
  { id: 'historial',   label: 'Historial' },
];

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
      {message}
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="text-sm text-gray-400 text-center py-10">{children}</p>;
}

// ── Apertura (se ve dentro de Corte con la caja cerrada) ───────
function Apertura({ data, onAbrir }) {
  const { usuario } = useAuth();
  const admin = esAdminFn(usuario?.rol);
  const sugerida = data?.apertura_sugerida ?? null;
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // La caja inicial viene del corte anterior. Se ajusta durante el render (no en
  // un efecto) cuando cambia ese corte; la clave evita repetirlo y respeta lo que
  // se escriba.
  const claveSugerida = sugerida ? `${sugerida.corte?.id ?? ''}:${sugerida.monto}` : null;
  const [claveAplicada, setClaveAplicada] = useState(null);
  if (claveSugerida && claveSugerida !== claveAplicada) {
    setClaveAplicada(claveSugerida);
    setMonto(String(sugerida.monto));
  }

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/abrir', { monto_inicial: Number(monto), notas });
      setNotas('');
      onAbrir();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-500">No hay una caja abierta.</p>
      <ErrorBox message={error} />
      <FondoApertura sugerida={sugerida} admin={admin} monto={monto} onMonto={setMonto} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nota (opcional)</label>
        <textarea
          rows={4} value={notas} onChange={(e) => setNotas(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base resize-y min-h-[6rem]"
        />
      </div>
      <button
        type="submit" disabled={saving || (!sugerida && !admin)}
        className="w-full bg-blue hover:bg-blue/90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
      >
        {saving ? 'Abriendo…' : 'Abrir caja'}
      </button>
    </form>
  );
}

// ── Movimientos ─────────────────────────────────────────────
function Movimientos({ data, onChange }) {
  const { usuario } = useAuth();
  // El empleado solo registra gastos; las entradas son de admin (el servidor
  // también lo exige).
  const puedeEntrada = esAdminFn(usuario?.rol);
  const [tipo, setTipo] = useState('salida');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!data?.abierta) {
    return <EmptyState>Abre la caja en Corte para registrar movimientos.</EmptyState>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/movimientos', { tipo, concepto, monto: Number(monto) });
      setConcepto('');
      setMonto('');
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const movimientos = data.movimientos ?? [];

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div className="flex gap-2">
          {[
            { id: 'salida',  label: 'Gasto' },   // en la base sigue siendo 'salida'
            ...(puedeEntrada ? [{ id: 'entrada', label: 'Entrada' }] : []),
          ].map((t) => (
            <button
              key={t.id} type="button" onClick={() => setTipo(t.id)}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tipo === t.id
                  ? (t.id === 'salida' ? 'bg-red-600 text-white' : 'bg-green-600 text-white')
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Concepto</label>
          <input
            type="text" required value={concepto} onChange={(e) => setConcepto(e.target.value)}
            placeholder="Ej. Compra de detergente"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
          <input
            type="number" min="0.01" step="0.01" required value={monto} onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          />
        </div>
        <button
          type="submit" disabled={saving}
          className="w-full bg-blue hover:bg-blue/90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Registrar movimiento'}
        </button>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">Movimientos de la sesión</h2>
        </div>
        {movimientos.length === 0 ? (
          <EmptyState>Sin movimientos registrados.</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {movimientos.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.concepto}</p>
                  <p className="text-xs text-gray-400">{m.usuario} · {fmtFechaHora(m.created_at)}</p>
                </div>
                <span className={`text-sm font-semibold ${m.tipo === 'salida' ? 'text-red-600' : 'text-green-600'}`}>
                  {m.tipo === 'salida' ? '−' : '+'}{fmt(m.monto)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Corte ───────────────────────────────────────────────────
function Corte({ data, onCerrar, onAbrir }) {
  const { usuario } = useAuth();
  const [contado, setContado] = useState('');
  // Reparto de lo contado: caja final (se queda y abre el siguiente turno) y sobre.
  const [cajaFinal, setCajaFinal] = useState('');
  const [sobre, setSobre] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(false); // animación de "caja cerrada"

  // Con la caja cerrada, la pestaña sirve para abrirla.
  if (!data?.abierta) {
    return <Apertura data={data} onAbrir={onAbrir} />;
  }

  const { caja, totales } = data;
  const contadoNum = Number(contado);
  const diferencia = contado === '' ? null : contadoNum - totales.esperado;

  // Caja final y sobre suman lo contado: al escribir uno se calcula el otro. Si
  // cambia lo contado, se respeta la caja final y se ajusta el sobre.
  const centavos = (n) => Math.round(n * 100) / 100;
  const resto = (total, parte) => (
    total === '' || parte === '' ? '' : String(centavos(Number(total) - Number(parte)))
  );
  const cambiarContado = (v) => {
    setContado(v);
    if (cajaFinal !== '') setSobre(resto(v, cajaFinal));
  };
  const cambiarCajaFinal = (v) => { setCajaFinal(v); setSobre(resto(contado, v)); };
  const cambiarSobre     = (v) => { setSobre(v); setCajaFinal(resto(contado, v)); };
  const repartoFalta = contado !== '' && (cajaFinal === '' || sobre === '');
  const repartoMal = contado !== '' && !repartoFalta && (
    Number(cajaFinal) < 0 || Number(sobre) < 0
    || Math.abs(Number(cajaFinal) + Number(sobre) - contadoNum) >= 0.005
  );

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/cerrar', {
        monto_contado: contadoNum, notas_cierre: notas,
        monto_caja_final: Number(cajaFinal), monto_sobre: Number(sobre),
      });
      setContado('');
      setCajaFinal('');
      setSobre('');
      setNotas('');
      // La animación de éxito, un momento antes de salir.
      setExito(true);
      setTimeout(() => onCerrar(), 1800);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  // Solo el efectivo entra al cajón; transferencia y tarjeta se informan en
  // "Cómo se cobró".
  const desglose = totales.ventas_desglose ?? {
    total: totales.ventas, efectivo: totales.ventas, transferencia: 0, tarjeta: 0,
  };

  // Ingresos, Egresos y Desglose: las mismas líneas que Ventas y las
  // exportaciones (lib/desgloseCaja.js).
  const turno = {
    monto_inicial:   caja.monto_inicial,
    entradas:        totales.entradas,
    salidas:         totales.salidas,
    ventas_desglose: desglose,
    ingresos:        totales.ingresos ?? null,
    spe_debe:        totales.egresos?.por_encargo_pendiente ?? null,
  };
  // El turno abierto con la forma del historial, para exportarlo (sin conteo).
  const turnoExportable = {
    ...turno,
    id:               caja.id,
    en_curso:         true,
    abierta_at:       caja.abierta_at,
    usuario_apertura: caja.usuario_apertura,
    notas_apertura:   caja.notas_apertura,
    ventas:           totales.ventas,
    esperado:         totales.esperado,
    contado:          null,
    diferencia:       null,
    // /actual las trae de la más nueva a la más vieja; el archivo, en orden.
    movimientos:      [...(data.movimientos ?? [])].reverse(),
  };
  const sufijoExport = `turno-${fmtFechaCorta(caja.abierta_at)}`;

  // El corte lo hace quien abrió el turno o un admin (también lo exige el servidor).
  const esMiTurno = String(caja.usuario_apertura_id) === String(usuario?.id);
  const puedeCerrar = esMiTurno || esAdminFn(usuario?.rol);
  // El empleado escribe lo contado y la caja final; el sobre se calcula (solo un
  // admin lo escribe).
  const sobreEditable = esAdminFn(usuario?.rol);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <MenuExportar
          onPdf={() => imprimirCortes(turnoExportable, { titulo: 'Corte de caja', subtitulo: `Turno en curso · ${caja.usuario_apertura || ''}` })}
          onCsv={() => descargarCortesCSV(turnoExportable, sufijoExport)}
        />
      </div>
      {/* De quién es el turno que se está cortando. */}
      <div className="rounded-xl bg-light-blue/60 border border-blue-100 px-4 py-3">
        <p className="text-sm font-semibold text-dark-blue">
          {esMiTurno ? 'Tu turno' : `Turno de ${caja.usuario_apertura || '—'}`}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Abierto desde las {fmtHora(caja.abierta_at)}</p>
        {/* La nota que se dejó al abrir. */}
        {caja.notas_apertura && (
          <p className="text-xs text-gray-600 mt-1.5">Nota de apertura: {caja.notas_apertura}</p>
        )}
      </div>

      <RecuadrosCaja turno={turno} />

      {!puedeCerrar ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Este turno no es tuyo</p>
          <p className="mt-0.5 text-sm text-amber-800">
            Lo abrió {caja.usuario_apertura || 'otra persona'}: solo esa persona o un administrador puede hacer el corte.
          </p>
        </div>
      ) : (
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Efectivo contado</label>
          <input
            type="number" min="0" step="0.01" required value={contado} onChange={(e) => cambiarContado(e.target.value)}
            placeholder="0.00"
            className={`w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base font-medium ${
              diferencia === null ? 'text-gray-900'
                : Math.abs(diferencia) < 0.005 ? 'text-blue-600'
                : diferencia < 0 ? 'text-red-600' : 'text-green-600'
            }`}
          />
        </div>
        {diferencia !== null && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
            Math.abs(diferencia) < 0.005
              ? 'bg-blue-50 text-blue-700'
              : diferencia < 0
              ? 'bg-red-50 text-red-700'
              : 'bg-green-50 text-green-700'
          }`}>
            Diferencia: {diferencia > 0 ? '+' : ''}{fmt(diferencia)}
            {Math.abs(diferencia) < 0.005 ? ' (cuadra)' : (diferencia > 0 ? ' (sobrante)' : ' (faltante)')}
          </div>
        )}
        {/* Reparto de lo contado. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="caja-final" className="block text-sm font-medium text-gray-700 mb-1">Caja final</label>
            <input
              id="caja-final"
              type="number" min="0" step="0.01" required value={cajaFinal}
              onChange={(e) => cambiarCajaFinal(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base font-medium"
            />
          </div>
          <div>
            <label htmlFor="sobre" className="block text-sm font-medium text-gray-700 mb-1">Sobre</label>
            <input
              id="sobre"
              type="number" min="0" step="0.01" required value={sobre}
              onChange={(e) => cambiarSobre(e.target.value)}
              disabled={!sobreEditable}
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base font-medium disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
            />
          </div>
          <p className={`col-span-2 -mt-1 text-xs ${repartoMal ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            {repartoMal
              ? `La caja final y el sobre tienen que sumar lo contado (${fmt(contadoNum)}), sin números negativos.`
              : sobreEditable
                ? 'Reparte lo contado: la caja final se queda en el cajón y con ella abre el siguiente turno; el sobre se aparta.'
                : 'Escribe la caja final: se queda en el cajón y con ella abre el siguiente turno. El sobre es lo que sobra y se calcula solo.'}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nota de cierre (opcional)</label>
          <textarea
            rows={4} value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base resize-y min-h-[6rem]"
          />
        </div>
        <button
          type="submit" disabled={saving || repartoFalta || repartoMal}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
        >
          {saving ? 'Cerrando…' : 'Cerrar caja'}
        </button>
      </form>
      )}

      {/* Animación de éxito al cerrar la caja */}
      {exito && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-10 flex flex-col items-center gap-4 text-center animate-pop-in">
            <span className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-11 h-11 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <div>
              <p className="text-lg font-bold text-gray-900">Caja cerrada</p>
              <p className="text-sm text-gray-500 mt-0.5">El corte se guardó correctamente.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Historial ───────────────────────────────────────────────
function Historial({ onFiltroLabel }) {
  // Solo el Admin Main puede eliminar cortes.
  const { usuario } = useAuth();
  const esAdminMain = esAdminMainFn(usuario?.rol);

  const [cortes, setCortes] = useState([]);
  // El turno abierto: se ve en su día, "En curso", con lo que lleva. No es un
  // corte: sin conteo ni menú.
  const [enCurso, setEnCurso] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filtro de período (con mes y año en dropdown). Abre en "Hoy".
  const [periodo, setPeriodo] = useState('hoy');
  const [anioSel, setAnioSel] = useState(() => new Date().getFullYear());
  const [mesSel, setMesSel] = useState(() => new Date().getMonth());
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [mostrarAnios, setMostrarAnios] = useState(false);
  const [mostrarMeses, setMostrarMeses] = useState(false);
  const anioRef = useRef(null);
  const mesRef = useRef(null);

  // Cortes con su lista de entradas y salidas desplegada (por id).
  const [movsAbiertos, setMovsAbiertos] = useState(() => new Set());
  const alternarMovs = (id) => setMovsAbiertos((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Cortes con su detalle de Ingresos, Egresos y Desglose desplegado (por id).
  const [detAbiertos, setDetAbiertos] = useState(() => new Set());
  const alternarDet = (id) => setDetAbiertos((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Menú de opciones (⋮) por corte y confirmación de borrado.
  const [menuCorte, setMenuCorte] = useState(null);       // id del corte con el menú abierto
  const [confirmEliminar, setConfirmEliminar] = useState(null); // corte a eliminar
  const [eliminando, setEliminando] = useState(false);
  const menuRef = useRef(null);

  // Menú de exportación (PDF/CSV) del período visible.
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    let activo = true;
    api.get('/caja/historial')
      .then((data) => { if (activo) setCortes(data ?? []); })
      .catch((e) => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    // Si falla, el historial se ve igual, solo sin el turno abierto.
    api.get('/caja/actual')
      .then((d) => {
        if (!activo || !d?.abierta) return;
        const { caja, totales } = d;
        setEnCurso({
          id: `en-curso-${caja.id}`,
          en_curso: true,
          abierta_at: caja.abierta_at,
          usuario_apertura: caja.usuario_apertura,
          notas_apertura: caja.notas_apertura,
          monto_inicial: caja.monto_inicial,
          ventas: totales.ventas,
          ventas_desglose: totales.ventas_desglose,
          entradas: totales.entradas,
          salidas: totales.salidas,
          // /actual las trae de la más nueva a la más vieja; aquí van en orden.
          movimientos: [...(d.movimientos ?? [])].reverse(),
          esperado: totales.esperado,
          contado: null,
          diferencia: null,
          // Ingresos por concepto y SPE Debe, para exportar.
          ingresos: totales.ingresos ?? null,
          spe_debe: totales.egresos?.por_encargo_pendiente ?? null,
        });
      })
      .catch(() => {});
    return () => { activo = false; };
  }, []);

  // Cierra el selector de año al hacer clic fuera.
  useEffect(() => {
    if (!mostrarAnios) return;
    const onDown = (e) => {
      if (anioRef.current && !anioRef.current.contains(e.target)) setMostrarAnios(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mostrarAnios]);

  // Cierra el selector de mes al hacer clic fuera.
  useEffect(() => {
    if (!mostrarMeses) return;
    const onDown = (e) => {
      if (mesRef.current && !mesRef.current.contains(e.target)) setMostrarMeses(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mostrarMeses]);

  // Cierra el menú de opciones de un corte al hacer clic fuera.
  useEffect(() => {
    if (menuCorte == null) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuCorte(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuCorte]);

  // Cierra el menú de exportación al hacer clic fuera.
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  // Elimina el corte confirmado (y sus movimientos, en cascada en el backend).
  const eliminarCorte = async () => {
    if (!confirmEliminar) return;
    setEliminando(true);
    try {
      await api.delete(`/caja/historial/${confirmEliminar.id}`);
      setCortes((prev) => prev.filter((c) => c.id !== confirmEliminar.id));
      setConfirmEliminar(null);
    } catch (e) {
      setError(e.message);
      setConfirmEliminar(null);
    } finally {
      setEliminando(false);
    }
  };

  // Etiqueta del filtro activo para el subtítulo (como en Ventas).
  const filtroLabel = (() => {
    const hoyD = new Date();
    switch (periodo) {
      case 'hoy':
        return `Hoy, ${nombreDia(hoyD)} ${hoyD.getDate()} de ${MESES[hoyD.getMonth()]}`;
      case 'semana': {
        const lunes = inicioSemana(hoyD);
        const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
        const mesL = MESES[lunes.getMonth()];
        const mesD = MESES[domingo.getMonth()];
        return lunes.getMonth() === domingo.getMonth()
          ? `Del ${lunes.getDate()} - ${domingo.getDate()} de ${mesL}`
          : `Del ${lunes.getDate()} de ${mesL} - ${domingo.getDate()} de ${mesD}`;
      }
      case 'mes':    return `${MESES[mesSel]} ${anioSel}`;
      case 'anio':   return `${anioSel}`;
      case 'custom': {
        if (!desde || !hasta) return 'Personalizado';
        const d1 = new Date(`${desde}T00:00:00`);
        const d2 = new Date(`${hasta}T00:00:00`);
        const mismoAnio = d1.getFullYear() === d2.getFullYear();
        const p1 = `${d1.getDate()} de ${MESES[d1.getMonth()]}${mismoAnio ? '' : ` ${d1.getFullYear()}`}`;
        const p2 = `${d2.getDate()} de ${MESES[d2.getMonth()]} ${d2.getFullYear()}`;
        return `Del ${p1} al ${p2}`;
      }
      default:       return '';
    }
  })();
  useEffect(() => { onFiltroLabel?.(filtroLabel); }, [filtroLabel, onFiltroLabel]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (cortes.length === 0 && !enCurso) return <EmptyState>Aún no hay cortes registrados.</EmptyState>;

  // Años disponibles a partir de los cortes (más el actual), de mayor a menor.
  const anios = [...new Set([new Date().getFullYear(), ...cortes.map((c) => new Date(c.cerrada_at).getFullYear())])]
    .sort((a, b) => b - a);

  const rango = rangoDePeriodo(periodo, anioSel, mesSel, desde, hasta);
  const visibles = rango
    // Cada turno es del día en que se abrió.
    ? cortes.filter((c) => {
        const f = new Date(c.abierta_at);
        return f >= rango.desde && f < rango.hasta;
      })
    : cortes;

  // Se exportan los cortes del período y, si cae dentro, el turno abierto.
  const enCursoVisible = enCurso && (!rango || (
    new Date(enCurso.abierta_at) >= rango.desde && new Date(enCurso.abierta_at) < rango.hasta));
  // Va primero: la lista viene de la más nueva a la más vieja.
  const exportables = enCursoVisible ? [enCurso, ...visibles] : visibles;

  // "Esta semana": los 7 días (lunes → domingo), para ver qué días faltan.
  const lunesSemana = inicioSemana(new Date());
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunesSemana);
    d.setDate(lunesSemana.getDate() + i);
    return d;
  });
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);

  // Menú de opciones de un corte (badge de diferencia y ⋮ para eliminar; el ⋮
  // solo lo ve el Admin Main).
  const menuOpciones = (c) => {
    if (c.en_curso) {
      return (
        <span className="flex-shrink-0 text-sm font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
          En curso
        </span>
      );
    }
    const cuadra = c.diferencia != null && Math.abs(c.diferencia) < 0.005;
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        {c.cierre_automatico ? (
          <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
            Sin conteo
          </span>
        ) : c.diferencia != null && (
          <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
            cuadra ? 'bg-blue-50 text-blue-700'
              : c.diferencia < 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}>
            {cuadra ? 'Cuadra' : `${c.diferencia > 0 ? '+' : ''}${fmt(c.diferencia)}`}
          </span>
        )}
        <div className="relative" ref={menuCorte === c.id ? menuRef : null}>
          <button
            type="button"
            onClick={() => setMenuCorte((prev) => (prev === c.id ? null : c.id))}
            aria-haspopup="menu"
            aria-expanded={menuCorte === c.id}
            aria-label="Opciones"
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
          {menuCorte === c.id && (
            <div className="absolute right-0 mt-1 z-10 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setMenuCorte(null);
                  imprimirCortes([c], { titulo: `Corte del ${fmtFechaCorta(c.cerrada_at)}` });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659" />
                </svg>
                Exportar PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuCorte(null);
                  descargarCortesCSV([c], fmtFechaCorta(c.cerrada_at));
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Descargar CSV
              </button>
              {esAdminMain && (
                <button
                  type="button"
                  onClick={() => { setMenuCorte(null); setConfirmEliminar(c); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 border-t border-gray-100"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                  Eliminar
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Renglones { label, value, sign, nota } de la rejilla.
  const filasRejilla = (filas) => filas.map((r) => (
    <div key={r.label} className="contents">
      <span className="text-gray-500">
        {r.label}
        {r.nota && <span className="block text-xs text-gray-400">{r.nota}</span>}
      </span>
      <span className="text-right text-gray-700">{r.sign}{fmt(r.value)}</span>
    </div>
  ));
  const subtituloRejilla = (texto) => (
    <p className="col-span-2 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{texto}</p>
  );

  // Cuerpo del corte: Ingresos, Egresos y Esperado con su detalle desplegable
  // (como el turno de Ventas), más conteo, caja final y sobre.
  const cuerpoCorte = (c) => {
    const d = desgloseCaja(c);
    return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-base">
        <span className="text-gray-500">Ingresos</span><span className="text-right text-gray-700">{fmt(d.totalIngresos)}</span>
        <span className="text-gray-500">Egresos</span><span className="text-right text-gray-700">−{fmt(d.totalEgresos)}</span>
        <span className="text-gray-500">{c.en_curso ? 'Esperado hasta ahora' : 'Esperado'}</span><span className="text-right text-gray-700">{fmt(c.esperado)}</span>
        <span className="text-gray-500">Contado</span><span className="text-right text-gray-700">{c.contado != null ? fmt(c.contado) : '—'}</span>
        {/* Reparto de lo contado (en cortes que lo tienen): caja final en azul y
            sobre en negritas. */}
        {c.caja_final != null && (
          <>
            <span className="text-gray-500 font-medium">Caja final</span><span className="text-right font-medium text-blue-600">{fmt(c.caja_final)}</span>
            <span className="text-gray-500 font-medium">Sobre</span><span className="text-right font-medium text-gray-800">{fmt(c.sobre)}</span>
          </>
        )}
      </div>
      {/* El detalle, plegado como en Ventas. */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => alternarDet(c.id)}
          className="flex items-center gap-1 text-sm font-medium text-blue hover:underline"
        >
          {detAbiertos.has(c.id) ? 'Ocultar' : 'Ver'} ingresos y egresos
          <svg className={`w-4 h-4 transition-transform ${detAbiertos.has(c.id) ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {detAbiertos.has(c.id) && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {subtituloRejilla('Ingresos')}
            {filasRejilla(d.ingresos)}
            <span className="font-medium text-gray-700">Total ingresos</span>
            <span className="text-right font-medium text-gray-800">{fmt(d.totalIngresos)}</span>
            {/* Después del total, para que no se lea como su suma; es informativo. */}
            {subtituloRejilla('Cómo se cobró')}
            {filasRejilla(d.comoSeCobro)}
            {subtituloRejilla('Egresos')}
            {filasRejilla(d.egresos)}
            <span className="font-medium text-gray-700">Total egresos</span>
            <span className="text-right font-medium text-gray-800">{fmt(d.totalEgresos)}</span>
            {subtituloRejilla('Desglose esperado')}
            {filasRejilla(d.desglose)}
            <span className="font-medium text-gray-700">{c.en_curso ? 'Esperado hasta ahora' : 'Esperado en caja'}</span>
            <span className="text-right font-medium text-gray-800">{fmt(c.esperado)}</span>
          </div>
        )}
      </div>
      {/* Entradas y gastos del turno con su concepto, plegados. */}
      {c.movimientos?.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => alternarMovs(c.id)}
            className="flex items-center gap-1 text-sm font-medium text-blue hover:underline"
          >
            {movsAbiertos.has(c.id) ? 'Ocultar' : 'Ver'} entradas y gastos ({c.movimientos.length})
            <svg className={`w-4 h-4 transition-transform ${movsAbiertos.has(c.id) ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {movsAbiertos.has(c.id) && (
            <div className="mt-2 rounded-lg border border-gray-200 divide-y divide-gray-100">
              {c.movimientos.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 break-words">{m.concepto}</p>
                    <p className="text-xs text-gray-400">
                      {m.tipo === 'salida' ? 'Gasto' : 'Entrada'} · {m.usuario} · {fmtHora(m.created_at)}
                    </p>
                  </div>
                  <span className={`flex-shrink-0 text-sm font-semibold ${m.tipo === 'salida' ? 'text-red-600' : 'text-green-600'}`}>
                    {m.tipo === 'salida' ? '−' : '+'}{fmt(m.monto)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-5 pt-5 border-t border-gray-100 divide-y divide-gray-100">
        <div className="py-6 first:pt-0 last:pb-0">
          <div className="flex items-center gap-2 text-sm">
            <IconEntrada className="w-5 h-5 text-green-500 flex-shrink-0" />
            <span className="font-medium text-green-600 w-12">Abrió</span>
            <span className="font-medium text-gray-700">{c.usuario_apertura}</span>
          </div>
          {c.notas_apertura && (
            <p className="mt-2 ml-7 pl-3 border-l-2 border-gray-100 text-sm text-gray-500">{c.notas_apertura}</p>
          )}
        </div>
        <div className="py-6 first:pt-0 last:pb-0">
          <div className="flex items-center gap-2 text-sm">
            <IconSalida className="w-5 h-5 text-orange-500 flex-shrink-0" />
            <span className="font-medium text-orange-600 w-12">Cerró</span>
            <span className={`font-medium ${
              c.en_curso ? 'text-green-700' : c.cierre_automatico ? 'text-amber-700' : 'text-gray-700'
            }`}>
              {c.en_curso ? 'Sigue abierto' : c.cierre_automatico ? 'El sistema, al cerrar el día' : (c.usuario_cierre ?? '—')}
            </span>
          </div>
          {c.notas_cierre && (
            <p className="mt-2 ml-7 pl-3 border-l-2 border-gray-100 text-sm text-gray-500">{c.notas_cierre}</p>
          )}
        </div>
      </div>
    </>
    );
  };

  // Tarjeta de un día (un día puede tener varios turnos):
  // - un turno: la tarjeta es ese turno, con su horario;
  // - varios: el resumen del día y cada turno en su tarjeta;
  // - ninguno: vacía ("Sin corte" / "Pendiente").
  const renderDia = (dia) => {
    const turnos = [...visibles, ...(enCurso ? [enCurso] : [])]
      .filter((x) => mismoDia(x.abierta_at, dia))
      .sort((a, b) => new Date(a.abierta_at) - new Date(b.abierta_at));
    const hoy = mismoDia(dia, hoy0);
    const futuro = dia > hoy0;
    const uno = turnos.length === 1 ? turnos[0] : null;
    const horario = (c) => `${fmtHora(c.abierta_at)} – ${c.en_curso ? 'en curso' : fmtHora(c.cerrada_at)}`;
    return (
      <div
        key={dia.toISOString()}
        className={`rounded-xl border p-4 ${
          hoy ? 'border-blue bg-light-blue/40'
            : turnos.length ? 'border-gray-200 bg-white'
            : 'border-dashed border-gray-300 bg-gray-50'
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-700">
              {nombreDia(dia)} - {dia.getDate()} {MESES[dia.getMonth()]}
              {hoy && (
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-blue">Hoy</span>
              )}
            </h4>
            {uno && <p className="text-sm text-gray-500 mt-0.5">{horario(uno)}</p>}
            {turnos.length > 1 && <p className="text-sm text-gray-500 mt-0.5">{turnos.length} turnos</p>}
          </div>
          {uno && menuOpciones(uno)}
        </div>
        {turnos.length === 0 ? (
          <p className="text-sm text-gray-400 italic">{futuro ? 'Pendiente' : 'Sin corte'}</p>
        ) : uno ? cuerpoCorte(uno) : (
          <>
            {resumenDia(turnos)}
            <div className="mt-5 space-y-4">
              {turnos.map((c, i) => (
                <div key={c.id} className={`rounded-lg border p-4 ${c.en_curso ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-700">Turno {i + 1}</p>
                      <p className="text-sm text-gray-500 mt-0.5">{horario(c)}</p>
                    </div>
                    {menuOpciones(c)}
                  </div>
                  {cuerpoCorte(c)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  // Resumen de un día con varios turnos. La diferencia suma solo los contados
  // (un cierre automático no tiene conteo). La caja inicial cuenta una vez, la
  // del primer turno: las siguientes son caja final ya contada.
  const resumenDia = (turnos) => {
    const suma = (f) => turnos.reduce((t, c) => t + (Number(f(c)) || 0), 0);
    const efectivo = suma((c) => c.ventas_desglose?.efectivo ?? c.ventas);
    const transferencia = suma((c) => c.ventas_desglose?.transferencia);
    const ingresos = (Number(turnos[0]?.monto_inicial) || 0) + suma((c) => c.entradas) + efectivo;
    const egresos = suma((c) => desgloseCaja(c).totalEgresos);
    const contados = turnos.filter((c) => c.diferencia != null);
    const diferencia = contados.reduce((t, c) => t + c.diferencia, 0);
    const sinConteo = turnos.some((c) => c.cierre_automatico);
    const cuadra = Math.abs(diferencia) < 0.005;
    return (
      <div className="rounded-lg bg-gray-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Resumen del día</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <span className="text-gray-500">Ingresos</span><span className="text-right text-gray-700">{fmt(ingresos)}</span>
          <span className="text-gray-500">Egresos</span><span className="text-right text-gray-700">−{fmt(egresos)}</span>
          <span className="text-gray-500">Ventas en efectivo</span><span className="text-right text-gray-700">{fmt(efectivo)}</span>
          <span className="text-gray-500">Ventas por transferencia</span><span className="text-right text-gray-700">{fmt(transferencia)}</span>
          <span className="text-gray-500 font-medium">Diferencia del día</span>
          <span className={`text-right font-medium ${
            contados.length === 0 ? 'text-gray-500'
              : cuadra ? 'text-blue-600' : diferencia < 0 ? 'text-red-600' : 'text-green-600'
          }`}>
            {contados.length === 0 ? '—' : cuadra ? 'Cuadra' : `${diferencia > 0 ? '+' : ''}${fmt(diferencia)}`}
          </span>
        </div>
        {sinConteo && (
          <p className="mt-2 text-xs text-amber-700">Un turno lo cerró el sistema sin conteo: no entra en la diferencia.</p>
        )}
      </div>
    );
  };

  // Agrupa días por semana, con su encabezado (vistas Mes y Año).
  const agruparEnSemanas = (dias) => {
    const semanas = [];
    for (const dia of dias) {
      const clave = inicioSemana(dia).getTime();
      const ultima = semanas[semanas.length - 1];
      if (ultima && ultima.clave === clave) ultima.dias.push(dia);
      else semanas.push({ clave, titulo: fmtSemanaHeader(dia), dias: [dia] });
    }
    return semanas;
  };
  const diasDeMes = (anio, mes) => {
    const ultimo = new Date(anio, mes + 1, 0).getDate();
    return Array.from({ length: ultimo }, (_, i) => new Date(anio, mes, i + 1));
  };
  const diasDeAnio = (anio) => {
    const dias = [];
    for (let m = 0; m < 12; m++) dias.push(...diasDeMes(anio, m));
    return dias;
  };
  const diasDeRango = (desdeStr, hastaStr) => {
    const dias = [];
    const fin = new Date(`${hastaStr}T00:00:00`);
    for (let d = new Date(`${desdeStr}T00:00:00`); d <= fin; d.setDate(d.getDate() + 1)) {
      dias.push(new Date(d));
    }
    return dias;
  };

  return (
    <div className="space-y-10">
      {/* Filtro: Hoy, Esta semana, Mes, Este año y Personalizado. */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            if (p.id === 'mes') {
              const activoMes = periodo === 'mes';
              return (
                <div key={p.id} ref={mesRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('mes'); setMostrarAnios(false); setMostrarMeses((v) => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activoMes ? 'bg-blue text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {MESES[mesSel]}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {mostrarMeses && (
                    <div className="absolute left-0 top-10 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-40 max-h-64 overflow-y-auto">
                      {MESES.map((nombre, i) => (
                        <button
                          key={i}
                          onClick={() => { setMesSel(i); setPeriodo('mes'); setMostrarMeses(false); }}
                          className={`block w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                            mesSel === i ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            if (p.id === 'anio') {
              const activoAnio = periodo === 'anio';
              return (
                <div key={p.id} ref={anioRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('anio'); setMostrarMeses(false); setMostrarAnios((v) => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activoAnio ? 'bg-blue text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {anioSel}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {mostrarAnios && (
                    <div className="absolute left-0 top-10 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-32 max-h-64 overflow-y-auto">
                      {anios.map((y) => (
                        <button
                          key={y}
                          onClick={() => { setAnioSel(y); setPeriodo('anio'); setMostrarAnios(false); }}
                          className={`block w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                            anioSel === y ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                key={p.id}
                onClick={() => { setPeriodo(p.id); setMostrarAnios(false); setMostrarMeses(false); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  periodo === p.id ? 'bg-blue text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}

          {/* Exportar todos los cortes del período visible a PDF o CSV. */}
          <div ref={exportRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              disabled={exportables.length === 0}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Exportar
            </button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 mt-1 z-20 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setExportOpen(false); imprimirCortes(exportables, { titulo: 'Cortes de caja', subtitulo: filtroLabel }); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659" />
                  </svg>
                  Exportar PDF
                </button>
                <button
                  type="button"
                  onClick={() => { setExportOpen(false); descargarCortesCSV(exportables, filtroLabel); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m-1.125 1.125v-1.5m0-9.75a1.125 1.125 0 0 1 1.125-1.125h7.5c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125M21 12l-3-3m0 0-3 3m3-3v9" />
                  </svg>
                  Descargar CSV
                </button>
              </div>
            )}
          </div>
        </div>
        {periodo === 'custom' && (
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Desde</label>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Hasta</label>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </div>
        )}
      </div>

      {periodo === 'hoy' ? (
        // Solo la tarjeta de hoy, con sus turnos (y el que siga en curso).
        <div className="space-y-4">
          {renderDia(hoy0)}
        </div>
      ) : periodo === 'semana' ? (
        // Un contenedor por día (lunes → domingo): vacíos sin corte, hoy resaltado y
        // los que no llegan, "Pendiente".
        <div className="space-y-4">
          {diasSemana.map(renderDia)}
        </div>
      ) : periodo === 'custom' && (!desde || !hasta) ? (
        <EmptyState>Elige las fechas del rango.</EmptyState>
      ) : (
        // Mes, Año y Personalizado: cada semana con sus días.
        <div className="space-y-24">
          {agruparEnSemanas(
            periodo === 'mes' ? diasDeMes(anioSel, mesSel)
              : periodo === 'anio' ? diasDeAnio(anioSel)
              : diasDeRango(desde, hasta)
          ).map((sem) => (
            <div key={sem.clave} className="space-y-4">
              <h3 className="text-lg font-bold text-dark-blue px-1">{sem.titulo}</h3>
              {sem.dias.map(renderDia)}
            </div>
          ))}
        </div>
      )}

      {/* Confirmación de eliminar corte */}
      {confirmEliminar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </span>
              <h3 className="text-base font-bold text-gray-900">Eliminar corte</h3>
            </div>
            <p className="text-sm text-gray-500">
              ¿Eliminar el corte del{' '}
              <span className="font-semibold text-gray-800">{fmtFechaCorta(confirmEliminar.cerrada_at)}</span>?
              Se borrará junto con sus movimientos. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmEliminar(null)}
                disabled={eliminando}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={eliminarCorte}
                disabled={eliminando}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Caja() {
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);
  // El Historial (con diferencias de caja) es solo de admins y va primero.
  const tabs = esAdmin
    ? [TABS.find((t) => t.id === 'historial'), ...TABS.filter((t) => t.id !== 'historial')]
    : TABS.filter((t) => t.id !== 'historial');

  // Se entra a una pestaña con ?tab=... (p. ej. desde el Dashboard). Sin él, los
  // admins abren en Historial. ?tab=apertura cae en Corte.
  const [searchParams] = useSearchParams();
  // Sin ?tab, la pestaña la decide la caja: abierta → Movimientos, cerrada →
  // Corte (ver `tabActiva`).
  const [tab, setTab] = useState(() => {
    const req = searchParams.get('tab') === 'apertura' ? 'corte' : searchParams.get('tab');
    return tabs.some((t) => t.id === req) ? req : (esAdmin ? 'historial' : null);
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Menú ⋮ de admins: Movimientos y Corte como secundarias.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Filtro activo del Historial, para el subtítulo.
  const [historialFiltro, setHistorialFiltro] = useState('');

  const fetchActual = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/caja/actual');
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let activo = true;
    api.get('/caja/actual')
      .then(result => { if (activo) { setData(result); setError(null); } })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, []);

  // Tras abrir/cerrar caja conviene mostrar el estado más relevante.
  const handleAbrir = () => { fetchActual(); setTab('movimientos'); };
  const handleCerrar = () => { fetchActual(); setTab(esAdmin ? 'historial' : 'corte'); };

  // Cierra el menú de acciones (⋮) al hacer clic fuera.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Con la caja cerrada no hay Movimientos; se ve Corte (que sirve para abrirla).
  const tabVisible = (t) => t.id !== 'movimientos' || Boolean(data?.abierta);
  const tabActiva = tab == null
    ? (data?.abierta ? 'movimientos' : 'corte')
    : tab === 'movimientos' && data && !data.abierta ? 'corte' : tab;
  const seccionLabel = tabs.find((t) => t.id === tabActiva)?.label ?? '';

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Caja</h1>
            {/* Para admins la página es el Historial; el subtítulo refleja el
                filtro activo en esa pestaña y la sección actual en las demás. */}
            {esAdmin && (
              <p className="text-sm text-gray-500 mt-0.5">
                {tab === 'historial' ? historialFiltro : seccionLabel}
              </p>
            )}
          </div>

          {/* Menú de acciones (⋮): Movimientos / Corte como secundarias. */}
          {esAdmin && (
            <div ref={menuRef} className="relative flex-shrink-0">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Acciones de caja"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="w-10 h-10 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-12 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 w-44">
                  {TABS.filter((t) => t.id !== 'historial' && tabVisible(t)).map((t) => (
                    <button
                      key={t.id}
                      role="menuitem"
                      onClick={() => { setTab(t.id); setMenuOpen(false); }}
                      className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition-colors ${
                        tabActiva === t.id ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-2xl mx-auto px-6 md:px-8 py-6 space-y-6">

      {/* No-admins conservan las pestañas (no tienen Historial). */}
      {!esAdmin && (
        <div className="flex flex-wrap gap-2">
          {tabs.filter(tabVisible).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tabActiva === t.id
                  ? 'bg-blue text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Admins: al entrar a una sección secundaria, un enlace para volver. */}
      {esAdmin && tab !== 'historial' && (
        <button
          onClick={() => setTab('historial')}
          className="flex items-center gap-1.5 text-sm font-medium text-blue hover:opacity-80"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver al historial
        </button>
      )}

      {loading && tab !== 'historial' && <Spinner />}
      {error && tab !== 'historial' && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          {tabActiva === 'movimientos' && <Movimientos data={data} onChange={fetchActual} />}
          {tabActiva === 'corte'       && <Corte data={data} onCerrar={handleCerrar} onAbrir={handleAbrir} />}
        </>
      )}
      {tab === 'historial' && <Historial onFiltroLabel={setHistorialFiltro} />}
      </div>
    </div>
  );
}
