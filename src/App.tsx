import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { PlanGate } from '@/components/PlanGate'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import { PlanSelectionPage } from '@/pages/PlanSelectionPage'
import { PaymentReturnPage } from '@/pages/PaymentReturnPage'
import { DemoPaymentPage } from '@/pages/DemoPaymentPage'
import { DemoHomePage } from '@/pages/DemoHomePage'
import { RegisterPage } from '@/pages/RegisterPage'
import { RoutePage } from '@/pages/RoutePage'
import '@/styles/payment.css'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/payment/return" element={<PaymentReturnPage />} />
          <Route path="/demo-payment" element={<DemoPaymentPage />} />
          <Route path="/demo-home" element={<DemoHomePage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/choose-plan" element={<PlanSelectionPage />} />
            <Route element={<PlanGate />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/route/:slug" element={<RoutePage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
