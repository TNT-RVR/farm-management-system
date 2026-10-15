import type { ConnectionStatus } from '@/lib/connections'

/** Static class names per status, so Tailwind ships them. */
export const STATUS_CLASS: Record<ConnectionStatus, { pill: string; text: string; box: string }> = {
  attention: { pill: 'bg-red-100 text-red-800', text: 'text-red-700', box: 'border-red-200 bg-red-50 text-red-800' },
  not_set_up: { pill: 'bg-gray-100 text-gray-600', text: 'text-gray-600', box: 'border-gray-200 bg-gray-50 text-gray-700' },
  working: { pill: 'bg-green-100 text-green-800', text: 'text-green-700', box: 'border-green-200 bg-green-50 text-green-800' },
  off: { pill: 'bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200', text: 'text-gray-400', box: 'border-gray-200 bg-gray-50 text-gray-500' },
}
