/**
 * The shape every Settings server action returns. Plain module (no directives)
 * so both server actions and client components can import it.
 *
 * Errors carry the database's own message, verbatim — the schema's constraint
 * messages are written to be read by people, not swallowed.
 */
export type ActionState = { error?: string; ok?: string } | null

export const fail = (message: string): ActionState => ({ error: message })
export const done = (message: string): ActionState => ({ ok: message })
