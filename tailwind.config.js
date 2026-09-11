/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        ink: {
          900: '#0f172a',
          800: '#141d2f',
          700: '#1e293b',
        },
      },
      boxShadow: {
        card: '0 10px 30px -12px rgba(15, 23, 42, 0.15)',
        cardHover: '0 24px 50px -20px rgba(15, 23, 42, 0.25)',
      },
      keyframes: {
        toastIn: {
          '0%': { opacity: '0', transform: 'translateX(24px) scale(.98)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
      },
      animation: {
        'toast-in': 'toastIn .28s cubic-bezier(.22,1,.36,1)',
      },
    },
  },
  plugins: [],
};

