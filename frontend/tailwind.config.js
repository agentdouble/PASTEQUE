/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette Foyer (bleus + gris fumés)
        primary: {
          25: '#F8F9FC',
          50: '#F0F5FA',
          100: '#EAEEF6',
          200: '#C4CEDE',
          300: '#A9BCE9',
          400: '#3979B4',
          500: '#67768E',
          600: '#454F5F',
          700: '#3B4856',
          800: '#004C92',
          900: '#033767',
          950: '#01213C',
        },
        success: {
          lighter: '#E0F5F3',
          light: '#59C5B3',
          DEFAULT: '#00A88C',
          dark: '#008670',
          darker: '#006353',
        },
        danger: {
          lighter: '#FFF0F0',
          light: '#F39194',
          DEFAULT: '#ED5E63',
          dark: '#D14449',
          darker: '#A32C30',
        },
        warning: {
          lighter: '#FEECD7',
          light: '#FBB54B',
          DEFAULT: '#FF9E00',
          dark: '#D18B00',
          darker: '#975F09',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
