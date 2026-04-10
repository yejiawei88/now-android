/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#09090B',
        surface: '#121214',
        'surface-light': '#161618',
        primary: '#0A84FF',
        'primary-hover': '#007AFF',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
