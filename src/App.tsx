import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthProvider } from '@/context/AuthContext'
import { PlanGate } from '@/components/PlanGate'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage'
import { PlanSelectionPage } from '@/pages/PlanSelectionPage'
import { PaymentReturnPage } from '@/pages/PaymentReturnPage'
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { RoutePage } from '@/pages/RoutePage'
import { DebugLoginPage } from '@/pages/DebugLoginPage'
import { SupportChatPage } from '@/pages/SupportChatPage'
import { SupportAdminPage } from '@/pages/SupportAdminPage'
import { PREVIEW_DEMO_AVAILABLE } from '@/lib/preview-demo-feature'
import '@/styles/payment.css'
import '@/styles/cr-scroll.css'

const PreviewDemoRoutes = lazy(() =>
  import('@/pages/PreviewDemoRoutes').then((module) => ({
    default: module.PreviewDemoRoutes,
  })),
)

function ProductionRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/debug-login" element={<DebugLoginPage />} />
      <Route path="/payment/return" element={<PaymentReturnPage />} />
      <Route path="/demo-preview" element={<Navigate to="/choose-plan" replace />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/support" element={<SupportChatPage />} />
      <Route path="/support-admin" element={<SupportAdminPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/choose-plan" element={<PlanSelectionPage />} />
        <Route element={<PlanGate />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/route/:slug" element={<RoutePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function AppContent() {
  const location = useLocation()
  const isDemoPath = location.pathname === '/preview-demo' || location.pathname.startsWith('/preview-demo/')
  const demo = isDemoPath && PREVIEW_DEMO_AVAILABLE
  if (isDemoPath && !PREVIEW_DEMO_AVAILABLE) return <Navigate to="/" replace />

  return demo ? (
    <Suspense fallback={<div className="page center" role="status">DEMO იტვირთება…</div>}>
      <PreviewDemoRoutes />
    </Suspense>
  ) : (
    <AuthProvider>
      <ProductionRoutes />
    </AuthProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}
