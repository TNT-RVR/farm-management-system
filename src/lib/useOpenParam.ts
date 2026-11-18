import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Open the record a link named (`?open=<id>`, as the app search writes it),
 * then take the id off the address so closing the record does not reopen it
 * and Back does not land on it twice. `name` is the parameter's name.
 */
export function useOpenParam(open: (id: string) => void, name = 'open') {
  const [params, setParams] = useSearchParams()
  const id = params.get(name)
  useEffect(() => {
    if (!id) return
    open(id)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete(name)
        return next
      },
      { replace: true },
    )
    // `open` is a fresh closure each render; only the id should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, name, setParams])
}
