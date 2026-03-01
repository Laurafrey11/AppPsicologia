import { supabaseAdmin } from "@/lib/supabase-admin"

export type PatientDocument = {
  id: string
  psychologist_id: string
  patient_id: string
  document_type: string | null
  file_path: string
  file_name: string | null
  file_size: number | null
  created_at: string
}

export type InsertDocumentData = {
  psychologist_id: string
  patient_id: string
  document_type: string | null
  file_path: string
  file_name: string | null
  file_size: number | null
}

export async function insertDocument(data: InsertDocumentData): Promise<PatientDocument> {
  const { data: doc, error } = await supabaseAdmin
    .from("patient_documents")
    .insert(data)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return doc
}

export async function findDocumentsByPatient(
  patientId: string,
  psychologistId: string
): Promise<PatientDocument[]> {
  const { data, error } = await supabaseAdmin
    .from("patient_documents")
    .select("*")
    .eq("patient_id", patientId)
    .eq("psychologist_id", psychologistId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function findDocumentById(
  id: string,
  psychologistId: string
): Promise<PatientDocument | null> {
  const { data, error } = await supabaseAdmin
    .from("patient_documents")
    .select("*")
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .single()
  if (error) return null
  return data
}

/** Deletes the DB record only. The caller is responsible for removing the storage file. */
export async function deleteDocument(
  id: string,
  psychologistId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("patient_documents")
    .delete()
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
  if (error) throw new Error(error.message)
}
