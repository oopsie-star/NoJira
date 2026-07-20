import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@/auth/AuthContext'
import { App } from '@/App'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { LanguageProvider } from '@/lib/i18n'
import '@/index.css'

const base = import.meta.env.BASE_URL.replace(/\/$/, '') // strip trailing slash

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={base}>
        <AuthProvider>
          <LanguageProvider>
            <App />
          </LanguageProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
