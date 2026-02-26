import type { Metadata } from 'next'
import { Inter, DM_Serif_Display, DM_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const dmSerif = DM_Serif_Display({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-dm-serif' })
const dmMono = DM_Mono({ weight: ['300', '400', '500'], subsets: ['latin'], variable: '--font-dm-mono' })

export const metadata: Metadata = {
  title: 'AI Document OCR',
  description: 'Extract text from PDFs and images using Databricks',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${dmSerif.variable} ${dmMono.variable} bg-slate-50 text-slate-900 antialiased`}>{children}</body>
    </html>
  )
}
