"use client"

import { useEffect, useState, useRef } from "react"

type DocumentType = "consentimiento" | "comprobante" | "otro"

interface PatientDocument {
  id: string
  document_type: string | null
  file_name: string | null
  file_size: number | null
  created_at: string
}

const TYPE_LABELS: Record<DocumentType, string> = {
  consentimiento: "Consentimiento",
  comprobante: "Comprobante",
  otro: "Otro",
}

const TYPE_COLORS: Record<DocumentType, string> = {
  consentimiento: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900",
  comprobante: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
  otro: "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700",
}

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"]
const MAX_SIZE_BYTES = 10 * 1024 * 1024

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  patientId: string
  token: string
}

export function PatientDocuments({ patientId, token }: Props) {
  const [documents, setDocuments] = useState<PatientDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<DocumentType>("consentimiento")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const authHeaders = { Authorization: `Bearer ${token}` }

  async function loadDocuments() {
    try {
      const res = await fetch(`/api/patients/${patientId}/documents`, { headers: authHeaders })
      const data = await res.json()
      if (res.ok) setDocuments(data.documents ?? [])
    } catch {
      // silently fail — non-critical section
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDocuments() }, [patientId])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setUploadError(null)
    if (!file) { setSelectedFile(null); return }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadError(`Tipo no permitido. Aceptados: ${ALLOWED_EXTENSIONS.join(", ")}`)
      setSelectedFile(null)
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError("El archivo supera el límite de 10 MB")
      setSelectedFile(null)
      return
    }
    setSelectedFile(file)
  }

  async function handleUpload() {
    if (!selectedFile) return
    setUploading(true)
    setUploadError(null)

    try {
      const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? ""

      // 1. Get signed upload URL
      const urlRes = await fetch(`/api/patients/${patientId}/documents/upload-url`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          ext,
          document_type: docType,
          file_name: selectedFile.name,
          file_size: selectedFile.size,
        }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData.error ?? `HTTP ${urlRes.status}`)

      // 2. Upload directly to Supabase Storage
      const putRes = await fetch(urlData.upload_url, {
        method: "PUT",
        headers: { "Content-Type": selectedFile.type || "application/octet-stream" },
        body: selectedFile,
      })
      if (!putRes.ok) throw new Error("Error al subir el archivo al storage")

      // 3. Save the DB record
      const saveRes = await fetch(`/api/patients/${patientId}/documents`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: urlData.storage_path,
          document_type: docType,
          file_name: selectedFile.name,
          file_size: selectedFile.size,
        }),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) throw new Error(saveData.error ?? `HTTP ${saveRes.status}`)

      // Reset and reload
      setSelectedFile(null)
      setDocType("consentimiento")
      setShowUploadForm(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
      await loadDocuments()
    } catch (err: unknown) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(docId: string) {
    setDownloading(docId)
    try {
      const res = await fetch(`/api/documents/${docId}`, { headers: authHeaders })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Error al descargar")
      window.open(data.download_url, "_blank", "noopener,noreferrer")
    } catch {
      // ignore
    } finally {
      setDownloading(null)
    }
  }

  async function handleDelete(docId: string) {
    setDeleting(docId)
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId))
      }
    } catch {
      // ignore
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  function cancelUpload() {
    setShowUploadForm(false)
    setSelectedFile(null)
    setUploadError(null)
    setDocType("consentimiento")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <section className="mb-8 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
          Documentos {documents.length > 0 && `(${documents.length})`}
        </h2>
        {!showUploadForm && (
          <button
            onClick={() => setShowUploadForm(true)}
            className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
          >
            + Subir documento
          </button>
        )}
      </div>

      {/* Upload form */}
      {showUploadForm && (
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Type selector */}
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
              className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
            >
              <option value="consentimiento">Consentimiento informado</option>
              <option value="comprobante">Comprobante de pago</option>
              <option value="otro">Otro documento</option>
            </select>

            {/* File picker */}
            <label className="flex-1 cursor-pointer">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex items-center gap-2 border border-dashed border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 hover:border-blue-400 dark:hover:border-blue-600 transition-colors">
                <span className="text-sm text-gray-500 dark:text-slate-400 flex-1 truncate">
                  {selectedFile ? selectedFile.name : "Seleccionar archivo (PDF, JPG, PNG · máx. 10 MB)"}
                </span>
                {selectedFile && (
                  <span className="text-xs text-gray-400 dark:text-slate-500 flex-shrink-0">
                    {formatSize(selectedFile.size)}
                  </span>
                )}
              </div>
            </label>
          </div>

          {uploadError && (
            <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {uploading ? "Subiendo..." : "Subir"}
            </button>
            <button
              onClick={cancelUpload}
              disabled={uploading}
              className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 px-3 py-1.5 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <p className="px-5 py-4 text-sm text-gray-400 dark:text-slate-500">Cargando...</p>
      ) : documents.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-400 dark:text-slate-500">
          No hay documentos adjuntos.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {documents.map((doc) => {
            const type = (doc.document_type ?? "otro") as DocumentType
            const colorClass = TYPE_COLORS[type] ?? TYPE_COLORS.otro
            const labelText = TYPE_LABELS[type] ?? doc.document_type ?? "Otro"
            const isDeleting = deleting === doc.id
            const isDownloading = downloading === doc.id
            const askConfirm = confirmDelete === doc.id

            return (
              <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                {/* Type badge */}
                <span className={`text-xs border px-2 py-0.5 rounded-full flex-shrink-0 ${colorClass}`}>
                  {labelText}
                </span>

                {/* Filename + date */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 dark:text-slate-200 truncate">
                    {doc.file_name ?? "Documento"}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    {formatDate(doc.created_at)}
                    {doc.file_size != null && ` · ${formatSize(doc.file_size)}`}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDownload(doc.id)}
                    disabled={isDownloading}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                  >
                    {isDownloading ? "..." : "Descargar"}
                  </button>

                  {askConfirm ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400 dark:text-slate-500">¿Eliminar?</span>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={isDeleting}
                        className="text-xs text-red-600 dark:text-red-400 font-medium hover:underline disabled:opacity-50"
                      >
                        {isDeleting ? "..." : "Sí"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-gray-400 dark:text-slate-500 hover:underline"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(doc.id)}
                      className="text-xs text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
