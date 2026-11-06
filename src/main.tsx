import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { ErrorBoundary, FeedbackProvider, RouteError } from './components/ui'
import { isConfigured } from './lib/supabase'
import './index.css'

function NotConfigured() {
  return (
    <div className="mx-auto mt-16 max-w-xl p-6">
      <h1 className="text-2xl font-semibold">EXAMINA is not configured yet</h1>
      <p className="mt-3 text-sm text-muted">The Supabase environment variables are missing. Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code>, fill in <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>, then restart <code className="font-mono">npm run dev</code>. On Vercel, add the same variables under Project → Settings → Environment Variables and redeploy. See README.md for step-by-step instructions.</p>
    </div>
  )
}

/**
 * Browser auto-translate (Chrome/Google Translate/Edge) replaces text nodes with <font> wrappers behind React's back.
 * The next update then throws "Failed to execute 'insertBefore'/'removeChild' on 'Node'" and takes the page down, which on an
 * exam screen is the worst possible moment. This is the widely used guard (facebook/react#11538): when React's reference
 * node is no longer a child, skip that single DOM operation instead of throwing. Live numbers on the exam screen are
 * additionally marked translate="no" so they keep updating.
 */
if (typeof Node === 'function' && Node.prototype) {
  const removeChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child
    return removeChild.call(this, child) as T
  }
  const insertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return this.appendChild(node) as T   // keep the new content visible rather than dropping it
    return insertBefore.call(this, node, ref) as T
  }
}

function Root() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}

// A data router (instead of <BrowserRouter>) is what makes useBlocker() available, so the editor can warn before
// in-app navigation discards unsaved work. All real routes still live in <App/> under this single splat route.
const router = createBrowserRouter([{ path: '*', element: <Root />, errorElement: <RouteError /> }])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isConfigured ? (
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    ) : <NotConfigured />}
  </React.StrictMode>,
)
