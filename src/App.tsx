import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
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
import { PreviewDemoRoutes } from '@/pages/PreviewDemoRoutes'
import '@/styles/payment.css'

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
  const { pathname } = useLocation()
  if (pathname === '/preview-demo' || pathname.startsWith('/preview-demo/')) {
    return <PreviewDemoRoutes />
  }

  return (
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
