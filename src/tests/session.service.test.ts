import { describe, it, expect, vi, beforeEach } from "vitest"
import { createSession, listSessions } from "@/lib/services/session.service"
import { DomainError } from "@/lib/errors/DomainError"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"

// --- Mock all external dependencies ---
vi.mock("@/lib/repositories/patient.repository", () => ({
  findPatientById: vi.fn(),
  updatePatient: vi.fn(),
  countActivePatients: vi.fn(),
}))

vi.mock("@/lib/repositories/session.repository", () => ({
  insertSession: vi.fn(),
  findSessionsByPatient: vi.fn(),
  findSessionSummariesByPatient: vi.fn(),
}))

vi.mock("@/lib/services/limits.service", () => ({
  checkSessionLimit: vi.fn(),
  checkAudioLimit: vi.fn(),
  recordSessionUsage: vi.fn(),
}))

vi.mock("@/lib/services/openai.service", () => ({
  transcribeAudio: vi.fn(),
  generateSessionSummary: vi.fn(),
  generateCaseSummary: vi.fn(),
}))

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(),
      })),
    },
  },
}))

vi.mock("@/lib/logger/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { insertSession, findSessionsByPatient, findSessionSummariesByPatient } from "@/lib/repositories/session.repository"
import { checkSessionLimit, checkAudioLimit, recordSessionUsage } from "@/lib/services/limits.service"
import { transcribeAudio, generateSessionSummary, generateCaseSummary } from "@/lib/services/openai.service"
import { supabaseAdmin } from "@/lib/supabase-admin"

const mockFindPatient = vi.mocked(findPatientById)
const mockUpdatePatient = vi.mocked(updatePatient)
const mockInsertSession = vi.mocked(insertSession)
const mockFindSessions = vi.mocked(findSessionsByPatient)
const mockFindSummaries = vi.mocked(findSessionSummariesByPatient)
const mockCheckSession = vi.mocked(checkSessionLimit)
const mockCheckAudio = vi.mocked(checkAudioLimit)
const mockRecordUsage = vi.mocked(recordSessionUsage)
const mockTranscribe = vi.mocked(transcribeAudio)
const mockGenerateSummary = vi.mocked(generateSessionSummary)
const mockGenerateCaseSummary = vi.mocked(generateCaseSummary)

const PSYCH_ID = "psych-uuid-001"
const PATIENT_ID = "patient-uuid-001"

const mockPatient = {
  id: PATIENT_ID,
  psychologist_id: PSYCH_ID,
  name: "Ana García",
  age: 34,
  reason: "Ansiedad",
  case_summary: null,
  recording_consent_at: null,
  historical_import_done: false,
  is_active: true,
  created_at: new Date().toISOString(),
}

const mockSession = {
  id: "session-uuid-001",
  patient_id: PATIENT_ID,
  psychologist_id: PSYCH_ID,
  raw_text: "Notas de la sesión",
  transcription: null,
  ai_summary: null,
  audio_duration: null,
  session_notes: null,
  paid: false,
  paid_at: null,
  fee: null,
  session_date: null,
  created_at: new Date().toISOString(),
}

const mockAiSummary = {
  main_topic: "Ansiedad laboral",
  dominant_emotions: ["angustia", "miedo"],
  conflicts: ["Presión laboral"],
  clinical_hypotheses: ["Trastorno de ansiedad generalizada"],
  points_to_explore: ["Historia familiar de ansiedad"],
  sentimiento_predominante: "Ansiedad",
  pensamiento_predominante: "Catastrofización",
  mecanismo_defensa: "Racionalización",
  tematica_predominante: "Trabajo/rendimiento",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindPatient.mockResolvedValue(mockPatient)
  mockCheckSession.mockResolvedValue(undefined)
  mockCheckAudio.mockResolvedValue(undefined)
  mockRecordUsage.mockResolvedValue(undefined)
  mockInsertSession.mockResolvedValue(mockSession)
  mockFindSessions.mockResolvedValue([mockSession])
  mockFindSummaries.mockResolvedValue([])
  mockUpdatePatient.mockResolvedValue(mockPatient)
  mockGenerateSummary.mockResolvedValue(mockAiSummary)
  mockGenerateCaseSummary.mockResolvedValue("Resumen clínico acumulado.")
})

// ─────────────────────────────────────────────
// createSession — text only
// ─────────────────────────────────────────────
describe("createSession (text only)", () => {
  const textInput = {
    patient_id: PATIENT_ID,
    raw_text: "El paciente reporta mejoras en su estado de ánimo durante la semana.",
    audio_path: undefined,
  }

  it("verifies patient ownership before proceeding", async () => {
    await createSession(textInput, PSYCH_ID)
    expect(mockFindPatient).toHaveBeenCalledWith(PATIENT_ID, PSYCH_ID)
  })

  it("checks session limit before inserting", async () => {
    await createSession(textInput, PSYCH_ID)
    expect(mockCheckSession).toHaveBeenCalledWith(PSYCH_ID)
  })

  it("does not call transcribeAudio when no audio_path", async () => {
    await createSession(textInput, PSYCH_ID)
    expect(mockTranscribe).not.toHaveBeenCalled()
  })

  it("generates an AI summary from raw_text", async () => {
    await createSession(textInput, PSYCH_ID)
    expect(mockGenerateSummary).toHaveBeenCalledWith(expect.stringContaining(textInput.raw_text))
  })

  it("inserts the session with the AI summary as JSON string", async () => {
    await createSession(textInput, PSYCH_ID)
    const callArg = mockInsertSession.mock.calls[0][0]
    expect(callArg.ai_summary).toBe(JSON.stringify(mockAiSummary))
  })

  it("records session usage after successful insert", async () => {
    await createSession(textInput, PSYCH_ID)
    expect(mockRecordUsage).toHaveBeenCalledWith(PSYCH_ID, 0) // 0 audio minutes
  })

  it("returns the created session", async () => {
    const result = await createSession(textInput, PSYCH_ID)
    expect(result.session).toEqual(mockSession)
  })

  it("throws DomainError when patient is not found", async () => {
    mockFindPatient.mockResolvedValue(null)
    await expect(createSession(textInput, PSYCH_ID)).rejects.toBeInstanceOf(DomainError)
    expect(mockInsertSession).not.toHaveBeenCalled()
  })

  it("throws LimitExceededError and does not insert when session limit exceeded", async () => {
    mockCheckSession.mockRejectedValue(new LimitExceededError("Límite mensual"))
    await expect(createSession(textInput, PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
    expect(mockInsertSession).not.toHaveBeenCalled()
  })

  it("does not increment usage when limit check fails", async () => {
    mockCheckSession.mockRejectedValue(new LimitExceededError("Límite"))
    await expect(createSession(textInput, PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// createSession — case_summary update
// ─────────────────────────────────────────────
describe("createSession — case_summary", () => {
  const textInput = {
    patient_id: PATIENT_ID,
    raw_text: "Notas de sesión.",
    audio_path: undefined,
  }

  it("updates case_summary when session has an AI summary", async () => {
    const summaryJson = JSON.stringify(mockAiSummary)
    mockFindSummaries.mockResolvedValue([{ created_at: new Date().toISOString(), ai_summary: summaryJson }])
    const result = await createSession(textInput, PSYCH_ID)
    expect(mockGenerateCaseSummary).toHaveBeenCalled()
    expect(result.caseSummaryUpdated).toBe(true)
  })

  it("skips case_summary update when no session summaries exist", async () => {
    mockFindSummaries.mockResolvedValue([])
    mockGenerateSummary.mockResolvedValue(null as unknown as typeof mockAiSummary)
    // With no parsed summaries, case_summary is not recalculated
    const result = await createSession({ ...textInput, raw_text: "" }, PSYCH_ID)
    expect(result.caseSummaryUpdated).toBe(false)
  })

  it("session is still saved even if case_summary update fails", async () => {
    mockFindSummaries.mockResolvedValue([{ created_at: new Date().toISOString(), ai_summary: JSON.stringify(mockAiSummary) }])
    mockGenerateCaseSummary.mockRejectedValue(new Error("OpenAI down"))
    const result = await createSession(textInput, PSYCH_ID)
    // Session was created
    expect(result.session).toBeDefined()
    // case_summary update failed but didn't throw
    expect(result.caseSummaryUpdated).toBe(false)
  })
})

// ─────────────────────────────────────────────
// listSessions
// ─────────────────────────────────────────────
describe("listSessions", () => {
  it("returns sessions for a valid patient", async () => {
    const result = await listSessions(PATIENT_ID, PSYCH_ID)
    expect(mockFindPatient).toHaveBeenCalledWith(PATIENT_ID, PSYCH_ID)
    expect(mockFindSessions).toHaveBeenCalledWith(PATIENT_ID, PSYCH_ID)
    expect(result).toHaveLength(1)
  })

  it("throws DomainError when patient not found", async () => {
    mockFindPatient.mockResolvedValue(null)
    await expect(listSessions(PATIENT_ID, PSYCH_ID)).rejects.toBeInstanceOf(DomainError)
    expect(mockFindSessions).not.toHaveBeenCalled()
  })
})
