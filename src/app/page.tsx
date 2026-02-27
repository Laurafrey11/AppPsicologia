import { redirect } from "next/navigation"

// Root redirect handled by middleware:
// - authenticated → /dashboard
// - unauthenticated → /login
export default function Home() {
  redirect("/login")
}
