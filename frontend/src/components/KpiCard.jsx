const VARIANT = {
  blue:   { container: 'bg-light-blue',   value: 'text-blue'   },
  green:  { container: 'bg-light-green',  value: 'text-green'  },
  red:    { container: 'bg-light-red',    value: 'text-red'    },
  bronce: { container: 'bg-light-bronce', value: 'text-bronce' },
};

export default function KpiCard({ label, sublabel, value, color = 'blue', icon }) {
  const v = VARIANT[color] ?? VARIANT.blue;
  return (
    <div className={`relative rounded-card p-5 md:p-6 shadow-card overflow-hidden ${v.container}`}>
      {icon && (
        <span className={`absolute top-5 right-5 md:top-6 md:right-6 w-11 h-11 md:w-12 md:h-12 opacity-50 ${v.value}`}>
          {icon}
        </span>
      )}

      <p className={`font-extrabold leading-none text-[2.75rem] md:text-[3.25rem] mb-3 ${v.value}`}>
        {value}
      </p>

      <p className="text-sm md:text-base leading-tight text-dark-grey">{label}</p>
      <p className="text-base md:text-lg font-bold leading-tight text-dark-blue">{sublabel}</p>
    </div>
  );
}
