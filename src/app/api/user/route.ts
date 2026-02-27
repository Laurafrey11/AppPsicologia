import { NextResponse } from "next/server"
import { createUserSchema } from "@/lib/validators/user.schema"
import { createUser } from "@/lib/services/user.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = createUserSchema.parse(body)

    const user = await createUser(parsed)

    return NextResponse.json(user, { status: 201 })
  } catch (error: any) {
    logger.error("API Error", { error: error.message })

    if (error instanceof BaseError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      )
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}
