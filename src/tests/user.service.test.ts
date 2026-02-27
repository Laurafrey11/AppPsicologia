import { describe, it, expect } from "vitest"
import { createUser } from "@/lib/services/user.service"

describe("createUser Service", () => {
  it("should create valid gmail user", async () => {
    const user = await createUser({
      name: "Juan",
      email: "juan@gmail.com"
    })

    expect(user.email).toBe("juan@gmail.com")
  })

  it("should reject non gmail", async () => {
    await expect(
      createUser({
        name: "Pedro",
        email: "pedro@yahoo.com"
      })
    ).rejects.toThrow()
  })
})
