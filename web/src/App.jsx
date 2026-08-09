import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminRoute, TesterRoute } from '@/components/auth/protected-route'
import { AdminLayout } from '@/components/layout/admin-layout'
import { TesterLayout } from '@/components/layout/tester-layout'
import { LoginPage } from '@/pages/login-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { DLQPage } from '@/pages/dlq-page'
import { RCTestPage } from '@/pages/rc-test-page'
import { DLTestPage } from '@/pages/dl-test-page'
import { PolicyTestPage } from '@/pages/policy-test-page'
import { ClaimTestPage } from '@/pages/claim-test-page'
import { WorkshopTestPage } from '@/pages/workshop-test-page'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="dlq" element={<DLQPage />} />
        </Route>

        <Route path="/test" element={<TesterRoute><TesterLayout /></TesterRoute>}>
          <Route index element={<Navigate to="/test/rc" replace />} />
          <Route path="rc"       element={<RCTestPage />} />
          <Route path="dl"       element={<DLTestPage />} />
          <Route path="policy"   element={<PolicyTestPage />} />
          <Route path="claim"    element={<ClaimTestPage />} />
          <Route path="workshop" element={<WorkshopTestPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
