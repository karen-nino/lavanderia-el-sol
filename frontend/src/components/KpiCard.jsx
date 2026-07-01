const VARIANT = {
  blue:   { container: 'bg-light-blue',   value: 'text-blue'   },
  green:  { container: 'bg-light-green',  value: 'text-green'  },
  red:    { container: 'bg-light-red',    value: 'text-red'    },
  bronce: { container: 'bg-light-bronce', value: 'text-bronce' },
};

export default function KpiCard({ label, sublabel, value, color = 'blue', icon }) {
  const v = VARIANT[color] ?? VARIANT.blue;
  return (
    <div className={`relative aspect-square md:aspect-[16/9] rounded-xl p-4 md:p-5 pb-5 md:pb-5 shadow-card overflow-hidden flex flex-col justify-end ${v.container}`}>
      {icon && (
        <span className={`absolute top-3.5 right-3.5 md:top-4 md:right-4 w-16 h-16 md:w-12 md:h-12 opacity-50 ${v.value}`}>
          {icon}
        </span>
      )}

      <div className="flex flex-col">
        <p className={`font-extrabold leading-none text-5xl md:text-4xl mb-2 md:mb-1 ${v.value}`}>
          {value}
        </p>
        <p className="text-sm leading-tight text-dark-grey">{label}</p>
        <p className="text-lg font-bold leading-tight text-dark-blue">{sublabel}</p>
      </div>
    </div>
  );
}
