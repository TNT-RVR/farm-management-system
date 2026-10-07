import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import App from './App'
import { AuthProvider } from '@/lib/auth'
import { CropYearProvider } from '@/lib/crop-year'
import { installAppUpdateHandling } from '@/lib/appUpdate'
import { OFFLINE_MAX_AGE, idbPersister, shouldPersistQuery } from '@/lib/offline'
import './index.css'
import { installIssueReporting } from './lib/app-issues'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Kept for a week rather than the default five minutes. gcTime is what
      // decides whether a query is still in the cache to BE saved: at five
      // minutes, anything not looked at recently is dropped before the app is
      // closed, and the phone gets to the field with an empty cache.
      gcTime: OFFLINE_MAX_AGE,
      // Left on the default 'online' after trying 'offlineFirst' and watching
      // the irrigation graph spin forever in a field.
      //
      // Cached data is handed over either way — networkMode governs FETCHING,
      // not reading. The difference is what happens to a query with nothing
      // cached: 'online' parks it as paused, so isLoading is false and the
      // screen falls through to its empty state, while 'offlineFirst' fires a
      // request that cannot succeed and leaves the query pending and fetching
      // behind a spinner that never resolves. A screen that says it has nothing
      // is honest; one that says it is loading, forever, is not.
      retry: (count, error) =>
        navigator.onLine && count < 2 && !(error instanceof TypeError),
    },
    mutations: {
      // 'always', NOT the default 'online', and this one is easy to get exactly
      // backwards. On 'online' an offline mutation is PAUSED and then replayed
      // when the connection returns — which is the queued-write feature this
      // deliberately does not have, arrived at by accident and without any of
      // the care it would need. A save would sit spinning in a field and fire
      // hours later against a record that had moved underneath it.
      //
      // 'always' lets it run and fail at once, so the refusal happens while the
      // person is still looking at what they typed.
      networkMode: 'always',
      retry: false,
    },
  },
})

if (import.meta.env.DEV) {
  // Debug handle for driving/inspecting queries from the console
  ;(window as unknown as Record<string, unknown>).__qc = queryClient
}

// A deploy can land under an open tab and take its chunks away; this reloads
// once when that happens, instead of leaving a white screen behind.
installAppUpdateHandling()
// Errors nothing caught go to app_issues, for Claude to fix (lib/app-issues.ts).
installIssueReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: OFFLINE_MAX_AGE,
        // Bump when a query's stored shape changes, so a restored cache from an
        // older build is thrown away rather than fed to code that cannot read
        // it.
        buster: 'v1',
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      <AuthProvider>
        <CropYearProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </CropYearProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
