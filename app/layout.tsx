import './styles.css'

export const metadata = {
  title: 'PatLau',
  description: 'Attendance and payment tracking for students.',
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