import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DataProvider } from './app/AppContext'
import { AppShell } from './app/AppShell'
import { AuthScreen, SetupScreen } from './app/AuthScreens'
import { AuthProvider, useAuth } from './app/auth'
import { ToastProvider } from './ui/Toast'
import { LoadingState } from './ui/States'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Transfers = lazy(() => import('./pages/Transfers'))
const Bills = lazy(() => import('./pages/Bills'))
const Debts = lazy(() => import('./pages/Debts'))
const Advances = lazy(() => import('./pages/Advances'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Forecast = lazy(() => import('./pages/Forecast'))
const Reports = lazy(() => import('./pages/Reports'))
const Vault = lazy(() => import('./pages/Vault'))
const Settings = lazy(() => import('./pages/Settings'))

function Gate() {
  const { status, user, demo, configured } = useAuth()

  if (demo) {
    return (
      <DataProvider scope="demo" mode="demo" userId={null}>
        <Routed />
      </DataProvider>
    )
  }
  if (!configured) return <SetupScreen />
  if (status === 'loading') return <LoadingState label="Checking your session…" fullScreen />
  if (status === 'signed_out' || !user) return <AuthScreen />
  return (
    <DataProvider key={user.id} scope={user.id} mode="cloud" userId={user.id}>
      <Routed />
    </DataProvider>
  )
}

function Routed() {
  return (
    <BrowserRouter>
      <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="transfers" element={<Transfers />} />
            <Route path="bills" element={<Bills />} />
            <Route path="debts" element={<Debts />} />
            <Route path="advances" element={<Advances />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="forecast" element={<Forecast />} />
            <Route path="reports" element={<Reports />} />
            <Route path="vault" element={<Vault />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  )
}
