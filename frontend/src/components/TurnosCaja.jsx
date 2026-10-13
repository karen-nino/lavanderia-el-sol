import { useState } from 'react';
import RecuadrosCaja from './RecuadrosCaja';
import { desgloseCaja } from '../lib/desgloseCaja';
import { formatHora12 } from '../lib/fecha';
import { fmtMoneda as fmt, fechaLarga } from '../lib/exportUtils';

/**
 * Turnos de caja del período en Ventas: una tarjeta por turno con Ingresos,
 * Egresos y Esperado, y al desplegarla los recuadros del corte. `turnos` viene
 * de /ventas/resumen con la forma de /caja/historial.
 */

function TarjetaTurno({ t }) {
  const [abierto, setAbierto] = useState(false);
  const d = desgloseCaja(t);
  const horario = `${formatHora12(t.abierta_at)} – ${t.en_curso ? 'en curso' : formatHora12(t.cerrada_at)}`;

  return (
    <div className={`rounded-lg border ${t.en_curso ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full text-left px-4 py-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{fechaLarga(t.abierta_at)}</p>
            {/* Quien abrió el turno, que responde por el cajón. */}
            <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{t.usuario_apertura || '—'}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {horario}{t.cierre_automatico ? ' · cerrado por el sistema' : ''}
            </p>
          </div>
          <svg
            className={`w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400 transition-transform ${abierto ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <span className="text-gray-500">Caja inicial</span>
          <span className="text-right text-gray-700">{fmt(t.monto_inicial)}</span>
          <span className="text-gray-500">Ingresos</span>
          <span className="text-right text-gray-700">{fmt(d.totalIngresos)}</span>
          <span className="text-gray-500">Egresos</span>
          <span className="text-right text-gray-700">−{fmt(d.totalEgresos)}</span>
          <span className="text-gray-500">{t.en_curso ? 'Esperado hasta ahora' : 'Esperado en caja'}</span>
          <span className="text-right text-gray-700">{fmt(d.esperado)}</span>
          {/* Caja final y sobre; "—" si el turno no los tiene (abierto o cierre automático). */}
          <span className="font-semibold text-gray-800">Caja final</span>
          <span className="text-right font-semibold text-gray-900">{t.caja_final != null ? fmt(t.caja_final) : '—'}</span>
          <span className="font-semibold text-gray-800">Sobre</span>
          <span className="text-right font-semibold text-gray-900">{t.sobre != null ? fmt(t.sobre) : '—'}</span>
        </div>
      </button>
      {abierto && (
        <div className="px-4 pb-4 grid gap-4 lg:grid-cols-3 items-start">
          <RecuadrosCaja
            turno={t}
            esperadoLabel={t.en_curso ? 'ESPERADO HASTA AHORA' : 'ESPERADO EN CAJA'}
          />
        </div>
      )}
    </div>
  );
}

export default function TurnosCaja({ turnos }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700">Turnos de caja</h2>
      </div>
      {turnos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Sin turnos de caja en este período</p>
      ) : (
        <div className="p-4 space-y-3">
          {turnos.map((t) => <TarjetaTurno key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}
