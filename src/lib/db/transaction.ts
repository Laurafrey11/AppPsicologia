export async function runTransaction<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    // Aquí iría begin transaction (Supabase / Prisma)
    const result = await operation()
    // commit
    return result
  } catch (error) {
    // rollback
    throw error
  }
}
