const VARIANT = {
  blue: {
    container: 'bg-light-blue',
    badge:     'bg-blue text-white',
    value:     'text-dark-blue',
    label:     'text-blue',
  },
  green: {
    container: 'bg-light-green',
    badge:     'bg-green text-white',
    value:     'text-dark-blue',
    label:     'text-green',
  },
  red: {
    container: 'bg-light-red',
    badge:     'bg-red text-white',
    value:     'text-dark-blue',
    label:     'text-red',
  },
  bronce: {
    container: 'bg-light-bronce',
    badge:     'bg-bronce text-white',
    value:     'text-dark-blue',
    label:     'text-bronce',
  },
};

export default function KpiCard({ label, value, color = 'blue', icon }) {
  const v = VARIANT[color] ?? VARIANT.blue;
  return (
    <div className={`rounded-card p-card-pad shadow-card ${v.container}`}>
      <div className="flex items-start justify-between mb-3">
        <p className={`text-kpi-value ${v.value}`}>{value}</p>
        {icon && (
          <span className={`w-10 h-10 rounded-card-sm flex items-center justify-center ${v.badge}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`text-kpi-label uppercase tracking-wide ${v.label}`}>{label}</p>
    </div>
  );
}
