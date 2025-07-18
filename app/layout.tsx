import './styles.css'

export const metadata = {
  title: 'RedSquare',
  description: 'A platform to track attendance and payments of students, made easy with technology.',
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
