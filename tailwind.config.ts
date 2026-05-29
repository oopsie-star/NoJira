import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'jira-blue':       '#0C66E4',
        'jira-blue-dk':    '#0055CC',
        'jira-blue-lt':    '#E9F2FF',
        'qira-pistachio':    '#6B9E6B',
        'qira-pistachio-dk': '#4E7A4E',
        'qira-pistachio-lt': '#EBF5EB',
        'qira-cream':        '#FAF8F4',
        'qira-silver':       '#C4CBD4',
        'qira-anthracite':   '#1E2A35',
        'qira-graphite':     '#3D4D5C',
        'text-primary':    '#172B4D',
        'text-secondary':  '#6B778C',
        'surface-board':   '#F7F8F9',
        'surface-sidebar': '#F4F5F7',
        'border-default':  '#DFE1E6',
        'status-todo':     '#DFE1E6',
        'status-ip':       '#6B9E6B',
        'status-done':     '#22A06B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '3px',
        btn:  '4px',
      },
      boxShadow: {
        card:        '0 1px 2px rgba(9,30,66,0.15)',
        'card-hover':'0 2px 8px rgba(9,30,66,0.20)',
        drawer:      '-4px 0 16px rgba(9,30,66,0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config
