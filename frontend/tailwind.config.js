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
      },
    },
  },
  plugins: [],
}
