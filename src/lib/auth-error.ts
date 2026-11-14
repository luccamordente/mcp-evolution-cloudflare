export class AuthError extends Error {
  constructor(public readonly status: number, message: string, public readonly detail?: unknown) { super(message); this.name = 'AuthError'; }
}
