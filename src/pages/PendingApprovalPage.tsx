import { LogOut, Clock } from 'lucide-react'
import { useAuthContext } from '@/auth/AuthContext'

export function PendingApprovalPage() {
  const { signOut, profile } = useAuthContext()

  return (
    <div className="flex min-h-screen items-center justify-center bg-qira-cream px-4">
      <div className="w-full max-w-md rounded-[32px] bg-white p-10 text-center shadow-xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-qira-pistachio-lt text-qira-pistachio">
          <Clock size={32} />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-qira-anthracite">Ожидайте подтверждения</h1>
        <p className="mt-3 text-sm text-slate-500">
          Ваш аккаунт <strong>{profile?.email}</strong> зарегистрирован и ожидает одобрения администратором.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Как только администратор подтвердит вашу учётную запись, вы получите доступ к Qira.
        </p>
        <div className="mt-2 inline-block rounded-full bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-700">
          Ожидание одобрения от opsifymovie@gmail.com
        </div>
        <button
          onClick={() => signOut()}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          <LogOut size={16} />
          Выйти из аккаунта
        </button>
      </div>
    </div>
  )
}
