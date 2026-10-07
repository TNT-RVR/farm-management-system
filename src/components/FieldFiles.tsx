import { useRef, useState } from 'react'
import { FileText, Globe, Image, Trash2, Upload } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import {
  FILE_KINDS,
  isGeospatialFilename,
  openFieldFile,
  useDeleteFieldFile,
  useFieldFiles,
  useUploadFieldFile,
  type FieldFileKind,
  type FieldFileRow,
} from '@/lib/files'

function kindLabel(kind: FieldFileKind): string {
  return FILE_KINDS.find((k) => k.value === kind)?.label ?? kind
}

function FileIcon({ file }: { file: FieldFileRow }) {
  if (isGeospatialFilename(file.filename)) return <Globe className="h-4 w-4 text-blue-500" />
  if (file.kind === 'photo') return <Image className="h-4 w-4 text-purple-500" />
  return <FileText className="h-4 w-4 text-gray-400" />
}

export function FieldFiles({ fieldId }: { fieldId: string }) {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const { data: files } = useFieldFiles(fieldId)
  const upload = useUploadFieldFile(fieldId)
  const del = useDeleteFieldFile()
  const inputRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<FieldFileKind>('doc')

  const canDelete = (f: FieldFileRow) =>
    hasManagerAccess(profile?.role) || f.uploaded_by === profile?.id

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Files</h3>
        <div className="flex items-center gap-2">
          <Select
            value={kind}
            size="sm"
            ariaLabel="File kind"
            className="w-32"
            onChange={(v) => setKind(v as FieldFileKind)}
            options={FILE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                upload.mutate({
                  file,
                  kind,
                  cropYear: kind === 'soil_test' || kind === 'rx' || kind === 'fertility_map' ? cropYear : null,
                })
              }
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {upload.isError && (
        <p className="mt-2 text-xs text-red-600">{(upload.error as Error).message}</p>
      )}

      {files?.length ? (
        <ul className="mt-3 divide-y divide-gray-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-2">
              <FileIcon file={f} />
              <button
                onClick={() => void openFieldFile(f)}
                className="min-w-0 flex-1 truncate text-left text-sm text-brand-700 hover:underline"
                title={f.filename}
              >
                {f.filename}
              </button>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {kindLabel(f.kind)}
                {f.crop_year ? ` · ${f.crop_year}` : ''}
              </span>
              {canDelete(f) && (
                <button
                  onClick={() => {
                    if (confirm(`Delete ${f.filename}?`)) del.mutate(f)
                  }}
                  className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${f.filename}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-gray-400">No files yet.</p>
      )}
    </div>
  )
}
