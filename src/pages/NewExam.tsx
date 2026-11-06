import { Link } from 'react-router-dom'
import { FileJson, Sparkles } from 'lucide-react'
import { PageHeader } from '../components/ui'

export default function NewExam() {
  return (
    <>
      <PageHeader title="Create examination" subtitle="Choose how you want to start. You can edit everything afterwards, and nothing is visible to students until you publish and assign it." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link to="/examinations/new/ai" className="card block p-6 transition-colors hover:border-accent">
          <Sparkles className="h-6 w-6 text-accent-fg" />
          <h2 className="mt-3 text-lg font-semibold">Create with AI</h2>
          <p className="mt-1 text-sm text-muted">Describe the topic, difficulty and question types in a guided form. EXAMINA generates a draft you review and edit before saving.</p>
        </Link>
        <Link to="/examinations/import" className="card block p-6 transition-colors hover:border-accent">
          <FileJson className="h-6 w-6 text-accent-fg" />
          <h2 className="mt-3 text-lg font-semibold">Import JSON</h2>
          <p className="mt-1 text-sm text-muted">Use ChatGPT, Claude or another AI with your own PDFs: copy our prompt, upload the PDFs there, then import the JSON it returns.</p>
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted">Prefer to start from scratch? <Link to="/examinations/blank" className="text-accent-fg hover:underline">Open a blank editor</Link>.</p>
    </>
  )
}
