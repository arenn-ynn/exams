import { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'

export default function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white"><GraduationCap className="h-5 w-5" /></span>EXAMINA
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-sm text-muted">{footer}</div>}
    </div>
  )
}
