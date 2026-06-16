import type { Metadata } from 'next'
import './styles.css'
import AttendanceHistoryEnhancer from './components/AttendanceHistoryEnhancer'

export const metadata: Metadata = {
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
        <body>{children}<AttendanceHistoryEnhancer /></body>
        </html>
    )
}