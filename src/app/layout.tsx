export const metadata = {
  title: "Vibecode Starter",
  description: "Scalable SaaS Architecture"
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
