import './styles.css'

export const metadata = {
  title: 'Contexto Ads — Central Operacional',
  description: 'Decisões de campanha com evidência, aprovação e controle.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
