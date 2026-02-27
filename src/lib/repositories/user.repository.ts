import { runTransaction } from "../db/transaction"

type User = {
  id: string
  name: string
  email: string
}

export async function insertUser(data: {
  name: string
  email: string
}): Promise<User> {
  return runTransaction(async () => {
    return {
      id: crypto.randomUUID(),
      ...data
    }
  })
}
