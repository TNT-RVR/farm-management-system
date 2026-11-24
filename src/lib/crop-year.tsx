import { createContext, useContext, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'rvr.cropYear'

type CropYearState = {
  cropYear: number
  setCropYear: (year: number) => void
}

const CropYearContext = createContext<CropYearState | null>(null)

export function CropYearProvider({ children }: { children: ReactNode }) {
  // Opening the app lands on the current year, every time. The choice is kept
  // so it survives moving between views and a refresh, but not into tomorrow:
  // a year picked once while looking something up used to persist and every
  // figure in the app would quietly be about 2025.
  //
  // sessionStorage alone did not deliver that. It lasts as long as the TAB,
  // and the app is a tab people leave open for days — so a year picked on
  // Monday was still in force on Thursday (Sam, 23 Nov 2026: "each time I go
  // into the app the year should be returned back to the default year we are
  // in"). The stored value now carries the day it was chosen and is ignored on
  // any other day.
  const [cropYear, setCropYearState] = useState<number>(() => {
    const now = new Date()
    const today = now.toDateString()
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored) {
        const [day, year] = stored.split('|')
        const parsed = Number.parseInt(year ?? '', 10)
        if (day === today && Number.isFinite(parsed)) return parsed
      }
    } catch {
      /* private window */
    }
    return now.getFullYear()
  })

  const setCropYear = (year: number) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, `${new Date().toDateString()}|${year}`)
    } catch {
      /* private window */
    }
    setCropYearState(year)
  }

  return (
    <CropYearContext.Provider value={{ cropYear, setCropYear }}>
      {children}
    </CropYearContext.Provider>
  )
}

export function useCropYear(): CropYearState {
  const ctx = useContext(CropYearContext)
  if (!ctx) throw new Error('useCropYear must be used within CropYearProvider')
  return ctx
}
