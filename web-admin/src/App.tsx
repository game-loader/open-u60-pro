import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Toaster } from './components/ui'
import { getToken } from './lib/api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import SignalPage from './pages/Signal'
import SmsPage from './pages/Sms'
import CallPage from './pages/Call'
import NetworkPage from './pages/Network'
import CellsPage from './pages/Cells'
import WifiPage from './pages/Wifi'
import RouterPage from './pages/Router'
import SimPage from './pages/Sim'
import DevicePage from './pages/Device'
import ToolsPage from './pages/Tools'
import MihomoPage from './pages/Mihomo'
import TailscalePage from './pages/Tailscale'

function RequireAuth({ children }: { children: React.ReactElement }) {
  const location = useLocation()
  if (!getToken()) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="signal" element={<SignalPage />} />
          <Route path="sms" element={<SmsPage />} />
          <Route path="call" element={<CallPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="cells" element={<CellsPage />} />
          <Route path="wifi" element={<WifiPage />} />
          <Route path="router" element={<RouterPage />} />
          <Route path="sim" element={<SimPage />} />
          <Route path="device" element={<DevicePage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="mihomo" element={<MihomoPage />} />
          <Route path="tailscale" element={<TailscalePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
