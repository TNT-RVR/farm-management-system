import { createContext, useContext, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'rvr.cropYear'

type CropYearState = {
  cropYear: number
  setCropYear: (year: number) => void
}

const CropYearContext = createContext<CropYearState | null>(null)

export function CropYearProvider({ children }: { children: ReactNode }) {
  // Opening the app lands on the current year, every time. The choice is kept in
  // sessionStorage so it survives moving between views and a refresh, but not
  // into tomorrow: a year picked once while looking something up used to persist
  // indefinitely, and every figure in the app would quietly be about 2025.
  const [cropYear, setCropYearState] = useState<number>(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN
    return Number.isFinite(parsed) ? parsed : new Date().getFullYear()
  })

  const setCropYear = (year: number) => {
    sessionStorage.setItem(STORAGE_KEY, String(year))
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
