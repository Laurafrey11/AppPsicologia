import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkPatientLimit, checkSessionLimit, checkAudioLimit, recordSessionUsage } from "@/lib/services/limits.service"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"

// --- Mock repositories ---
vi.mock("@/lib/repositories/limits.repository", () => ({
  getOrCreateLimits: vi.fn(),
}))

vi.mock("@/lib/repositories/patient.repository", () => ({
  countActivePatients: vi.fn(),
}))

vi.mock("@/lib/repositories/session.repository", () => ({
  countSessionsThisMonth: vi.fn(),
  sumAudioMinutesThisMonth: vi.fn(),
}))

vi.mock("@/lib/logger/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import { getOrCreateLimits } from "@/lib/repositories/limits.repository"
import { countActivePatients } from "@/lib/repositories/patient.repository"
import { countSessionsThisMonth, sumAudioMinutesThisMonth } from "@/lib/repositories/session.repository"

const mockLimits = vi.mocked(getOrCreateLimits)
const mockCount = vi.mocked(countActivePatients)
const mockSessionCount = vi.mocked(countSessionsThisMonth)
const mockAudioSum = vi.mocked(sumAudioMinutesThisMonth)

const PSYCH_ID = "psych-uuid-001"

const baseLimits = {
  id: "limits-1",
  psychologist_id: PSYCH_ID,
  max_patients: 30,
  max_sessions_per_month: 120,
  max_audio_minutes: 600,
  created_at: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimits.mockResolvedValue(baseLimits)
  mockCount.mockResolvedValue(0)
  mockSessionCount.mockResolvedValue(0)
  mockAudioSum.mockResolvedValue(0)
})

// ─────────────────────────────────────────────
// checkPatientLimit
// ─────────────────────────────────────────────
describe("checkPatientLimit", () => {
  it("passes when active count is below max", async () => {
    mockCount.mockResolvedValue(29)
    await expect(checkPatientLimit(PSYCH_ID)).resolves.toBeUndefined()
  })

  it("throws LimitExceededError when active count equals max", async () => {
    mockCount.mockResolvedValue(30)
    await expect(checkPatientLimit(PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("throws LimitExceededError when active count exceeds max", async () => {
    mockCount.mockResolvedValue(35)
    await expect(checkPatientLimit(PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("includes the limit number in the error message", async () => {
    mockCount.mockResolvedValue(30)
    try {
      await checkPatientLimit(PSYCH_ID)
    } catch (err) {
      expect((err as Error).message).toContain("30")
    }
  })
})

// ─────────────────────────────────────────────
// checkSessionLimit
// ─────────────────────────────────────────────
describe("checkSessionLimit", () => {
  it("passes when session count is below max", async () => {
    mockSessionCount.mockResolvedValue(119)
    await expect(checkSessionLimit(PSYCH_ID)).resolves.toBeUndefined()
  })

  it("throws LimitExceededError when session count equals max", async () => {
    mockSessionCount.mockResolvedValue(120)
    await expect(checkSessionLimit(PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("passes on a fresh month (0 sessions)", async () => {
    mockSessionCount.mockResolvedValue(0)
    await expect(checkSessionLimit(PSYCH_ID)).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────
// checkAudioLimit
// ─────────────────────────────────────────────
describe("checkAudioLimit", () => {
  it("passes when usage + new minutes is below max", async () => {
    mockAudioSum.mockResolvedValue(500)
    await expect(checkAudioLimit(PSYCH_ID, 99)).resolves.toBeUndefined()
  })

  it("passes when usage + new minutes equals max exactly", async () => {
    mockAudioSum.mockResolvedValue(500)
    await expect(checkAudioLimit(PSYCH_ID, 100)).resolves.toBeUndefined()
  })

  it("throws LimitExceededError when usage + new minutes exceeds max", async () => {
    mockAudioSum.mockResolvedValue(500)
    await expect(checkAudioLimit(PSYCH_ID, 101)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("throws when already at max and adding any minutes", async () => {
    mockAudioSum.mockResolvedValue(600)
    await expect(checkAudioLimit(PSYCH_ID, 1)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("error message includes remaining minutes", async () => {
    mockAudioSum.mockResolvedValue(580)
    try {
      await checkAudioLimit(PSYCH_ID, 25)
    } catch (err) {
      expect((err as Error).message).toContain("20") // 600 - 580 = 20 remaining
    }
  })
})

// ─────────────────────────────────────────────
// recordSessionUsage (no-op)
// ─────────────────────────────────────────────
describe("recordSessionUsage", () => {
  it("resolves without error (no-op)", async () => {
    await expect(recordSessionUsage(PSYCH_ID, 15)).resolves.toBeUndefined()
  })
})
