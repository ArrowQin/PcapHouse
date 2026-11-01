/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware colors driven by CSS variables (see index.css).
        // Existing class names (bg-dark-700, text-muted, text-white, etc.)
        // keep working — they now resolve differently per [data-theme] attribute.
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          hover: 'rgb(var(--color-primary-hover) / <alpha-value>)',
          dark: 'rgb(var(--color-primary-dark) / <alpha-value>)',
        },
        dark: {
          900: 'rgb(var(--color-bg-900) / <alpha-value>)',
          800: 'rgb(var(--color-bg-800) / <alpha-value>)',
          700: 'rgb(var(--color-bg-700) / <alpha-value>)',
          600: 'rgb(var(--color-bg-600) / <alpha-value>)',
          500: 'rgb(var(--color-bg-500) / <alpha-value>)',
          400: 'rgb(var(--color-bg-400) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--color-muted) / <alpha-value>)',
          dark: 'rgb(var(--color-muted-dark) / <alpha-value>)',
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
      },
      textColor: {
        white: 'rgb(var(--color-fg) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
