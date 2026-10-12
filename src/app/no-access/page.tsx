export default function NoAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-stone-900">This login can’t use MVRK Pay</h1>
        <p className="mt-2 text-sm text-stone-600">
          Either the account hasn’t been set up for MVRK Pay yet, it has been deactivated, or this part of
          the app isn’t open to your role. David can sort that out in Settings → Users.
        </p>
        <form action="/auth/sign-out" method="post" className="mt-5">
          <button className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
