import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        blue:           { ...colors.blue,   DEFAULT: '#0272C0' },
        green:          { ...colors.green,  DEFAULT: '#2F9F58' },
        red:            { ...colors.red,    DEFAULT: '#E65001' },
        bronce:         '#CB7D16',
        'dark-blue':    '#1B3A5C',
        grey:           '#8B8B8B',
        'dark-grey':    '#555555',
        'light-blue':   '#DCF1FF',
        'light-green':  '#E4FFEE',
        'light-red':    '#FFECEA',
        'light-bronce': '#FFFDDB',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        'kpi-label':    ['0.75rem',  { lineHeight: '1.3', fontWeight: '500' }],
        'kpi-value':    ['2rem',     { lineHeight: '1',   fontWeight: '700' }],
        'card-title':   ['0.875rem', { lineHeight: '1.3', fontWeight: '600' }],
        'sales-amount': ['2.5rem',   { lineHeight: '1',   fontWeight: '700' }],
        'timer':        ['1.5rem',   { lineHeight: '1',   fontWeight: '700' }],
        'section':      ['1rem',     { lineHeight: '1.3', fontWeight: '700' }],
      },
      borderRadius: {
        card:      '1rem',
        'card-sm': '0.75rem',
        pill:      '9999px',
      },
      boxShadow: {
        card:         '0 1px 3px 0 rgba(27, 58, 92, 0.08)',
        'card-hover': '0 4px 12px 0 rgba(27, 58, 92, 0.12)',
        'bottom-nav': '0 -2px 12px 0 rgba(27, 58, 92, 0.08)',
      },
      spacing: {
        'card-pad':    '1.25rem',
        'section-gap': '1.5rem',
        // Franja de gestos del iPhone (vale 0 en todo lo demás). 'nav-safe' es
        // el relleno de abajo del menú inferior: su py-2 de siempre más esa
        // franja. 'fab-safe' sube el botón flotante lo mismo, para que no se
        // encime con el menú al crecer.
        'nav-safe':    'calc(0.5rem + env(safe-area-inset-bottom))',
        'fab-safe':    'calc(6rem + env(safe-area-inset-bottom))',
      },
      keyframes: {
        'pop-in': {
          '0%':   { transform: 'scale(0)',   opacity: '0' },
          '60%':  { transform: 'scale(1.1)', opacity: '1' },
          '100%': { transform: 'scale(1)',   opacity: '1' },
        },
        'draw-check': {
          '0%':   { strokeDashoffset: '48' },
          '100%': { strokeDashoffset: '0'  },
        },
        'draw-x': {
          '0%':   { strokeDashoffset: '40' },
          '100%': { strokeDashoffset: '0'  },
        },
        'shake': {
          '0%, 100%':     { transform: 'translateX(0)'    },
          '20%, 60%':     { transform: 'translateX(-6px)' },
          '40%, 80%':     { transform: 'translateX(6px)'  },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateX(4px)' },
          '100%': { opacity: '1', transform: 'translateX(0)'   },
        },
      },
      animation: {
        'pop-in':     'pop-in 0.4s ease-out forwards',
        'draw-check': 'draw-check 0.4s 0.2s ease-out forwards',
        'draw-x':     'draw-x 0.4s 0.2s ease-out forwards',
        'shake':      'shake 0.5s ease-in-out',
        'fade-in':    'fade-in 0.3s ease-out forwards',
      },
    },
  },
  plugins: [],
}
