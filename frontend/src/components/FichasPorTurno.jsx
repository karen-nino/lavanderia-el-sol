import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatHora12 } from '../lib/fecha';
import { fechaLarga } from '../lib/exportUtils';
import { periodoInicial, rangoDePeriodo } from '../lib/periodo';
import SelectorPeriodo from './SelectorPeriodo';

/** Con signo: "+2", "−3", "0". */
const conSigno = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

const thChica = 'px-4 py-2.5 font-medium whitespace-nowrap';
const tdChica = 'px-4 py-2.5 whitespace-nowrap tabular-nums';
const thGrande = 'px-4 py-3 text-sm font-medium whitespace-nowrap';
const tdGrande = 'px-4 py-3.5 text-base font-semibold whitespace-nowrap tabular-nums';

/** Tabla de un turno: un renglón por tipo de ficha (al empezar, usadas y ahora o al terminar). `grande`: renglones como los recuadros del corte de Caja. */
export function TablaFichasTurno({ t, grande = false }) {
  const th = grande ? thGrande : thChica;
  const td = grande ? tdGrande : tdChica;
  return (
    <div className="overflow-x-auto border-t border-gray-100">
      <table className={`w-full ${grande ? 'text-base' : 'text-sm'}`}>
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-100">
            <th className={th}>Tipo de ficha</th>
            <th className={`${th} text-right`}>Al empezar</th>
            <th className={`${th} text-right`}>Usadas</th>
            <th className={`${th} text-right`}>{t.en_curso ? 'Ahora' : 'Al terminar'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {t.grupos.map(g => (
            <tr key={g.clave}>
              <td className={`${td} text-gray-800`}>{g.nombre}</td>
              <td className={`${td} text-right text-gray-700`}>{g.inicio}</td>
              <td className={`${td} text-right text-gray-700`}>{conSigno(-g.usadas)}</td>
              <td className={`${td} text-right font-semibold ${g.fin < 0 ? 'text-red-600' : 'text-gray-900'}`}>{g.fin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un turno: quién lo abrió, su horario y un renglón por tipo de ficha. */
function TarjetaTurno({ t }) {
  const horario = `${formatHora12(t.abierta_at)} – ${t.en_curso ? 'en curso' : formatHora12(t.cerrada_at)}`;

  return (
    <div className={`rounded-lg border overflow-hidden ${t.en_curso ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="px-4 py-3">
        <p className="text-sm font-semibold text-gray-800 truncate">{fechaLarga(t.abierta_at)}</p>
        <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{t.abrio || '—'}</p>
        <p className="text-sm text-gray-500 mt-0.5">{horario}</p>
      </div>
      <TablaFichasTurno t={t} />
    </div>
  );
}

/**
 * Fichas por turno de caja en la página Fichas: con cuántas disponibles empezó
 * cada turno, las usadas y con cuántas terminó; por
 * tipo de ficha. `recarga` cambia tras recoger.
 */
export default function FichasPorTurno({ recarga }) {
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const rango = rangoDePeriodo(periodo);
  const desde = rango?.desde.toISOString();
  const hasta = rango?.hasta.toISOString();

  useEffect(() => {
    if (!desde) return undefined;
    let vigente = true;
    api.get(`/fichas/turnos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`)
      .then(d => { if (vigente) { setDatos(d); setError(''); } })
      .catch(err => { if (vigente) setError(err.message); });
    return () => { vigente = false; };
  }, [desde, hasta, recarga]);

  const turnos = datos?.turnos ?? [];

  return (
    /* Sin overflow-hidden: el panel del período tiene que poder salir de la tarjeta. */
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100 space-y-3">
        <h2 className="text-base font-bold text-dark-blue">Por turno</h2>
        <SelectorPeriodo valor={periodo} onCambio={setPeriodo} anios={datos?.anios} />
      </div>
      {error && <p className="px-5 pt-3 text-sm text-red-700">{error}</p>}
      {!rango ? (
        <p className="px-5 py-4 text-sm text-gray-500">Elige las fechas Desde y Hasta.</p>
      ) : !datos ? (
        !error && <p className="px-5 py-4 text-sm text-gray-400">Cargando…</p>
      ) : turnos.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-500">Sin turnos de caja en este período.</p>
      ) : (
        <div className="p-4 space-y-3">
          {turnos.map(t => <TarjetaTurno key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}
