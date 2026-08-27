/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        jupyter: {
          orange: '#F37626',
          'orange-dark': '#d95f0e',
          gray: '#616161',
          light: '#f8f9fa'
        }
      }
    },
  },
  plugins: [],
}
