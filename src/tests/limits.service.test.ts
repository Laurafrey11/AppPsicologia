import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkPatientLimit, checkSessionLimit, checkAudioLimit, recordSessionUsage } from "@/lib/services/limits.service"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"

// --- Mock repositories ---
vi.mock("@/lib/repositories/limits.repository", () => ({
  getOrCreateLimits: vi.fn(),
  getOrCreateMonthlyUsage: vi.fn(),
  incrementUsage: vi.fn(),
}))

vi.mock("@/lib/repositories/patient.repository", () => ({
  countActivePatients: vi.fn(),
}))

vi.mock("@/lib/logger/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import {
  getOrCreateLimits,
  getOrCreateMonthlyUsage,
  incrementUsage,
} from "@/lib/repositories/limits.repository"
import { countActivePatients } from "@/lib/repositories/patient.repository"

const mockLimits = vi.mocked(getOrCreateLimits)
const mockUsage = vi.mocked(getOrCreateMonthlyUsage)
const mockCount = vi.mocked(countActivePatients)
const mockIncrement = vi.mocked(incrementUsage)

const PSYCH_ID = "psych-uuid-001"

const baseLimits = {
  id: "limits-1",
  psychologist_id: PSYCH_ID,
  max_patients: 30,
  max_sessions_per_month: 120,
  max_audio_minutes: 600,
}

const baseUsage = {
  id: "usage-1",
  psychologist_id: PSYCH_ID,
  month: "2026-02",
  sessions_count: 0,
  audio_minutes: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLimits.mockResolvedValue(baseLimits)
  mockUsage.mockResolvedValue(baseUsage)
  mockCount.mockResolvedValue(0)
  mockIncrement.mockResolvedValue(undefined)
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
  it("passes when sessions_count is below max", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, sessions_count: 119 })
    await expect(checkSessionLimit(PSYCH_ID)).resolves.toBeUndefined()
  })

  it("throws LimitExceededError when sessions_count equals max", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, sessions_count: 120 })
    await expect(checkSessionLimit(PSYCH_ID)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("passes on a fresh month (0 sessions)", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, sessions_count: 0 })
    await expect(checkSessionLimit(PSYCH_ID)).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────
// checkAudioLimit
// ─────────────────────────────────────────────
describe("checkAudioLimit", () => {
  it("passes when usage + new minutes is below max", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, audio_minutes: 500 })
    await expect(checkAudioLimit(PSYCH_ID, 99)).resolves.toBeUndefined()
  })

  it("passes when usage + new minutes equals max exactly", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, audio_minutes: 500 })
    await expect(checkAudioLimit(PSYCH_ID, 100)).resolves.toBeUndefined()
  })

  it("throws LimitExceededError when usage + new minutes exceeds max", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, audio_minutes: 500 })
    await expect(checkAudioLimit(PSYCH_ID, 101)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("throws when already at max and adding any minutes", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, audio_minutes: 600 })
    await expect(checkAudioLimit(PSYCH_ID, 1)).rejects.toBeInstanceOf(LimitExceededError)
  })

  it("error message includes remaining minutes", async () => {
    mockUsage.mockResolvedValue({ ...baseUsage, audio_minutes: 580 })
    try {
      await checkAudioLimit(PSYCH_ID, 25)
    } catch (err) {
      expect((err as Error).message).toContain("20") // 600 - 580 = 20 remaining
    }
  })
})

// ─────────────────────────────────────────────
// recordSessionUsage
// ─────────────────────────────────────────────
describe("recordSessionUsage", () => {
  it("calls incrementUsage with 1 session and the given audio minutes", async () => {
    await recordSessionUsage(PSYCH_ID, 15.5)
    expect(mockIncrement).toHaveBeenCalledWith(PSYCH_ID, 1, 15.5)
  })

  it("calls incrementUsage with 0 audio minutes for text-only sessions", async () => {
    await recordSessionUsage(PSYCH_ID, 0)
    expect(mockIncrement).toHaveBeenCalledWith(PSYCH_ID, 1, 0)
  })
})
