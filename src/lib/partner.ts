// The public copy's stand-in for partner.ts, which is farm-only: the copy has
// staff accounts only, so every check here is the staff answer.
export const isPartner: (role: string | null | undefined) => boolean = () => false
export const setPartnerMode: (on: boolean) => void = () => {}
export const fieldsSource = () => 'fields' as const
export const cropsSource = () => 'crops' as const
export const PARTNER_HOME = '/dashboard'
export const isPartnerPath: (pathname: string) => boolean = () => true
