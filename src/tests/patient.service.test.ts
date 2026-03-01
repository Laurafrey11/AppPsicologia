import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createPatient,
  listPatients,
  getPatient,
  editPatient,
} from "@/lib/services/patient.service"
import { DomainError } from "@/lib/errors/DomainError"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"

// --- Mock all external dependencies ---
vi.mock("@/lib/repositories/patient.repository", () => ({
  insertPatient: vi.fn(),
  findActivePatients: vi.fn(),
  findPatientById: vi.fn(),
  updatePatient: vi.fn(),
  countActivePatients: vi.fn(),
}))

vi.mock("@/lib/services/limits.service", () => ({
  checkPatientLimit: vi.fn(),
}))

vi.mock("@/lib/logger/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import {
  insertPatient,
  findActivePatients,
  findPatientById,
  updatePatient,
} from "@/lib/repositories/patient.repository"
import { checkPatientLimit } from "@/lib/services/limits.service"

const mockInsert = vi.mocked(insertPatient)
const mockFindAll = vi.mocked(findActivePatients)
const mockFindById = vi.mocked(findPatientById)
const mockUpdate = vi.mocked(updatePatient)
const mockCheckLimit = vi.mocked(checkPatientLimit)

const PSYCH_ID = "psych-uuid-001"

const mockPatient = {
  id: "patient-uuid-001",
  psychologist_id: PSYCH_ID,
  name: "Ana García",
  age: 34,
  reason: "Ansiedad generalizada y dificultades en relaciones interpersonales",
  case_summary: null,
  recording_consent_at: null,
  historical_import_done: false,
  is_active: true,
  created_at: new Date().toISOString(),
}

const createInput = {
  name: "Ana García",
  age: 34,
  reason: "Ansiedad generalizada y dificultades en relaciones interpersonales",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckLimit.mockResolvedValue(undefined)
  mockInsert.mockResolvedValue(mockPatient)
  mockFindAll.mockResolvedValue([mockPatient])
  mockFindById.mockResolvedValue(mockPatient)
  mockUpdate.mockResolvedValue({ ...mockPatient, name: "Updated Name" })
})

// ─────────────────────────────────────────────
// createPatient
// ─────────────────────────────────────────────
describe("createPatient", () => {
  it("checks limit before inserting", async () => {
    await createPatient(createInput, PSYCH_ID)
    expect(mockCheckLimit).toHaveBeenCalledWith(PSYCH_ID)
    expect(mockInsert).toHaveBeenCalled()
  })

  it("returns the created patient", async () => {
    const result = await createPatient(createInput, PSYCH_ID)
    expect(result).toEqual(mockPatient)
  })

  it("propagates LimitExceededError when limit is reached", async () => {
    mockCheckLimit.mockRejectedValue(new LimitExceededError("Límite alcanzado"))
    await expect(createPatient(createInput, PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("passes psychologistId to insertPatient, not from input", async () => {
    await createPatient(createInput, PSYCH_ID)
    expect(mockInsert).toHaveBeenCalledWith(createInput, PSYCH_ID)
  })
})

// ─────────────────────────────────────────────
// listPatients
// ─────────────────────────────────────────────
describe("listPatients", () => {
  it("returns active patients for the psychologist", async () => {
    const result = await listPatients(PSYCH_ID)
    expect(mockFindAll).toHaveBeenCalledWith(PSYCH_ID)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("Ana García")
  })

  it("returns empty array when no patients", async () => {
    mockFindAll.mockResolvedValue([])
    const result = await listPatients(PSYCH_ID)
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────
// getPatient
// ─────────────────────────────────────────────
describe("getPatient", () => {
  it("returns the patient when found and owned", async () => {
    const result = await getPatient("patient-uuid-001", PSYCH_ID)
    expect(result).toEqual(mockPatient)
  })

  it("throws DomainError when patient is not found", async () => {
    mockFindById.mockResolvedValue(null)
    await expect(getPatient("nonexistent", PSYCH_ID)).rejects.toBeInstanceOf(DomainError)
  })

  it("throws DomainError when patient belongs to another psychologist (repository returns null)", async () => {
    mockFindById.mockResolvedValue(null) // repo enforces ownership
    await expect(getPatient("patient-uuid-001", "other-psych")).rejects.toBeInstanceOf(DomainError)
  })
})

// ─────────────────────────────────────────────
// editPatient
// ─────────────────────────────────────────────
describe("editPatient", () => {
  it("updates and returns the patient when it exists", async () => {
    const input = { name: "Updated Name" }
    const result = await editPatient("patient-uuid-001", PSYCH_ID, input)
    expect(mockUpdate).toHaveBeenCalledWith("patient-uuid-001", PSYCH_ID, input)
    expect(result.name).toBe("Updated Name")
  })

  it("throws DomainError when patient does not exist", async () => {
    mockFindById.mockResolvedValue(null)
    await expect(editPatient("nonexistent", PSYCH_ID, { name: "New" })).rejects.toBeInstanceOf(DomainError)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("can deactivate a patient with is_active: false", async () => {
    const input = { is_active: false }
    await editPatient("patient-uuid-001", PSYCH_ID, input)
    expect(mockUpdate).toHaveBeenCalledWith("patient-uuid-001", PSYCH_ID, input)
  })
})
