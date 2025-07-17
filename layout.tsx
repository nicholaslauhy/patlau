import './styles.css'

export const metadata = {
  title: 'NUSMapper',
  description: 'Find exchange opportunities for NUS students',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
