import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
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
import { findActiveExam } from '@/lib/exam-persistence'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'

const DEMO_SCOPE = 'preview-demo-user'
const ACTIVE_EXAM_EXIT_MESSAGE = 'გთხოვთ, დაასრულოთ მარშრუტი და შემდეგ გამოხვიდეთ.'
const PreviewDemoRoutes = lazy(() =>
  import('@/pages/PreviewDemoRoutes').then((module) => ({
    default: module.PreviewDemoRoutes,
  })),
)

function activeExamPath(routeSlug: string | undefined, routeId: string, routeName: string, demo: boolean) {
  const route = TELAVI_ROUTES_FALLBACK.find(
    (candidate) =>
      candidate.slug === routeSlug ||
      candidate.id === routeId ||
      candidate.name_ka === routeName,
  )
  const slug = routeSlug ?? route?.slug
  if (!slug) return null
  return `${demo ? '/preview-demo/route' : '/route'}/${slug}`
}
import '@/styles/payment.css'
import '@/styles/cr-scroll.css'

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
  const navigate = useNavigate()
  const [navigationBlocked, setNavigationBlocked] = useState(false)
  const isDemoPath = location.pathname === '/preview-demo' || location.pathname.startsWith('/preview-demo/')
  const demo = isDemoPath && PREVIEW_DEMO_AVAILABLE
  if (isDemoPath && !PREVIEW_DEMO_AVAILABLE) return <Navigate to="/" replace />
  const scope = demo ? DEMO_SCOPE : undefined
  const activeExam = findActiveExam(scope)
  const resumePath = activeExam
    ? activeExamPath(activeExam.routeSlug, activeExam.routeId, activeExam.routeName, demo)
    : null

  useEffect(() => {
    const handlePopState = () => {
      const currentPathIsDemo =
        window.location.pathname === '/preview-demo' || window.location.pathname.startsWith('/preview-demo/')
      const saved = findActiveExam(currentPathIsDemo ? DEMO_SCOPE : undefined)
      if (!saved) {
        setNavigationBlocked(false)
        return
      }
      const target = activeExamPath(
        saved.routeSlug,
        saved.routeId,
        saved.routeName,
        currentPathIsDemo,
      )
      if (!target) return
      setNavigationBlocked(true)
      navigate(target, {
        replace: true,
        state: { activeExamNavigationBlocked: true },
      })
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [navigate])

  if (resumePath && location.pathname !== resumePath) {
    return (
      <Navigate
        to={resumePath}
        replace
        state={{ activeExamNavigationBlocked: true }}
      />
    )
  }

  return (
    <>
      {navigationBlocked && activeExam && (
        <p role="alert" className="exam-navigation-blocked">
          {ACTIVE_EXAM_EXIT_MESSAGE}
        </p>
      )}
      {demo ? (
        <Suspense fallback={<div className="page center" role="status">DEMO იტვირთება…</div>}>
          <PreviewDemoRoutes />
        </Suspense>
      ) : (
        <AuthProvider>
          <ProductionRoutes />
        </AuthProvider>
      )}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}
