import React, { useState, useEffect } from 'react'
import AppRoutes from './routes'
import SplashScreen from '@/shared/components/SplashScreen.jsx'
import PageLoader from '@/shared/components/PageLoader.jsx'

import { ThemeProvider } from '@food/context/ThemeContext'
import { cleanupExpiredScopedEntries, readScopedValue, writeScopedValue } from '@food/utils/appStorage'

function App() {
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase()
      if (
        path.includes('/terms') ||
        path.includes('/privacy') ||
        path.includes('/support') ||
        path.includes('/restaurant') ||
        path.includes('/delivery') ||
        path.includes('/admin')
      ) {
        return false
      }
      if (readScopedValue('ui', 'splashShown', { storage: 'session', fallback: false })) {
        return false
      }
    }
    return true
  })

  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    cleanupExpiredScopedEntries({ storage: 'local' })
    cleanupExpiredScopedEntries({ storage: 'session' })
  }, [])

  const handleSplashFinish = () => {
    if (typeof window !== 'undefined') {
      writeScopedValue('ui', 'splashShown', true, { storage: 'session' })
    }
    setShowSplash(false)
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-white dark:bg-[#0a0a0a]">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 border-4 border-primary/10 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin" />
        </div>
        <h1 className="text-2xl font-black text-primary italic uppercase tracking-tighter mt-6">Tuggo Food Delivery</h1>
      </div>
    )
  }

  return (
    <ThemeProvider>
      <>
        {showSplash && <SplashScreen onFinish={handleSplashFinish} />}
        <PageLoader />
        <AppRoutes />
      </>
    </ThemeProvider>
  )
}

export default App
