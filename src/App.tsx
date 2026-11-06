import { lazy, ReactNode, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { FullSpinner } from './components/ui'
import AppLayout from './components/AppLayout'
import { supabase } from './lib/supabase'

const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Examinations = lazy(() => import('./pages/Examinations'))
const NewExam = lazy(() => import('./pages/NewExam'))
const AiGenerate = lazy(() => import('./pages/AiGenerate'))
const ImportJson = lazy(() => import('./pages/ImportJson'))
const ExamEditor = lazy(() => import('./pages/ExamEditor'))
const Classrooms = lazy(() => import('./pages/Classrooms'))
const ClassroomDetail = lazy(() => import('./pages/ClassroomDetail'))
const JoinDisplay = lazy(() => import('./pages/JoinDisplay'))
const JoinByLink = lazy(() => import('./pages/JoinByLink'))
const Analytics = lazy(() => import('./pages/Analytics'))
const AssignmentResults = lazy(() => import('./pages/AssignmentResults'))
const MyResults = lazy(() => import('./pages/MyResults'))
const ResultDetail = lazy(() => import('./pages/ResultDetail'))
const History = lazy(() => import('./pages/History'))
const Notifications = lazy(() => import('./pages/Notifications'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const TakeExam = lazy(() => import('./pages/TakeExam'))

function Protected({ children }: { children: ReactNode }) {
  const { session, user, loading } = useAuth()
  const loc = useLocation()
  useEffect(() => {
    // Defence in depth: an account whose email is not verified must not use the app.
    if (user && !user.email_confirmed_at) void supabase.auth.signOut()
  }, [user])
  if (loading) return <FullSpinner />
  if (!session || !user?.email_confirmed_at) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return <>{children}</>
}

function Guest({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const loc = useLocation() as { state?: { from?: string } }
  if (loading) return <FullSpinner />
  if (session) return <Navigate to={loc.state?.from ?? '/'} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Suspense fallback={<FullSpinner />}>
      <Routes>
        <Route path="/login" element={<Guest><Login /></Guest>} />
        <Route path="/register" element={<Guest><Register /></Guest>} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        <Route path="/take/:assignmentId" element={<Protected><TakeExam /></Protected>} />
        <Route path="/classrooms/:id/join-display" element={<Protected><JoinDisplay /></Protected>} />
        <Route path="/join/:code" element={<Protected><JoinByLink /></Protected>} />

        <Route element={<Protected><AppLayout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="/examinations" element={<Examinations />} />
          <Route path="/examinations/new" element={<NewExam />} />
          <Route path="/examinations/new/ai" element={<AiGenerate />} />
          <Route path="/examinations/import" element={<ImportJson />} />
          <Route path="/examinations/:id" element={<ExamEditor />} />
          <Route path="/classrooms" element={<Classrooms />} />
          <Route path="/classrooms/:id" element={<ClassroomDetail />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/analytics/:assignmentId" element={<AssignmentResults />} />
          <Route path="/results" element={<MyResults />} />
          <Route path="/results/:assignmentId" element={<ResultDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
