import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { resolveFileUrl } from './offline-files'
import type { Database } from './database.types'

export type FieldFileRow = Database['public']['Tables']['field_files']['Row']
export type FieldFileKind = FieldFileRow['kind']

export const FILE_KINDS: { value: FieldFileKind; label: string }[] = [
  { value: 'soil_test', label: 'Soil test' },
  { value: 'fertility_map', label: 'Fertility map' },
  { value: 'rx', label: 'Rx / prescription' },
  { value: 'photo', label: 'Photo' },
  { value: 'doc', label: 'Document' },
]

const BUCKET = 'field-files'
const GEOSPATIAL_EXT = /\.(geojson|json|kml|zip|shp)$/i

export function isGeospatialFilename(name: string): boolean {
  return GEOSPATIAL_EXT.test(name)
}

export function useFieldFiles(fieldId: string | undefined) {
  return useQuery({
    queryKey: ['field_files', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_files')
        .select('*')
        .eq('field_id', fieldId!)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/** All geospatial files farm-wide — the map's overlay list. */
export function useGeospatialFiles() {
  return useQuery({
    queryKey: ['field_files', 'geospatial'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_files')
        .select('*')
        .in('kind', ['rx', 'fertility_map'])
      if (error) throw error
      return data.filter((f) => isGeospatialFilename(f.filename))
    },
  })
}

export function useUploadFieldFile(fieldId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      kind,
      cropYear,
    }: {
      file: File
      kind: FieldFileKind
      cropYear: number | null
    }) => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Not signed in')
      const safeName = file.name.replace(/[^\w.\- ()]/g, '_')
      const path = `${fieldId}/${kind}/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr
      const { error: rowErr } = await supabase.from('field_files').insert({
        field_id: fieldId,
        kind,
        storage_path: path,
        filename: file.name,
        crop_year: cropYear,
        uploaded_by: auth.user.id,
        meta: { size: file.size, content_type: file.type, geospatial: isGeospatialFilename(file.name) },
      })
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([path])
        throw rowErr
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['field_files'] }),
  })
}

export function useDeleteFieldFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: FieldFileRow) => {
      const { error: rowErr } = await supabase.from('field_files').delete().eq('id', file.id)
      if (rowErr) throw rowErr
      const { error: objErr } = await supabase.storage.from(BUCKET).remove([file.storage_path])
      if (objErr) throw objErr
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['field_files'] }),
  })
}

export async function openFieldFile(file: FieldFileRow): Promise<void> {
  // Signed URL when there is a connection, the copy saved on this device when
  // there is not. resolveFileUrl decides; see lib/offline-files.ts for why the
  // saved copy cannot simply be the signed URL cached.
  const url = await resolveFileUrl(file.storage_path)
  if (!url) {
    throw new Error(
      navigator.onLine
        ? 'Could not open this file.'
        : `${file.filename} was not saved to this device. Settings → Offline access saves the files before you leave.`,
    )
  }
  window.open(url, '_blank', 'noopener')
}

export async function downloadFieldFileData(file: FieldFileRow): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(file.storage_path)
  if (error) throw error
  return data.arrayBuffer()
}
